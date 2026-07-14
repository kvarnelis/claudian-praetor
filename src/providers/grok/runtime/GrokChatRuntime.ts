import * as fs from 'fs';
import * as path from 'path';

import { buildSystemPrompt } from '../../../core/prompt/mainAgent';
import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import type { ProviderHost } from '../../../core/providers/ProviderHost';
import { ProviderSettingsCoordinator } from '../../../core/providers/ProviderSettingsCoordinator';
import type { ProviderCapabilities } from '../../../core/providers/types';
import type { ChatRuntime } from '../../../core/runtime/ChatRuntime';
import type {
  ApprovalCallback,
  ApprovalDecisionOption,
  AskUserQuestionCallback,
  AutoTurnCallback,
  ChatRewindResult,
  ChatRuntimeConversationState,
  ChatRuntimeEnsureReadyOptions,
  ChatTurnMetadata,
  ChatTurnRequest,
  PreparedChatTurn,
  SessionUpdateResult,
  SubagentRuntimeState,
} from '../../../core/runtime/types';
import type {
  ApprovalDecision,
  ChatMessage,
  Conversation,
  ExitPlanModeCallback,
  SlashCommand,
  StreamChunk,
  UsageInfo,
} from '../../../core/types';
import { stripCurrentNoteContext } from '../../../utils/context';
import { getVaultPath } from '../../../utils/path';
import { buildContextFromHistory, buildPromptWithHistoryContext } from '../../../utils/session';
import {
  AcpClientConnection,
  type AcpContentBlock,
  AcpJsonRpcTransport,
  type AcpPromptResponse,
  type AcpProtocolVersion,
  type AcpReadTextFileRequest,
  type AcpRequestPermissionRequest,
  type AcpRequestPermissionResponse,
  type AcpSessionNotification,
  AcpSessionUpdateNormalizer,
  AcpSubprocess,
  type AcpUsageUpdate,
  type AcpWriteTextFileRequest,
} from '../../acp';
import { encodeCodexTurn } from '../../codex/prompt/encodeCodexTurn';
import { GROK_PROVIDER_CAPABILITIES } from '../capabilities';
import type { GrokProviderState } from '../types';
import { buildGrokEnv, buildGrokSystemPrompt, buildGrokTurnPrompt } from './GrokHeadlessRunner';

export { GROK_PROVIDER_CAPABILITIES };

function buildGrokAcpPromptText(
  systemPrompt: string,
  promptText: string,
  isFollowupTurn: boolean,
): string {
  const integrationPrompt = buildGrokSystemPrompt(systemPrompt, isFollowupTurn);
  return `<claudian_system_prompt>\n${integrationPrompt}\n</claudian_system_prompt>\n\n${buildGrokTurnPrompt(promptText, isFollowupTurn)}`;
}

function buildGrokAcpPromptBlocks(text: string): AcpContentBlock[] {
  return [{ type: 'text', text }];
}

function resolveGrokAcpSessionId(response: unknown): string | null {
  if (!response || typeof response !== 'object') {
    return null;
  }

  const record = response as Record<string, unknown>;
  if (typeof record.sessionId === 'string' && record.sessionId) {
    return record.sessionId;
  }
  if (typeof record.id === 'string' && record.id) {
    return record.id;
  }
  if (record.session && typeof record.session === 'object') {
    const session = record.session as Record<string, unknown>;
    return typeof session.id === 'string' && session.id ? session.id : null;
  }
  return null;
}

interface ActiveTurn {
  queue: StreamChunkQueue;
  sessionId: string;
}

class StreamChunkQueue {
  private closed = false;
  private readonly items: StreamChunk[] = [];
  private readonly waiters: Array<(chunk: StreamChunk | null) => void> = [];

  push(chunk: StreamChunk): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(chunk);
      return;
    }
    this.items.push(chunk);
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    while (this.waiters.length > 0) {
      this.waiters.shift()?.(null);
    }
  }

  async next(): Promise<StreamChunk | null> {
    if (this.items.length > 0) {
      return this.items.shift() ?? null;
    }

    if (this.closed) {
      return null;
    }

    return new Promise<StreamChunk | null>((resolve) => {
      this.waiters.push(resolve);
    });
  }
}

