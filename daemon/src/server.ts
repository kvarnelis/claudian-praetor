/**
 * praetord WebSocket server: hosts real ChatRuntime instances and speaks the
 * wire protocol in src/remote/protocol.ts.
 *
 * Runtimes survive client disconnects: each runtime host buffers its
 * sequence-numbered query events so a reconnecting client can replay from the
 * last sequence it saw (runtime.attach). Orphaned runtimes are disposed after
 * a grace period.
 */

import * as path from 'path';
import type { Server } from 'http';
import { type WebSocket, WebSocketServer } from 'ws';

import { authorizeClient } from './config';
import { ProviderRegistry } from '../../src/core/providers/ProviderRegistry';
import type { ProviderId } from '../../src/core/providers/types';
import type { ChatRuntime } from '../../src/core/runtime/ChatRuntime';
import type { ChatTurnMetadata } from '../../src/core/runtime/types';
import type { ClaudianSettings, Conversation } from '../../src/core/types';
import type ClaudianPlugin from '../../src/main';
import {
  type ClientMessage,
  generateId,
  type HistoryHydrateParams,
  PRAETOR_PROTOCOL_VERSION,
  preparedTurnToWire,
  PROXIED_RUNTIME_METHODS,
  type QueryEvent,
  queryOptionsFromWire,
  type RuntimeAttachParams,
  type RuntimeCallParams,
  type RuntimeCreateParams,
  type RuntimeQueryParams,
  type RuntimeStateSnapshot,
  type ServerMessage,
  type TitleGenerateParams,
  turnRequestFromWire,
  type WireConversationRef,
  type WireConversationState,
} from '../../src/remote/protocol';

const EVENT_BUFFER_CAP = 1000;
const ORPHAN_GRACE_MS = 30 * 60 * 1000;
const GC_INTERVAL_MS = 5 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 30 * 1000;
const HANDSHAKE_TIMEOUT_MS = 10 * 1000;
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;
const DAEMON_VERSION = '0.1.0';

interface RuntimeHost {
  runtimeId: string;
  providerId: ProviderId;
  runtime: ChatRuntime;
  seq: number;
  buffer: Array<{ seq: number; ev: QueryEvent }>;
  ownerSocket: WebSocket | null;
  lastSeen: number;
  queryRunning: boolean;
  lastConversation: WireConversationState | null;
}

interface PendingCallback {
  resolve: (result: unknown) => void;
  timer: NodeJS.Timeout;
}

export interface PraetorServerOptions {
  plugin: ClaudianPlugin;
  settings: ClaudianSettings;
  vaultPath: string;
  host: string;
  port: number;
  configPath: string;
  log: (message: string) => void;
}

export class PraetorServer {
  private wss: WebSocketServer | null = null;
  private readonly hosts = new Map<string, RuntimeHost>();
  private readonly pendingCallbacks = new Map<number, PendingCallback>();
  private nextCallbackId = 1;
  private gcTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(private readonly options: PraetorServerOptions) {}

  start(): Promise<void> {
    const { host, port, log } = this.options;
    const wss = new WebSocketServer({ host, port });
    this.wss = wss;

    wss.on('connection', (socket) => this.handleConnection(socket));

    this.gcTimer = setInterval(() => this.collectOrphans(), GC_INTERVAL_MS);
    this.heartbeatTimer = setInterval(() => {
      for (const socket of wss.clients) {
        const meta = socketMeta.get(socket);
        if (meta && !meta.alive) {
          socket.terminate();
          continue;
        }
        if (meta) meta.alive = false;
        socket.ping();
      }
    }, HEARTBEAT_INTERVAL_MS);

    return new Promise((resolve, reject) => {
      wss.once('listening', () => {
        log(`[praetord] listening on ws://${host}:${port}`);
        resolve();
      });
      wss.once('error', reject);
    });
  }

