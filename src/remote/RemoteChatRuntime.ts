/**
 * ChatRuntime implementation that proxies a real provider runtime hosted by
 * the Pocket Codex daemon on the user's desktop machine.
 *
 * Synchronous ChatRuntime methods are served from a local mirror of the
 * server-side runtime state; the mirror is updated by sequence-numbered
 * stream events, so brief disconnects (screen lock, network blips) replay
 * losslessly via `runtime.attach`.
 *
 * Platform-pure: no Node, no Obsidian imports.
 */

import type { ProviderCapabilities, ProviderId } from '../core/providers/types';
import type { ChatRuntime } from '../core/runtime/ChatRuntime';
import type {
  ApprovalCallback,
  ApprovalCallbackOptions,
  AskUserQuestionCallback,
  AutoTurnCallback,
  AutoTurnResult,
  ChatRewindMode,
  ChatRewindResult,
  ChatRuntimeConversationState,
  ChatRuntimeEnsureReadyOptions,
  ChatRuntimeQueryOptions,
  ChatTurnMetadata,
  ChatTurnRequest,
  ExitPlanModeCallback,
  PreparedChatTurn,
  SessionUpdateResult,
} from '../core/runtime/types';
import type {
  ChatMessage,
  Conversation,
  SlashCommand,
  StreamChunk,
  ToolCallInfo,
} from '../core/types';
import {
  type ApprovalCallbackPayload,
  type CallbackKind,
  generateId,
  type QueryEvent,
  queryOptionsToWire,
  type RuntimeAttachParams,
  type RuntimeAttachResult,
  type RuntimeCallParams,
  type RuntimeCreateParams,
  type RuntimeCreateResult,
  type RuntimeQueryParams,
  type RuntimeStateSnapshot,
  turnRequestToWire,
} from './protocol';
import type { RemoteClient } from './RemoteClient';

interface QueryQueueItem {
  ev: QueryEvent;
}

class AsyncEventQueue {
  private items: QueryQueueItem[] = [];
  private waiter: ((item: QueryQueueItem | null) => void) | null = null;
  private closed = false;

  push(ev: QueryEvent): void {
    if (this.closed) return;
    const item = { ev };
    if (this.waiter) {
      const waiter = this.waiter;
      this.waiter = null;
      waiter(item);
    } else {
      this.items.push(item);
    }
  }

  close(): void {
    this.closed = true;
    if (this.waiter) {
      const waiter = this.waiter;
      this.waiter = null;
      waiter(null);
    }
  }

  async next(): Promise<QueryQueueItem | null> {
    if (this.items.length > 0) {
      return this.items.shift() ?? null;
    }
    if (this.closed) return null;
    return new Promise((resolve) => {
      this.waiter = resolve;
    });
  }
}

const COMPACT_COMMAND_PATTERN = /^\/compact(\s|$)/i;

export class RemoteChatRuntime implements ChatRuntime {
  readonly providerId: ProviderId;

  private readonly client: RemoteClient;
  private readonly capabilities: ProviderCapabilities;

  private runtimeId: string | null = null;
  private creating: Promise<string> | null = null;
  private disposed = false;

  // Mirror of server-side state
  private sessionId: string | null = null;
  private ready = false;
  private sessionInvalidated = false;
  private turnMetadata: ChatTurnMetadata = {};
  private sessionUpdates: Partial<Conversation> | null = null;
  private lastEventSeq = 0;

  private activeQueue: AsyncEventQueue | null = null;
  private queryActive = false;

  private conversationState: ChatRuntimeConversationState | null = null;
  private externalContextPaths: string[] | undefined;

  private readyListeners = new Set<(ready: boolean) => void>();
  private approvalCallback: ApprovalCallback | null = null;
  private approvalDismisser: (() => void) | null = null;
  private askUserQuestionCallback: AskUserQuestionCallback | null = null;
  private exitPlanModeCallback: ExitPlanModeCallback | null = null;
  private permissionModeSyncCallback: ((sdkMode: string) => void) | null = null;
  private autoTurnCallback: AutoTurnCallback | null = null;

  private readonly onDisposed: ((self: RemoteChatRuntime) => void) | null;