export class GrokChatRuntime implements ChatRuntime {
  readonly providerId = 'grok' as const;

  private activeTurn: ActiveTurn | null = null;
  private approvalCallback: ApprovalCallback | null = null;
  private connection: AcpClientConnection | null = null;
  private currentLaunchKey: string | null = null;
  private currentTurnMetadata: ChatTurnMetadata = {};
  private loadedSessionId: string | null = null;
  private process: AcpSubprocess | null = null;
  private ready = false;
  private readonly readyListeners = new Set<(ready: boolean) => void>();
  private readonly sessionCwds = new Map<string, string>();
  private sessionId: string | null = null;
  private sessionInvalidated = false;
  private readonly sessionUpdateNormalizer = new AcpSessionUpdateNormalizer();
  private readonly supportedCommandWaiters: Array<(commands: SlashCommand[]) => void> = [];
  private supportedCommands: SlashCommand[] = [];
  private transport: AcpJsonRpcTransport | null = null;
  private unregisterTransportClose: (() => void) | null = null;
  private readonly plugin: ProviderHost;

  constructor(plugin: ProviderHost) {
    this.plugin = plugin;
  }

  getCapabilities(): Readonly<ProviderCapabilities> {
    return GROK_PROVIDER_CAPABILITIES;
  }

  prepareTurn(request: ChatTurnRequest): PreparedChatTurn {
    return encodeCodexTurn(request);
  }

  consumeTurnMetadata(): ChatTurnMetadata {
    const metadata = { ...this.currentTurnMetadata };
    this.currentTurnMetadata = {};
    return metadata;
  }

  onReadyStateChange(listener: (ready: boolean) => void): () => void {
    this.readyListeners.add(listener);
    try {
      listener(this.ready);
    } catch {
      // Listener failures must not break runtime readiness wiring.
    }
    return () => {
      this.readyListeners.delete(listener);
    };
  }

  private setReady(ready: boolean): void {
    if (this.ready === ready) {
      return;
    }

    this.ready = ready;
    for (const listener of this.readyListeners) {
      try {
        listener(ready);
      } catch {
        // Listener failures must not break runtime readiness wiring.
      }
    }
  }

  setResumeCheckpoint(_checkpointId: string | undefined): void {}

  syncConversationState(
    conversation: ChatRuntimeConversationState | null,
    _externalContextPaths?: string[],
  ): void {
    const previousSessionId = this.sessionId;
    if (!conversation) {
      this.clearActiveSession();
      return;
    }

    const state = (conversation.providerState ?? {}) as GrokProviderState;
    const nextSessionId = state.sessionId ?? conversation.sessionId;
    if (previousSessionId !== nextSessionId) {
      this.loadedSessionId = null;
      this.sessionInvalidated = false;
      this.sessionUpdateNormalizer.reset();
      this.setSupportedCommands([]);
    }
    this.sessionId = nextSessionId ?? null;
  }

  async reloadMcpServers(): Promise<void> {}