  async stop(): Promise<void> {
    if (this.gcTimer) clearInterval(this.gcTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    for (const host of this.hosts.values()) {
      try {
        host.runtime.cleanup();
      } catch {
        // best-effort shutdown
      }
    }
    this.hosts.clear();
    await new Promise<void>((resolve) => {
      this.wss?.close(() => resolve());
    });
  }

  // -------------------------------------------------------------------------

  private handleConnection(socket: WebSocket): void {
    const { log } = this.options;
    socketMeta.set(socket, { alive: true, authed: false });
    socket.on('pong', () => {
      const meta = socketMeta.get(socket);
      if (meta) meta.alive = true;
    });

    const handshakeTimer = setTimeout(() => {
      if (!socketMeta.get(socket)?.authed) socket.terminate();
    }, HANDSHAKE_TIMEOUT_MS);

    socket.on('message', (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(raw)) as ClientMessage;
      } catch {
        return;
      }

      const meta = socketMeta.get(socket);
      if (!meta) return;

      if (!meta.authed) {
        if (msg.t !== 'hello') {
          socket.close();
          return;
        }
        clearTimeout(handshakeTimer);
        if (msg.proto !== PRAETOR_PROTOCOL_VERSION) {
          this.send(socket, { t: 'hello.err', error: 'protocol version mismatch' });
          socket.close();
          return;
        }

        const authorization = authorizeClient(this.options.configPath, {
          clientId: msg.clientId,
          clientInfo: msg.clientInfo,
          remoteAddress: this.getRemoteAddress(socket),
        });
        if (!authorization.ok) {
          this.send(socket, { t: 'hello.err', error: authorization.reason ?? 'device not paired' });
          socket.close();
          return;
        }

        meta.authed = true;
        this.send(socket, {
          t: 'hello.ok',
          proto: PRAETOR_PROTOCOL_VERSION,
          daemonVersion: DAEMON_VERSION,
          vaultPath: this.options.vaultPath,
          vaultName: path.basename(this.options.vaultPath),
          providers: ProviderRegistry.getEnabledProviderIds(
            this.options.settings as unknown as Record<string, unknown>,
          ),
        });
        log(authorization.paired ? '[praetord] paired and connected client' : '[praetord] client connected');
        return;
      }

      void this.handleAuthedMessage(socket, msg);
    });

