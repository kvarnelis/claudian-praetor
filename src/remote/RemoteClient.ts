/**
 * WebSocket client for the Praetor daemon. Platform-pure: relies on the
 * global WebSocket available in Obsidian's webview (and Node >= 22 for tests).
 *
 * One client is shared by all remote runtimes; it owns reconnection, RPC
 * correlation, and fan-out of per-runtime stream events and callbacks.
 */

import {
  type CallbackKind,
  type ClientMessage,
  generateId,
  PRAETOR_PROTOCOL_VERSION,
  type QueryEvent,
  type ServerMessage,
} from './protocol';

export interface RemoteClientConfig {
  url: string;
  token: string;
}

export interface DaemonInfo {
  daemonVersion: string;
  vaultPath: string;
  vaultName: string;
  providers: string[];
}

type QueryEventHandler = (seq: number, ev: QueryEvent) => void;
type RuntimeEventHandler = (kind: string, payload: unknown) => void;
type CallbackHandler = (kind: CallbackKind, payload: unknown) => Promise<unknown>;
type ConnectionListener = (state: RemoteConnectionState) => void;

export type RemoteConnectionState = 'disconnected' | 'connecting' | 'connected';

interface PendingRpc {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
}

const RECONNECT_BASE_MS = 800;
const RECONNECT_MAX_MS = 15_000;
const RPC_TIMEOUT_MS = 120_000;
// How long a caller waits for the socket to come up before failing with a
// clear "can't reach the daemon" error instead of hanging forever (the silent
// hang that looks like "endlessly gathering thoughts" when Tailscale is off or
// the Mac daemon isn't running).
const CONNECT_TIMEOUT_MS = 12_000;

export class RemoteClient {
  readonly clientId = generateId('client');

  private config: RemoteClientConfig | null = null;
  private ws: WebSocket | null = null;
  private state: RemoteConnectionState = 'disconnected';
  private helloDone = false;
  private daemonInfo: DaemonInfo | null = null;

  private nextRpcId = 1;
  private pendingRpcs = new Map<number, PendingRpc>();

  private queryHandlers = new Map<string, QueryEventHandler>();
  private runtimeEventHandlers = new Map<string, RuntimeEventHandler>();
  private callbackHandlers = new Map<string, CallbackHandler>();
  private connectionListeners = new Set<ConnectionListener>();
  private onReconnected: (() => void) | null = null;