  async ensureReady(options?: ChatRuntimeEnsureReadyOptions): Promise<boolean> {
    const cliPath = this.plugin.getResolvedProviderCliPath('grok');
    if (!cliPath) {
      this.setReady(false);
      return false;
    }

    const cwd = getVaultPath(this.plugin.app) ?? process.cwd();
    const providerSettings = ProviderSettingsCoordinator.getProviderSettingsSnapshot(
      this.plugin.settings,
      'grok',
    );
    const model = typeof providerSettings.model === 'string' && providerSettings.model.trim()
      ? providerSettings.model.trim()
      : 'grok-build';
    const effort = typeof providerSettings.effortLevel === 'string' && providerSettings.effortLevel.trim()
      ? providerSettings.effortLevel.trim()
      : 'medium';
    const permissionMode = typeof providerSettings.permissionMode === 'string'
      ? providerSettings.permissionMode
      : 'normal';
    const envText = getRuntimeEnvironmentText(this.plugin.settings, 'grok');
    const launchKey = JSON.stringify({
      cliPath,
      cwd,
      effort,
      envText,
      model,
      permissionMode,
    });

    const shouldRestart = !this.process
      || !this.transport
      || !this.connection
      || !this.process.isAlive()
      || this.transport.isClosed
      || options?.force === true
      || this.currentLaunchKey !== launchKey;

    if (shouldRestart) {
      await this.shutdownProcess();
      await this.startProcess({ cliPath, cwd, effort, model, permissionMode });
      this.currentLaunchKey = launchKey;
      this.loadedSessionId = null;
    }

    const targetSessionId = this.sessionId;
    if (targetSessionId) {
      if (this.loadedSessionId !== targetSessionId) {
        const loaded = await this.loadSession(targetSessionId, cwd);
        if (!loaded) {
          this.sessionInvalidated = true;
          this.clearActiveSession();
        }
      }
      return true;
    }

    if (!this.sessionId && !this.sessionInvalidated) {
      if (options?.allowSessionCreation === false) {
        return true;
      }
      return Boolean(await this.createSession(cwd));
    }

    return true;
  }

  private resetTurnMetadata(): void {
    this.currentTurnMetadata = {};
  }

  private recordTurnMetadata(update: ChatTurnMetadata): void {
    this.currentTurnMetadata = {
      ...this.currentTurnMetadata,
      ...update,
    };
  }

  private buildPrompt(turn: PreparedChatTurn, conversationHistory: ChatMessage[]): string {
    if (!conversationHistory || conversationHistory.length === 0) {
      return turn.prompt;
    }

    const historyContext = buildContextFromHistory(conversationHistory);
    if (!historyContext.trim()) {
      return turn.prompt;
    }

    const actualPrompt = stripCurrentNoteContext(turn.prompt);
    return buildPromptWithHistoryContext(historyContext, turn.prompt, actualPrompt, conversationHistory);
  }

  async *query(
    turn: PreparedChatTurn,
    conversationHistory?: ChatMessage[],
  ): AsyncGenerator<StreamChunk> {
    this.resetTurnMetadata();
    const previousMessages = conversationHistory ?? [];
    const expectedSessionId = this.sessionId;
    let shouldBootstrapHistory = previousMessages.length > 0
      && (!expectedSessionId || this.sessionInvalidated);

    if (!(await this.ensureReady())) {
      yield { type: 'error', content: 'Failed to start Grok ACP runtime. Check the Grok CLI path and login state.' };
      yield { type: 'done' };
      return;
    }

    if (!this.connection) {
      yield { type: 'error', content: 'Grok ACP runtime is not ready.' };
      yield { type: 'done' };
      return;
    }

    const cwd = getVaultPath(this.plugin.app) ?? process.cwd();
    if (expectedSessionId && !this.sessionId) {
      shouldBootstrapHistory = previousMessages.length > 0;
    }

    if (!this.sessionId) {
      const createdSessionId = await this.createSession(cwd);
      if (!createdSessionId) {
        yield { type: 'error', content: 'Failed to create a Grok ACP session.' };
        yield { type: 'done' };
        return;
      }
    }

    const sessionId = this.sessionId;
    if (!sessionId) {
      yield { type: 'error', content: 'Grok ACP session is unavailable.' };
      yield { type: 'done' };
      return;
    }

    if (this.activeTurn) {
      this.activeTurn.queue.close();
    }
    this.activeTurn = {
      queue: new StreamChunkQueue(),
      sessionId,
    };
    const activeTurn = this.activeTurn;
    this.sessionUpdateNormalizer.reset();

    const systemPrompt = buildSystemPrompt({
      mediaFolder: this.plugin.settings.mediaFolder,
      customPrompt: this.plugin.settings.systemPrompt,
      vaultPath: cwd,
      userName: this.plugin.settings.userName,
    });
    const isFollowupTurn = Boolean(expectedSessionId) || previousMessages.length > 0;
    const promptText = expectedSessionId && !shouldBootstrapHistory
      ? turn.prompt
      : this.buildPrompt(turn, previousMessages);
    const prompt = buildGrokAcpPromptBlocks(buildGrokAcpPromptText(systemPrompt, promptText, isFollowupTurn));

    const promptPromise = this.connection.prompt({
      prompt,
      sessionId,
    }).then((response) => {
      // Grok's prompt response can carry an assistantMessageId beyond the ACP schema.
      const promptResponse = response as (AcpPromptResponse & { assistantMessageId?: string | null }) | null;
      this.recordTurnMetadata({
        assistantMessageId: promptResponse?.assistantMessageId ?? undefined,
        userMessageId: promptResponse?.userMessageId ?? undefined,
        wasSent: true,
      });
      activeTurn.queue.push({ type: 'done' });
      activeTurn.queue.close();
    }).catch((error) => {
      activeTurn.queue.push({
        type: 'error',
        content: this.formatRuntimeError(error),
      });
      activeTurn.queue.push({ type: 'done' });
      activeTurn.queue.close();
    }).finally(() => {
      if (this.activeTurn === activeTurn) {
        this.activeTurn = null;
      }
    });

    try {
      while (true) {
        const chunk = await activeTurn.queue.next();
        if (!chunk) {
          break;
        }
        yield chunk;
      }
      await promptPromise;
    } finally {
      if (this.activeTurn === activeTurn) {
        this.activeTurn = null;
      }
    }
  }