  constructor(options: {
    client: RemoteClient;
    providerId: ProviderId;
    capabilities: ProviderCapabilities;
    onDisposed?: (self: RemoteChatRuntime) => void;
  }) {
    this.client = options.client;
    this.providerId = options.providerId;
    this.capabilities = options.capabilities;
    this.onDisposed = options.onDisposed ?? null;
  }

  getCapabilities(): Readonly<ProviderCapabilities> {
    return this.capabilities;
  }

  prepareTurn(request: ChatTurnRequest): PreparedChatTurn {
    // Optimistic client-side prepare; the daemon re-prepares authoritatively
    // and streams back a 'prepared' event that patches this object in place.
    return {
      request,
      persistedContent: request.text,
      prompt: request.text,
      isCompact: COMPACT_COMMAND_PATTERN.test(request.text),
      mcpMentions: new Set<string>(),
    };
  }

  onReadyStateChange(listener: (ready: boolean) => void): () => void {
    this.readyListeners.add(listener);
    try {
      listener(this.ready);
    } catch {
      // listener errors are not ours to surface
    }
    return () => this.readyListeners.delete(listener);
  }

  setResumeCheckpoint(checkpointId: string | undefined): void {
    void this.call('setResumeCheckpoint', [checkpointId]).catch(() => undefined);
  }

  syncConversationState(
    conversation: ChatRuntimeConversationState | null,
    externalContextPaths?: string[],
  ): void {
    this.conversationState = conversation
      ? { sessionId: conversation.sessionId, providerState: conversation.providerState }
      : null;
    this.externalContextPaths = externalContextPaths;
    this.sessionId = conversation?.sessionId ?? null;
    void this.call('syncConversationState', [this.conversationState, externalContextPaths])
      .catch(() => undefined);
  }

  async reloadMcpServers(): Promise<void> {
    await this.call('reloadMcpServers', []);
  }

  async ensureReady(options?: ChatRuntimeEnsureReadyOptions): Promise<boolean> {
    const result = await this.call<boolean>('ensureReady', [options]);
    return result === true;
  }

  async *query(
    turn: PreparedChatTurn,
    conversationHistory?: ChatMessage[],
    queryOptions?: ChatRuntimeQueryOptions,
  ): AsyncGenerator<StreamChunk> {
    let runtimeId: string;
    try {
      runtimeId = await this.ensureRuntime();
    } catch (e) {
      yield { type: 'error', content: e instanceof Error ? e.message : String(e) };
      return;
    }

    const queue = new AsyncEventQueue();
    this.activeQueue = queue;
    this.queryActive = true;

    const params: RuntimeQueryParams = {
      runtimeId,
      request: turnRequestToWire(turn.request),
      history: conversationHistory,
      options: queryOptionsToWire(queryOptions),
      conversation: this.conversationState,
      externalContextPaths: this.externalContextPaths,
    };

    try {
      await this.client.rpc('runtime.query', params);

      for (;;) {
        const item = await queue.next();
        if (!item) {
          // Queue closed without an end event: connection died and reattach failed.
          yield { type: 'error', content: "Lost connection to the Pocket Codex daemon and could not resume the stream." };
          return;
        }

        const ev = item.ev;
        switch (ev.k) {
          case 'prepared': {
            // Patch the shared turn object so post-stream consumers persist
            // the authoritative provider encoding.
            turn.persistedContent = ev.prepared.persistedContent;
            turn.prompt = ev.prepared.prompt;
            turn.isCompact = ev.prepared.isCompact;
            turn.mcpMentions = new Set(ev.prepared.mcpMentions);
            break;
          }
          case 'chunk':
            yield ev.chunk;
            break;
          case 'state':
            this.applyState(ev.state);
            break;
          case 'end':
            return;
          case 'err':
            yield { type: 'error', content: ev.error };
            return;
          case 'accepted':
            break;
        }
      }
    } catch (e) {
      yield { type: 'error', content: e instanceof Error ? e.message : String(e) };
    } finally {
      this.queryActive = false;
      if (this.activeQueue === queue) {
        this.activeQueue = null;
      }
      queue.close();
    }
  }

  async steer(turn: PreparedChatTurn): Promise<boolean> {
    const result = await this.call<boolean>('steer', [
      { ...turn, request: turnRequestToWire(turn.request), mcpMentions: [...turn.mcpMentions] },
    ]);
    return result === true;
  }