    socket.on('close', () => {
      socketMeta.delete(socket);
      for (const host of this.hosts.values()) {
        if (host.ownerSocket === socket) {
          host.ownerSocket = null;
          host.lastSeen = Date.now();
        }
      }
    });
  }

  private async handleAuthedMessage(socket: WebSocket, msg: ClientMessage): Promise<void> {
    switch (msg.t) {
      case 'rpc': {
        try {
          const result = await this.dispatchRpc(socket, msg.method, msg.params);
          this.send(socket, { t: 'rpc.ok', id: msg.id, result: jsonSafe(result) });
        } catch (err) {
          this.send(socket, {
            t: 'rpc.err',
            id: msg.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        break;
      }
      case 'cb.res': {
        const pending = this.pendingCallbacks.get(msg.cbId);
        if (pending) {
          this.pendingCallbacks.delete(msg.cbId);
          clearTimeout(pending.timer);
          pending.resolve(msg.result);
        }
        break;
      }
      case 'q.cancel': {
        const host = this.hosts.get(msg.runtimeId);
        try {
          host?.runtime.cancel();
        } catch {
          // cancel is best-effort
        }
        break;
      }
      case 'hello':
        break;
    }
  }

  private async dispatchRpc(socket: WebSocket, method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case 'runtime.create':
        return this.rpcRuntimeCreate(socket, params as RuntimeCreateParams);
      case 'runtime.attach':
        return this.rpcRuntimeAttach(socket, params as RuntimeAttachParams);
      case 'runtime.dispose': {
        const { runtimeId } = params as { runtimeId: string };
        const host = this.hosts.get(runtimeId);
        if (host) {
          this.hosts.delete(runtimeId);
          try {
            host.runtime.cleanup();
          } catch {
            // disposed anyway
          }
        }
        return { ok: true };
      }
      case 'runtime.call':
        return this.rpcRuntimeCall(params as RuntimeCallParams);
      case 'runtime.query':
        return this.rpcRuntimeQuery(params as RuntimeQueryParams);
      case 'history.hydrate':
        return this.rpcHistoryHydrate(params as HistoryHydrateParams);
      case 'history.delete':
        return this.rpcHistoryDelete(params as HistoryHydrateParams);
      case 'aux.generateTitle':
        return this.rpcGenerateTitle(params as TitleGenerateParams);
      case 'daemon.status':
        return {
          daemonVersion: DAEMON_VERSION,
          vaultPath: this.options.vaultPath,
          runtimes: this.hosts.size,
        };
      default:
        throw new Error(`Unknown RPC method: ${method}`);
    }
  }

  private rpcRuntimeCreate(socket: WebSocket, params: RuntimeCreateParams): unknown {
    const providerId = params.providerId;
    const runtime = ProviderRegistry.createChatRuntime({
      plugin: this.options.plugin,
      providerId,
    });

    const host: RuntimeHost = {
      runtimeId: generateId('rt'),
      providerId,
      runtime,
      seq: 0,
      buffer: [],
      ownerSocket: socket,
      lastSeen: Date.now(),
      queryRunning: false,
      lastConversation: null,
    };
    this.hosts.set(host.runtimeId, host);
    this.wireRuntimeCallbacks(host);
    this.options.log(`[praetord] runtime created: ${host.runtimeId} (${providerId})`);

    return { runtimeId: host.runtimeId, state: this.snapshot(host, { consume: false }) };
  }

  private rpcRuntimeAttach(socket: WebSocket, params: RuntimeAttachParams): unknown {
    const host = this.hosts.get(params.runtimeId);
    if (!host) return { found: false };

    host.ownerSocket = socket;
    host.lastSeen = Date.now();
    for (const entry of host.buffer) {
      if (entry.seq > params.fromSeq) {
        this.send(socket, { t: 'q.ev', runtimeId: host.runtimeId, seq: entry.seq, ev: entry.ev });
      }
    }
    return {
      found: true,
      state: this.snapshot(host, { consume: false }),
      queryActive: host.queryRunning,
    };
  }

  private async rpcRuntimeCall(params: RuntimeCallParams): Promise<unknown> {
    const host = this.requireHost(params.runtimeId);
    const method = params.method;
    if (!PROXIED_RUNTIME_METHODS.has(method) && method !== 'syncConversationState') {
      throw new Error(`Runtime method not allowed: ${method}`);
    }

    if (method === 'syncConversationState') {
      const [conversation, externalContextPaths] = (params.args ?? []) as [
        WireConversationState | null,
        string[] | undefined,
      ];
      host.lastConversation = conversation ?? null;
      host.runtime.syncConversationState(conversation, externalContextPaths);
      return null;
    }

    const runtime = host.runtime as unknown as Record<string, (...args: unknown[]) => unknown>;
    const fn = runtime[method];
    if (typeof fn !== 'function') {
      throw new Error(`Runtime method unavailable: ${method}`);
    }
    const result = fn.apply(host.runtime, params.args ?? []);
    return result instanceof Promise ? await result : result;
  }

  private rpcRuntimeQuery(params: RuntimeQueryParams): unknown {
    const host = this.requireHost(params.runtimeId);
    if (host.queryRunning) {
      throw new Error('A query is already running on this runtime');
    }

    const request = turnRequestFromWire(params.request);
    if (params.conversation !== undefined) {
      host.lastConversation = params.conversation ?? null;
      host.runtime.syncConversationState(params.conversation ?? null, params.externalContextPaths);
    }

    host.queryRunning = true;
    host.buffer = [];
    host.seq = 0;

    void (async () => {
      try {
        const prepared = host.runtime.prepareTurn(request);
        this.emit(host, { k: 'prepared', prepared: preparedTurnToWire(prepared) });

        const options = queryOptionsFromWire(params.options);
        for await (const chunk of host.runtime.query(prepared, params.history, options)) {
          this.emit(host, { k: 'chunk', chunk: jsonSafe(chunk) as typeof chunk });
        }
        this.emit(host, { k: 'state', state: this.snapshot(host, { consume: true }) });
        this.emit(host, { k: 'end' });
      } catch (err) {
        this.emit(host, { k: 'err', error: err instanceof Error ? err.message : String(err) });
      } finally {
        host.queryRunning = false;
      }
    })();

    return { accepted: true };
  }

  private async rpcHistoryHydrate(params: HistoryHydrateParams): Promise<unknown> {
    const conversation = conversationFromRef(params.conversation);
    await ProviderRegistry
      .getConversationHistoryService(params.providerId)
      .hydrateConversationHistory(conversation, this.options.vaultPath);

    for (const message of conversation.messages) {
      if (message.images) {
        for (const image of message.images) {
          if (image.data && image.data.length > 1_000_000) image.data = '';
        }
      }
    }

    return jsonSafe({
      messages: conversation.messages,
      usage: conversation.usage,
      providerState: conversation.providerState,
    });
  }

  private async rpcHistoryDelete(params: HistoryHydrateParams): Promise<unknown> {
    const conversation = conversationFromRef(params.conversation);
    await ProviderRegistry
      .getConversationHistoryService(params.providerId)
      .deleteConversationSession(conversation, this.options.vaultPath);
    return { ok: true };
  }

  private async rpcGenerateTitle(params: TitleGenerateParams): Promise<unknown> {
    const service = ProviderRegistry.createTitleGenerationService(
      this.options.plugin,
      params.providerId,
    );
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ error: 'Title generation timed out' }), 120_000);
      void service
        .generateTitle(params.conversationId, params.userMessage, async (_id, result) => {
          clearTimeout(timer);
          resolve(result.success ? { title: result.title } : { error: result.error });
        })
        .catch((err: unknown) => {
          clearTimeout(timer);
          resolve({ error: err instanceof Error ? err.message : String(err) });
        });
    });
  }

  // -------------------------------------------------------------------------

  private wireRuntimeCallbacks(host: RuntimeHost): void {
    const { runtime } = host;

    runtime.setApprovalCallback(async (toolName, input, description, options) => {
      const result = await this.bridgeCallback(host, 'approval', {
        toolName,
        input,
        description,
        options: jsonSafe(options),
      });
      return (result ?? 'deny') as Awaited<ReturnType<NonNullable<Parameters<ChatRuntime['setApprovalCallback']>[0]>>>;
    });

    runtime.setAskUserQuestionCallback(async (input) => {
      const result = await this.bridgeCallback(host, 'askUser', { input: jsonSafe(input) });
      return (result ?? null) as Record<string, string | string[]> | null;
    });

    runtime.setExitPlanModeCallback((async (...args: unknown[]) => {
      return this.bridgeCallback(host, 'exitPlanMode', { args: jsonSafe(args) });
    }) as Parameters<ChatRuntime['setExitPlanModeCallback']>[0]);

    runtime.setPermissionModeSyncCallback((mode) => {
      this.sendEvent(host, 'permissionModeSync', mode);
    });

    runtime.setAutoTurnCallback((result) => {
      this.sendEvent(host, 'autoTurn', jsonSafe(result));
    });

    runtime.onReadyStateChange((ready) => {
      this.sendEvent(host, 'ready', ready);
    });
  }

  private bridgeCallback(host: RuntimeHost, kind: 'approval' | 'askUser' | 'exitPlanMode', payload: unknown): Promise<unknown> {
    const socket = host.ownerSocket;
    if (!socket || socket.readyState !== socket.OPEN) {
      return Promise.resolve(null);
    }
    const cbId = this.nextCallbackId++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingCallbacks.delete(cbId);
        resolve(null);
      }, CALLBACK_TIMEOUT_MS);
      this.pendingCallbacks.set(cbId, { resolve, timer });
      this.send(socket, { t: 'cb', cbId, runtimeId: host.runtimeId, kind, payload });
    });
  }

  private emit(host: RuntimeHost, ev: QueryEvent): void {
    host.seq++;
    host.buffer.push({ seq: host.seq, ev });
    if (host.buffer.length > EVENT_BUFFER_CAP) {
      host.buffer.splice(0, host.buffer.length - EVENT_BUFFER_CAP);
    }
    const socket = host.ownerSocket;
    if (socket && socket.readyState === socket.OPEN) {
      this.send(socket, { t: 'q.ev', runtimeId: host.runtimeId, seq: host.seq, ev });
    }
  }

  private sendEvent(host: RuntimeHost, kind: 'ready' | 'permissionModeSync' | 'autoTurn' | 'disposed', payload: unknown): void {
    const socket = host.ownerSocket;
    if (socket && socket.readyState === socket.OPEN) {
      this.send(socket, { t: 'ev', runtimeId: host.runtimeId, kind, payload });
    }
  }

  private snapshot(host: RuntimeHost, opts: { consume: boolean }): RuntimeStateSnapshot {
    const { runtime } = host;
    let turnMetadata: ChatTurnMetadata | undefined;
    let sessionUpdates: Partial<Conversation> | undefined;
    let sessionInvalidated = false;

    if (opts.consume) {
      sessionInvalidated = safeCall(() => runtime.consumeSessionInvalidation()) ?? false;
      turnMetadata = safeCall(() => runtime.consumeTurnMetadata());
      sessionUpdates = safeCall(() => {
        const conversation = host.lastConversation
          ? (conversationFromRef({
            id: 'remote',
            providerId: host.providerId,
            sessionId: host.lastConversation.sessionId,
            providerState: host.lastConversation.providerState,
          }))
          : null;
        return runtime.buildSessionUpdates({ conversation, sessionInvalidated }).updates;
      });
    }

    return {
      sessionId: safeCall(() => runtime.getSessionId()) ?? null,
      isReady: safeCall(() => runtime.isReady()) ?? false,
      sessionInvalidated,
      turnMetadata: turnMetadata ? (jsonSafe(turnMetadata) as ChatTurnMetadata) : undefined,
      sessionUpdates: sessionUpdates ? (jsonSafe(sessionUpdates) as Partial<Conversation>) : undefined,
    };
  }

  private requireHost(runtimeId: string): RuntimeHost {
    const host = this.hosts.get(runtimeId);
    if (!host) {
      throw new Error(`Unknown runtime: ${runtimeId}`);
    }
    host.lastSeen = Date.now();
    return host;
  }

  private collectOrphans(): void {
    const now = Date.now();
    for (const [runtimeId, host] of this.hosts) {
      const orphaned = !host.ownerSocket || host.ownerSocket.readyState !== host.ownerSocket.OPEN;
      if (orphaned && !host.queryRunning && now - host.lastSeen > ORPHAN_GRACE_MS) {
        this.hosts.delete(runtimeId);
        try {
          host.runtime.cleanup();
        } catch {
          // disposed anyway
        }
        this.options.log(`[praetord] disposed orphaned runtime ${runtimeId}`);
      }
    }
  }

  private send(socket: WebSocket, msg: ServerMessage): void {
    try {
      socket.send(JSON.stringify(msg));
    } catch {
      // socket raced shut; reattach replays from the buffer
    }
  }

  private getRemoteAddress(socket: WebSocket): string | undefined {
    return (socket as unknown as { _socket?: { remoteAddress?: string } })._socket?.remoteAddress;
  }
}

const socketMeta = new WeakMap<WebSocket, { alive: boolean; authed: boolean }>();

function conversationFromRef(ref: WireConversationRef): Conversation {
  return {
    id: ref.id,
    providerId: ref.providerId,
    title: '',
    createdAt: ref.createdAt ?? Date.now(),
    updatedAt: Date.now(),
    sessionId: ref.sessionId,
    providerState: ref.providerState,
    messages: [],
  };
}

function safeCall<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

/** Strip functions/cycles so every payload survives JSON.stringify. */
function jsonSafe<T>(value: T): T {
  if (value === undefined || value === null) return value;
  try {
    return JSON.parse(JSON.stringify(value, (_key, v: unknown) => {
      if (typeof v === 'function') return undefined;
      if (v instanceof Set) return [...v];
      if (v instanceof Map) return Object.fromEntries(v);
      return v;
    })) as T;
  } catch {
    return value;
  }
}

export type { Server };