  cancel(): void {
    if (this.connection && this.sessionId) {
      this.connection.cancel({ sessionId: this.sessionId });
    }
    if (this.activeTurn) {
      this.activeTurn.queue.close();
      this.activeTurn = null;
    }
  }

  resetSession(): void {
    this.cancel();
    this.clearActiveSession();
    this.sessionInvalidated = false;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  consumeSessionInvalidation(): boolean {
    const invalidated = this.sessionInvalidated;
    this.sessionInvalidated = false;
    return invalidated;
  }

  isReady(): boolean {
    return this.ready;
  }

  async getSupportedCommands(): Promise<SlashCommand[]> {
    if (this.supportedCommands.length > 0 && this.loadedSessionId === this.sessionId) {
      return [...this.supportedCommands];
    }

    if (!this.sessionId) {
      return [];
    }

    return this.waitForSupportedCommands();
  }

  cleanup(): void {
    if (this.activeTurn) {
      this.activeTurn.queue.close();
      this.activeTurn = null;
    }
    void this.shutdownProcess();
    this.readyListeners.clear();
    this.setReady(false);
  }

  async rewind(_userMessageId: string, _assistantMessageId: string): Promise<ChatRewindResult> {
    return { canRewind: false, error: 'Grok does not support rewind from Claudian yet' };
  }

  setApprovalCallback(callback: ApprovalCallback | null): void {
    this.approvalCallback = callback;
  }

  setApprovalDismisser(_dismisser: (() => void) | null): void {}

  setAskUserQuestionCallback(_callback: AskUserQuestionCallback | null): void {}

  setExitPlanModeCallback(_callback: ExitPlanModeCallback | null): void {}

  setPermissionModeSyncCallback(_callback: ((sdkMode: string) => void) | null): void {}

  setSubagentHookProvider(_getState: () => SubagentRuntimeState): void {}

  setAutoTurnCallback(_callback: AutoTurnCallback | null): void {}

  buildSessionUpdates(params: {
    conversation: Conversation | null;
    sessionInvalidated: boolean;
  }): SessionUpdateResult {
    const existingState = params.conversation?.providerState ?? {};
    const providerState = {
      ...existingState,
      ...(this.sessionId ? { sessionId: this.sessionId } : {}),
    };

    return {
      updates: {
        ...(this.sessionId ? { sessionId: this.sessionId } : {}),
        providerState: Object.keys(providerState).length > 0 ? providerState : undefined,
      },
    };
  }

  resolveSessionIdForFork(conversation: Conversation | null): string | null {
    if (this.sessionId) {
      return this.sessionId;
    }
    if (!conversation) {
      return null;
    }

    const state = (conversation.providerState ?? {}) as GrokProviderState;
    return state.sessionId ?? conversation.sessionId;
  }

  private async startProcess(params: {
    cliPath: string;
    cwd: string;
    effort: string;
    model: string;
    permissionMode: string;
  }): Promise<void> {
    const args = ['agent'];
    if (params.model) {
      args.push('-m', params.model);
    }
    if (params.effort) {
      args.push('--reasoning-effort', params.effort);
    }
    if (params.permissionMode === 'yolo') {
      args.push('--always-approve');
    }
    args.push('stdio');

    const env = buildGrokEnv(this.plugin.settings, params.cliPath);
    this.process = new AcpSubprocess({
      args,
      command: params.cliPath,
      cwd: params.cwd,
      env,
    });
    this.process.start();

    this.transport = new AcpJsonRpcTransport({
      input: this.process.stdout,
      onClose: (listener) => this.process!.onClose(listener),
      output: this.process.stdin,
    });
    const transport = this.transport;
    this.unregisterTransportClose = transport.onClose(() => {
      if (this.transport === transport) {
        this.setReady(false);
      }
    });

    this.connection = new AcpClientConnection({
      clientInfo: {
        name: 'claudian',
        version: this.plugin.manifest?.version ?? '0.0.0',
      },
      delegate: {
        fileSystem: {
          readTextFile: (request) => this.readTextFile(request),
          writeTextFile: (request) => this.writeTextFile(request),
        },
        onSessionNotification: (notification) => this.handleSessionNotification(notification),
        requestPermission: (request) => this.handlePermissionRequest(request),
      },
      transport: this.transport,
    });

    this.transport.start();
    await this.connection.initialize({
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
      },
      // Grok's ACP build negotiates the protocol version as the string "1".
      protocolVersion: '1' as unknown as AcpProtocolVersion,
    });
    this.setReady(true);
  }