  private reconnectAttempt = 0;
  private reconnectTimer: number | null = null;
  private closedByUser = false;
  private connectWaiters: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];

  configure(config: RemoteClientConfig): void {
    const changed = !this.config
      || this.config.url !== config.url
      || this.config.token !== config.token;
    this.config = config;
    if (changed && this.ws) {
      this.teardownSocket();
      this.scheduleReconnect(0);
    }
  }

  getDaemonInfo(): DaemonInfo | null {
    return this.daemonInfo;
  }

  getState(): RemoteConnectionState {
    return this.state;
  }

  onConnectionChange(listener: ConnectionListener): () => void {
    this.connectionListeners.add(listener);
    return () => this.connectionListeners.delete(listener);
  }

  /** Invoked after a successful re-handshake so runtimes can re-attach. */
  setReconnectedHook(hook: (() => void) | null): void {
    this.onReconnected = hook;
  }

  setQueryEventHandler(runtimeId: string, handler: QueryEventHandler | null): void {
    if (handler) this.queryHandlers.set(runtimeId, handler);
    else this.queryHandlers.delete(runtimeId);
  }

  setRuntimeEventHandler(runtimeId: string, handler: RuntimeEventHandler | null): void {
    if (handler) this.runtimeEventHandlers.set(runtimeId, handler);
    else this.runtimeEventHandlers.delete(runtimeId);
  }

  setCallbackHandler(runtimeId: string, handler: CallbackHandler | null): void {
    if (handler) this.callbackHandlers.set(runtimeId, handler);
    else this.callbackHandlers.delete(runtimeId);
  }

  async ensureConnected(): Promise<void> {
    if (this.state === 'connected' && this.helloDone) return;
    if (!this.config?.url || !this.config?.token) {
      throw new Error('Remote daemon is not configured. Set the daemon URL and token under "Remote daemon" in Claudian Praetor settings.');
    }

    this.closedByUser = false;
    if (this.state === 'disconnected') {
      this.openSocket();
    }

    await new Promise<void>((resolve, reject) => {
      const waiter = { resolve, reject };
      const timeout = setTimeout(() => {
        this.connectWaiters = this.connectWaiters.filter((w) => w !== waiter);
        reject(new Error(
          `Can't reach the daemon at ${this.config?.url}. Check that Tailscale is connected on this device and that the Praetor daemon is running on your Mac.`,
        ));
      }, CONNECT_TIMEOUT_MS);
      waiter.resolve = () => { clearTimeout(timeout); resolve(); };
      waiter.reject = (e: Error) => { clearTimeout(timeout); reject(e); };
      this.connectWaiters.push(waiter);
    });
  }

  async rpc<TResult>(method: string, params: unknown): Promise<TResult> {
    await this.ensureConnected();
    const id = this.nextRpcId++;
    const msg: ClientMessage = { t: 'rpc', id, method, params };

    return new Promise<TResult>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pendingRpcs.delete(id);
        reject(new Error(`Remote call ${method} timed out`));
      }, RPC_TIMEOUT_MS);

      this.pendingRpcs.set(id, {
        resolve: (result) => {
          window.clearTimeout(timer);
          resolve(result as TResult);
        },
        reject: (error) => {
          window.clearTimeout(timer);
          reject(error);
        },
      });
      this.send(msg);
    });
  }

  /** Fire-and-forget message (e.g. q.cancel). */
  notify(msg: ClientMessage): void {
    this.send(msg);
  }

  close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.teardownSocket();
    this.setState('disconnected');
  }

  // -------------------------------------------------------------------------

  private openSocket(): void {
    if (!this.config) return;
    this.setState('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.config.url);
    } catch (err) {
      this.failWaiters(err instanceof Error ? err : new Error(String(err)));
      this.setState('disconnected');
      return;
    }

    this.ws = ws;
    ws.onopen = () => {
      if (!this.config) return;
      const hello: ClientMessage = {
        t: 'hello',
        proto: PRAETOR_PROTOCOL_VERSION,
        token: this.config.token,
        clientId: this.clientId,
      };
      ws.send(JSON.stringify(hello));
    };
    ws.onmessage = (event) => {
      this.handleMessage(String(event.data));
    };
    ws.onclose = () => {
      this.handleDisconnect();
    };
    ws.onerror = () => {
      // onclose follows; nothing to do here
    };
  }

  private handleMessage(raw: string): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(raw) as ServerMessage;
    } catch {
      return;
    }

    switch (msg.t) {
      case 'hello.ok': {
        this.helloDone = true;
        this.daemonInfo = {
          daemonVersion: msg.daemonVersion,
          vaultPath: msg.vaultPath,
          vaultName: msg.vaultName,
          providers: msg.providers,
        };
        const wasReconnect = this.reconnectAttempt > 0;
        this.reconnectAttempt = 0;
        this.setState('connected');
        for (const waiter of this.connectWaiters.splice(0)) waiter.resolve();
        if (wasReconnect) this.onReconnected?.();
        break;
      }
      case 'hello.err': {
        this.closedByUser = true; // bad token: don't retry-loop
        this.failWaiters(new Error(`Daemon rejected connection: ${msg.error}`));
        this.teardownSocket();
        this.setState('disconnected');
        break;
      }
      case 'rpc.ok': {
        const pending = this.pendingRpcs.get(msg.id);
        this.pendingRpcs.delete(msg.id);
        pending?.resolve(msg.result);
        break;
      }
      case 'rpc.err': {
        const pending = this.pendingRpcs.get(msg.id);
        this.pendingRpcs.delete(msg.id);
        pending?.reject(new Error(msg.error));
        break;
      }
      case 'q.ev': {
        this.queryHandlers.get(msg.runtimeId)?.(msg.seq, msg.ev);
        break;
      }
      case 'cb': {
        void this.dispatchCallback(msg.cbId, msg.runtimeId, msg.kind, msg.payload);
        break;
      }
      case 'ev': {
        this.runtimeEventHandlers.get(msg.runtimeId)?.(msg.kind, msg.payload);
        break;
      }
    }
  }

  private async dispatchCallback(
    cbId: number,
    runtimeId: string,
    kind: CallbackKind,
    payload: unknown,
  ): Promise<void> {
    const handler = this.callbackHandlers.get(runtimeId);
    let result: unknown = null;
    if (handler) {
      try {
        result = await handler(kind, payload);
      } catch {
        result = null;
      }
    }
    this.send({ t: 'cb.res', cbId, result });
  }

  private handleDisconnect(): void {
    this.teardownSocket();
    const error = new Error('Connection to the Praetor daemon was lost');
    for (const pending of this.pendingRpcs.values()) pending.reject(error);
    this.pendingRpcs.clear();
    this.setState('disconnected');

    if (!this.closedByUser) {
      this.scheduleReconnect();
    } else {
      this.failWaiters(error);
    }
  }

  private scheduleReconnect(delayOverride?: number): void {
    if (this.reconnectTimer) return;
    const delay = delayOverride ?? Math.min(
      RECONNECT_MAX_MS,
      RECONNECT_BASE_MS * 2 ** Math.min(this.reconnectAttempt, 5),
    );
    this.reconnectAttempt++;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closedByUser) this.openSocket();
    }, delay);
  }

  private teardownSocket(): void {
    this.helloDone = false;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
      try {
        ws.close();
      } catch {
        // already closed
      }
    }
  }

  private setState(state: RemoteConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    for (const listener of this.connectionListeners) {
      try {
        listener(state);
      } catch {
        // listener errors must not break the client
      }
    }
  }

  private failWaiters(error: Error): void {
    for (const waiter of this.connectWaiters.splice(0)) waiter.reject(error);
  }

  private send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}