  cancel(): void {
    if (this.runtimeId) {
      this.client.notify({ t: 'q.cancel', runtimeId: this.runtimeId });
    }
  }

  resetSession(): void {
    this.sessionId = null;
    this.sessionUpdates = null;
    void this.call('resetSession', []).catch(() => undefined);
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  consumeSessionInvalidation(): boolean {
    const value = this.sessionInvalidated;
    this.sessionInvalidated = false;
    return value;
  }

  isReady(): boolean {
    return this.ready;
  }

  async getSupportedCommands(): Promise<SlashCommand[]> {
    const result = await this.call<SlashCommand[]>('getSupportedCommands', []);
    return Array.isArray(result) ? result : [];
  }

  getAuxiliaryModel(): string | null {
    return null;
  }

  cleanup(): void {
    this.disposed = true;
    this.onDisposed?.(this);
    this.activeQueue?.close();
    this.activeQueue = null;
    const runtimeId = this.runtimeId;
    this.runtimeId = null;
    if (runtimeId) {
      this.client.setQueryEventHandler(runtimeId, null);
      this.client.setRuntimeEventHandler(runtimeId, null);
      this.client.setCallbackHandler(runtimeId, null);
      void this.client.rpc('runtime.dispose', { runtimeId }).catch(() => undefined);
    }
    this.readyListeners.clear();
  }

  async rewind(
    userMessageId: string,
    assistantMessageId: string,
    mode?: ChatRewindMode,
  ): Promise<ChatRewindResult> {
    try {
      const result = await this.call<ChatRewindResult>('rewind', [userMessageId, assistantMessageId, mode]);
      return result ?? { canRewind: false, error: 'Remote rewind returned no result' };
    } catch (err) {
      return { canRewind: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  setApprovalCallback(callback: ApprovalCallback | null): void {
    this.approvalCallback = callback;
  }

  setApprovalDismisser(dismisser: (() => void) | null): void {
    this.approvalDismisser = dismisser;
  }

  setAskUserQuestionCallback(callback: AskUserQuestionCallback | null): void {
    this.askUserQuestionCallback = callback;
  }

  setExitPlanModeCallback(callback: ExitPlanModeCallback | null): void {
    this.exitPlanModeCallback = callback;
  }

  setPermissionModeSyncCallback(callback: ((sdkMode: string) => void) | null): void {
    this.permissionModeSyncCallback = callback;
  }

  setAutoTurnCallback(callback: AutoTurnCallback | null): void {
    this.autoTurnCallback = callback;
  }

  consumeTurnMetadata(): ChatTurnMetadata {
    const metadata = this.turnMetadata;
    this.turnMetadata = {};
    return metadata;
  }

  buildSessionUpdates(params: {
    conversation: Conversation | null;
    sessionInvalidated: boolean;
  }): SessionUpdateResult {
    if (this.sessionUpdates) {
      const updates = this.sessionUpdates;
      this.sessionUpdates = null;
      return { updates };
    }
    if (params.sessionInvalidated) {
      return { updates: { sessionId: null } };
    }
    return { updates: this.sessionId ? { sessionId: this.sessionId } : {} };
  }

  resolveSessionIdForFork(conversation: Conversation | null): string | null {
    return conversation?.sessionId ?? this.sessionId;
  }

  async loadSubagentToolCalls(agentId: string): Promise<ToolCallInfo[]> {
    const result = await this.call<ToolCallInfo[]>('loadSubagentToolCalls', [agentId]);
    return Array.isArray(result) ? result : [];
  }

  async loadSubagentFinalResult(agentId: string): Promise<string | null> {
    const result = await this.call<string | null>('loadSubagentFinalResult', [agentId]);
    return typeof result === 'string' ? result : null;
  }

  // -------------------------------------------------------------------------

  private async ensureRuntime(): Promise<string> {
    if (this.disposed) {
      throw new Error('Runtime has been disposed');
    }
    if (this.runtimeId) return this.runtimeId;
    if (this.creating) return this.creating;

    this.creating = (async () => {
      const params: RuntimeCreateParams = { providerId: this.providerId };
      const result = await this.client.rpc<RuntimeCreateResult>('runtime.create', params);
      this.runtimeId = result.runtimeId;
      this.applyState(result.state);
      this.client.setQueryEventHandler(result.runtimeId, (seq, ev) => this.handleQueryEvent(seq, ev));
      this.client.setRuntimeEventHandler(result.runtimeId, (kind, payload) => this.handleRuntimeEvent(kind, payload));
      this.client.setCallbackHandler(result.runtimeId, (kind, payload) => this.handleCallback(kind, payload));
      // Push current conversation state so resumes work after reconnects.
      if (this.conversationState) {
        await this.client.rpc('runtime.call', {
          runtimeId: result.runtimeId,
          method: 'syncConversationState',
          args: [this.conversationState, this.externalContextPaths],
        } satisfies RuntimeCallParams).catch(() => undefined);
      }
      return result.runtimeId;
    })();

    try {
      return await this.creating;
    } finally {
      this.creating = null;
    }
  }

  /** Re-attach to the server-side runtime after a reconnect. */
  async reattach(): Promise<void> {
    const runtimeId = this.runtimeId;
    if (!runtimeId || this.disposed) return;
    try {
      const result = await this.client.rpc<RuntimeAttachResult>('runtime.attach', {
        runtimeId,
        fromSeq: this.lastEventSeq,
      } satisfies RuntimeAttachParams);

      if (!result.found) {
        // Daemon restarted: server runtime is gone. Surface as a closed stream.
        this.runtimeId = null;
        this.lastEventSeq = 0;
        this.setReady(false);
        this.activeQueue?.close();
        this.activeQueue = null;
        return;
      }
      if (result.state) this.applyState(result.state);
    } catch {
      this.activeQueue?.close();
      this.activeQueue = null;
    }
  }

  private handleQueryEvent(seq: number, ev: QueryEvent): void {
    if (seq <= this.lastEventSeq) return; // duplicate from replay
    this.lastEventSeq = seq;
    if (ev.k === 'state') this.applyState(ev.state);
    this.activeQueue?.push(ev);
  }

  private handleRuntimeEvent(kind: string, payload: unknown): void {
    switch (kind) {
      case 'ready':
        this.setReady(payload === true);
        break;
      case 'permissionModeSync':
        if (typeof payload === 'string') this.permissionModeSyncCallback?.(payload);
        break;
      case 'autoTurn':
        if (payload && typeof payload === 'object') {
          void this.autoTurnCallback?.(payload as AutoTurnResult);
        }
        break;
      case 'disposed':
        this.setReady(false);
        this.activeQueue?.close();
        break;
    }
  }

  private async handleCallback(kind: CallbackKind, payload: unknown): Promise<unknown> {
    switch (kind) {
      case 'approval': {
        const p = payload as ApprovalCallbackPayload;
        if (!this.approvalCallback) return 'deny';
        return this.approvalCallback(
          p.toolName,
          p.input ?? {},
          p.description ?? '',
          p.options as ApprovalCallbackOptions | undefined,
        );
      }
      case 'askUser': {
        const p = payload as { input: Record<string, unknown> };
        if (!this.askUserQuestionCallback) return null;
        return this.askUserQuestionCallback(p.input ?? {});
      }
      case 'exitPlanMode': {
        const p = payload as { args: unknown[] };
        const callback = this.exitPlanModeCallback as ((...args: unknown[]) => unknown) | null;
        if (!callback) return null;
        return callback(...(Array.isArray(p.args) ? p.args : []));
      }
    }
  }

  private applyState(state: RuntimeStateSnapshot): void {
    this.sessionId = state.sessionId;
    if (state.sessionInvalidated) this.sessionInvalidated = true;
    if (state.turnMetadata) this.turnMetadata = state.turnMetadata;
    if (state.sessionUpdates) this.sessionUpdates = state.sessionUpdates;
    this.setReady(state.isReady);
  }

  private setReady(ready: boolean): void {
    if (this.ready === ready) return;
    this.ready = ready;
    if (!ready) this.approvalDismisser?.();
    for (const listener of this.readyListeners) {
      try {
        listener(ready);
      } catch {
        // listener errors must not break the runtime
      }
    }
  }

  /** Identifier used by the manager to route reconnect hooks. */
  readonly instanceId = generateId('rrt');

  private async call<T>(method: string, args: unknown[]): Promise<T> {
    const runtimeId = await this.ensureRuntime();
    const params: RuntimeCallParams = { runtimeId, method, args };
    return this.client.rpc<T>('runtime.call', params);
  }
}