  private async shutdownProcess(): Promise<void> {
    this.setReady(false);
    if (this.activeTurn) {
      this.activeTurn.queue.close();
      this.activeTurn = null;
    }
    this.setSupportedCommands([]);

    this.unregisterTransportClose?.();
    this.unregisterTransportClose = null;

    this.connection?.dispose();
    this.connection = null;

    this.transport?.dispose();
    this.transport = null;

    if (this.process) {
      await this.process.shutdown().catch(() => {});
      this.process = null;
    }
    this.currentLaunchKey = null;
    this.loadedSessionId = null;
    this.sessionUpdateNormalizer.reset();
  }

  private async createSession(cwd: string): Promise<string | null> {
    if (!this.connection) {
      return null;
    }

    try {
      this.setSupportedCommands([]);
      const response = await this.connection.newSession({
        cwd,
        mcpServers: [],
      });
      const sessionId = resolveGrokAcpSessionId(response);
      if (!sessionId) {
        return null;
      }
      this.loadedSessionId = sessionId;
      this.sessionId = sessionId;
      this.sessionInvalidated = false;
      this.sessionCwds.set(sessionId, cwd);
      return sessionId;
    } catch {
      return null;
    }
  }

  private async loadSession(sessionId: string, cwd: string): Promise<boolean> {
    if (!this.connection || !sessionId) {
      return false;
    }

    try {
      this.setSupportedCommands([]);
      const response = await this.connection.loadSession({
        cwd,
        mcpServers: [],
        sessionId,
      });
      const resolvedSessionId = resolveGrokAcpSessionId(response) || sessionId;
      this.loadedSessionId = resolvedSessionId;
      this.sessionId = resolvedSessionId;
      this.sessionInvalidated = false;
      this.sessionCwds.set(resolvedSessionId, cwd);
      return true;
    } catch {
      return false;
    }
  }

  private async handleSessionNotification(notification: AcpSessionNotification): Promise<void> {
    const sessionId = notification?.sessionId ?? this.sessionId;
    if (!sessionId || sessionId !== this.sessionId) {
      return;
    }

    const normalized = this.sessionUpdateNormalizer.normalize(notification.update);
    // The normalizer has no default branch; unknown update kinds yield undefined at runtime.
    if (!normalized) {
      return;
    }

    if (normalized.type === 'commands') {
      this.setSupportedCommands(normalized.commands);
      return;
    }

    if (!this.activeTurn || this.activeTurn.sessionId !== sessionId) {
      return;
    }

    switch (normalized.type) {
      case 'message_chunk': {
        if (normalized.role === 'assistant' && normalized.messageId) {
          this.currentTurnMetadata.assistantMessageId = normalized.messageId;
        }
        if (normalized.role === 'user' && normalized.messageId) {
          this.currentTurnMetadata.userMessageId = normalized.messageId;
        }
        for (const chunk of normalized.streamChunks) {
          this.activeTurn.queue.push(chunk);
        }
        return;
      }
      case 'tool_call':
      case 'tool_call_update': {
        for (const chunk of normalized.streamChunks) {
          this.activeTurn.queue.push(chunk);
        }
        return;
      }
      case 'usage': {
        // Grok nests context-window data under a contextWindow object the shared ACP type
        // does not model, and reports no token splits (inputTokens stays absent).
        const usage: AcpUsageUpdate & {
          contextWindow?: { size?: number; used?: number } | null;
        } = normalized.usage;
        this.activeTurn.queue.push({
          sessionId,
          type: 'usage',
          usage: {
            contextTokens: (usage.contextWindow && usage.contextWindow.used) || 0,
            contextWindow: (usage.contextWindow && usage.contextWindow.size) || 0,
            percentage: usage.contextWindow && usage.contextWindow.size
              ? Math.round(((usage.contextWindow.used || 0) / usage.contextWindow.size) * 100)
              : 0,
          } as UsageInfo,
        });
        return;
      }
      default:
        return;
    }
  }

  private async handlePermissionRequest(
    request: AcpRequestPermissionRequest,
  ): Promise<AcpRequestPermissionResponse> {
    if (!this.approvalCallback) {
      return { outcome: { outcome: 'cancelled' } };
    }

    // Grok's permission payloads do not always nest the tool call; fall back to the envelope.
    const toolCall = (request?.toolCall ?? request ?? {}) as unknown as {
      arguments?: unknown;
      input?: unknown;
      kind?: string | null;
      name?: string | null;
      rawInput?: unknown;
      title?: string | null;
    };
    const rawInput = toolCall.rawInput ?? toolCall.input ?? toolCall.arguments;
    const input = normalizeApprovalInput(rawInput);
    const title = (toolCall.title ?? toolCall.kind ?? toolCall.name ?? 'Grok tool').toString();
    const options = Array.isArray(request?.options) ? request.options : [];
    const decision = await this.approvalCallback(
      title,
      input,
      `Grok wants to use ${title}.`,
      options.length > 0 ? { decisionOptions: buildAcpApprovalDecisionOptions(options) } : undefined,
    );

    // Without options, Grok's ACP build expects a bare approved/cancelled outcome
    // instead of the standard option selection.
    return options.length > 0
      ? mapApprovalDecision(decision, options)
      : {
        outcome: {
          outcome: decision === 'allow' || decision === 'allow-always' ? 'approved' : 'cancelled',
        },
      } as unknown as AcpRequestPermissionResponse;
  }

  private setSupportedCommands(commands: SlashCommand[]): void {
    this.supportedCommands = commands.map((command) => ({ ...command }));

    const waiters = this.supportedCommandWaiters.splice(0);
    for (const waiter of waiters) {
      waiter(this.supportedCommands);
    }
  }

  private waitForSupportedCommands(timeoutMs = 250): Promise<SlashCommand[]> {
    if (this.supportedCommands.length > 0) {
      return Promise.resolve([...this.supportedCommands]);
    }

    return new Promise<SlashCommand[]>((resolve) => {
      const waiter = (commands: SlashCommand[]) => {
        window.clearTimeout(timeoutId);
        resolve([...commands]);
      };
      const timeoutId = window.setTimeout(() => {
        const index = this.supportedCommandWaiters.indexOf(waiter);
        if (index >= 0) {
          this.supportedCommandWaiters.splice(index, 1);
        }
        resolve([...this.supportedCommands]);
      }, timeoutMs);

      this.supportedCommandWaiters.push(waiter);
    });
  }

  private async readTextFile(
    request: AcpReadTextFileRequest,
  ): Promise<{ content: string }> {
    const resolvedPath = this.resolveSessionPath(request.sessionId, request.path);
    const content = await fs.promises.readFile(resolvedPath, 'utf-8');

    if (request.line === undefined && request.limit === undefined) {
      return { content };
    }

    const lines = content.split(/\r?\n/);
    const startIndex = Math.max(0, (request.line ?? 1) - 1);
    const endIndex = request.limit
      ? startIndex + Math.max(0, request.limit)
      : lines.length;

    return {
      content: lines.slice(startIndex, endIndex).join('\n'),
    };
  }

  private async writeTextFile(
    request: AcpWriteTextFileRequest,
  ): Promise<Record<string, never>> {
    const resolvedPath = this.resolveSessionPath(request.sessionId, request.path);
    await fs.promises.mkdir(path.dirname(resolvedPath), { recursive: true });
    await fs.promises.writeFile(resolvedPath, request.content, 'utf-8');
    return {};
  }

  private resolveSessionPath(sessionId: string, rawPath: unknown): string {
    if (typeof rawPath !== 'string') {
      return getVaultPath(this.plugin.app) ?? process.cwd();
    }

    if (path.isAbsolute(rawPath)) {
      return rawPath;
    }

    const cwd = this.sessionCwds.get(sessionId)
      ?? (getVaultPath(this.plugin.app) || process.cwd());
    return path.resolve(cwd, rawPath);
  }

  private formatRuntimeError(error: unknown): string {
    const baseMessage = error instanceof Error ? error.message : 'Grok ACP request failed';
    const stderr = this.process?.getStderrSnapshot();
    return stderr ? `${baseMessage}\n\n${stderr}` : baseMessage;
  }

  private clearActiveSession(): void {
    this.sessionId = null;
    this.loadedSessionId = null;
    this.sessionUpdateNormalizer.reset();
    this.setSupportedCommands([]);
  }
}

function normalizeApprovalInput(rawInput: unknown): Record<string, unknown> {
  if (rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)) {
    return rawInput as Record<string, unknown>;
  }
  if (rawInput === undefined) {
    return {};
  }
  return { value: rawInput };
}

function mapApprovalDecision(
  decision: ApprovalDecision,
  options: readonly {
    kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';
    optionId: string;
  }[],
): AcpRequestPermissionResponse {
  if (decision === 'allow') {
    return selectPermissionOption(options, ['allow_once', 'allow_always']);
  }

  if (decision === 'allow-always') {
    return selectPermissionOption(options, ['allow_always', 'allow_once']);
  }

  if (decision === 'deny') {
    return selectPermissionOption(options, ['reject_once', 'reject_always']);
  }

  if (typeof decision === 'object' && decision.type === 'select-option') {
    return {
      outcome: {
        optionId: decision.value,
        outcome: 'selected',
      },
    };
  }

  return { outcome: { outcome: 'cancelled' } };
}

function buildAcpApprovalDecisionOptions(
  options: readonly {
    kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';
    name: string;
    optionId: string;
  }[],
): ApprovalDecisionOption[] {
  return options.map((option) => ({
    ...(option.kind === 'allow_once'
      ? { decision: 'allow' as const }
      : option.kind === 'allow_always'
      ? { decision: 'allow-always' as const }
      : {}),
    label: option.name,
    value: option.optionId,
  }));
}

function selectPermissionOption(
  options: readonly {
    kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';
    optionId: string;
  }[],
  preferredKinds: readonly ('allow_once' | 'allow_always' | 'reject_once' | 'reject_always')[],
): AcpRequestPermissionResponse {
  for (const kind of preferredKinds) {
    const option = options.find((entry) => entry.kind === kind);
    if (option) {
      return {
        outcome: {
          optionId: option.optionId,
          outcome: 'selected',
        },
      };
    }
  }

  return { outcome: { outcome: 'cancelled' } };
}
