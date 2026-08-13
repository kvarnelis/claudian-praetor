/**
 * Wire protocol shared by the Claude's Codex daemon (Mac host) and RemoteChatRuntime
 * (mobile client). JSON messages over a single WebSocket.
 *
 * This module must stay dependency-light and platform-pure: no Node, no
 * Obsidian imports — it is bundled into both the plugin and the daemon.
 */

import type {
  ChatRuntimeQueryOptions,
  ChatTurnMetadata,
  ChatTurnRequest,
  PreparedChatTurn,
} from '../core/runtime/types';
import type { ChatMessage, Conversation, StreamChunk, UsageInfo } from '../core/types';

export const CLAUDES_CODEX_PROTOCOL_VERSION = 1;
export const DEFAULT_DAEMON_PORT = 8423;

// ---------------------------------------------------------------------------
// Set-free DTOs (Set is not JSON-serializable)
// ---------------------------------------------------------------------------

export interface WireTurnRequest extends Omit<ChatTurnRequest, 'enabledMcpServers'> {
  enabledMcpServers?: string[];
}

export interface WirePreparedTurn extends Omit<PreparedChatTurn, 'request' | 'mcpMentions'> {
  request: WireTurnRequest;
  mcpMentions: string[];
}

export interface WireQueryOptions extends Omit<ChatRuntimeQueryOptions, 'mcpMentions' | 'enabledMcpServers'> {
  mcpMentions?: string[];
  enabledMcpServers?: string[];
}

export function turnRequestToWire(request: ChatTurnRequest): WireTurnRequest {
  return {
    ...request,
    enabledMcpServers: request.enabledMcpServers ? [...request.enabledMcpServers] : undefined,
  };
}

export function turnRequestFromWire(wire: WireTurnRequest): ChatTurnRequest {
  return {
    ...wire,
    enabledMcpServers: wire.enabledMcpServers ? new Set(wire.enabledMcpServers) : undefined,
  };
}

export function preparedTurnToWire(turn: PreparedChatTurn): WirePreparedTurn {
  return {
    ...turn,
    request: turnRequestToWire(turn.request),
    mcpMentions: [...turn.mcpMentions],
  };
}

export function preparedTurnFromWire(wire: WirePreparedTurn): PreparedChatTurn {
  return {
    ...wire,
    request: turnRequestFromWire(wire.request),
    mcpMentions: new Set(wire.mcpMentions),
  };
}

export function queryOptionsToWire(options?: ChatRuntimeQueryOptions): WireQueryOptions | undefined {
  if (!options) return undefined;
  return {
    ...options,
    mcpMentions: options.mcpMentions ? [...options.mcpMentions] : undefined,
    enabledMcpServers: options.enabledMcpServers ? [...options.enabledMcpServers] : undefined,
  };
}

export function queryOptionsFromWire(wire?: WireQueryOptions): ChatRuntimeQueryOptions | undefined {
  if (!wire) return undefined;
  return {
    ...wire,
    mcpMentions: wire.mcpMentions ? new Set(wire.mcpMentions) : undefined,
    enabledMcpServers: wire.enabledMcpServers ? new Set(wire.enabledMcpServers) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Runtime state mirror
// ---------------------------------------------------------------------------

/** Snapshot of server-side runtime state, pushed after lifecycle transitions. */
export interface RuntimeStateSnapshot {
  sessionId: string | null;
  isReady: boolean;
  /** Consume-once flag accumulated server-side since the last snapshot. */
  sessionInvalidated: boolean;
  turnMetadata?: ChatTurnMetadata;
  /** Result of buildSessionUpdates() computed server-side at turn end. */
  sessionUpdates?: Partial<Conversation>;
}

/** Conversation fields the server needs to sync/resume a session. */
export interface WireConversationState {
  sessionId: string | null;
  providerState?: Record<string, unknown>;
}

export interface WireConversationRef {
  id: string;
  providerId: string;
  sessionId: string | null;
  providerState?: Record<string, unknown>;
  createdAt?: number;
}

// ---------------------------------------------------------------------------
// Query stream events (server → client, per runtime, sequence-numbered)
// ---------------------------------------------------------------------------

export type QueryEvent =
  | { k: 'accepted' }
  | { k: 'prepared'; prepared: WirePreparedTurn }
  | { k: 'chunk'; chunk: StreamChunk }
  | { k: 'state'; state: RuntimeStateSnapshot }
  | { k: 'end' }
  | { k: 'err'; error: string };

// ---------------------------------------------------------------------------
// Callback bridging (server → client request, client → server response)
// ---------------------------------------------------------------------------

export type CallbackKind = 'approval' | 'askUser' | 'exitPlanMode';

export interface ApprovalCallbackPayload {
  toolName: string;
  input: Record<string, unknown>;
  description: string;
  options?: unknown;
}

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

export type ClientMessage =
  | { t: 'hello'; proto: number; clientId: string; clientInfo?: string }
  | { t: 'rpc'; id: number; method: string; params: unknown }
  | { t: 'cb.res'; cbId: number; result: unknown }
  | { t: 'q.cancel'; runtimeId: string };

export type ServerMessage =
  | { t: 'hello.ok'; proto: number; daemonVersion: string; vaultPath: string; vaultName: string; providers: string[] }
  | { t: 'hello.err'; error: string }
  | { t: 'rpc.ok'; id: number; result: unknown }
  | { t: 'rpc.err'; id: number; error: string }
  | { t: 'q.ev'; runtimeId: string; seq: number; ev: QueryEvent }
  | { t: 'cb'; cbId: number; runtimeId: string; kind: CallbackKind; payload: unknown }
  | { t: 'ev'; runtimeId: string; kind: 'ready' | 'permissionModeSync' | 'autoTurn' | 'disposed'; payload: unknown };

// ---------------------------------------------------------------------------
// RPC method params/results
// ---------------------------------------------------------------------------

export interface RuntimeCreateParams {
  providerId: string;
}
export interface RuntimeCreateResult {
  runtimeId: string;
  state: RuntimeStateSnapshot;
}

export interface RuntimeAttachParams {
  runtimeId: string;
  /** Last query-event sequence number the client saw; server replays from seq+1. */
  fromSeq: number;
}
export interface RuntimeAttachResult {
  found: boolean;
  state?: RuntimeStateSnapshot;
  /** True if a query stream is still active (replay + live events will follow). */
  queryActive?: boolean;
}

export interface RuntimeCallParams {
  runtimeId: string;
  method: string;
  args?: unknown[];
}

export interface RuntimeQueryParams {
  runtimeId: string;
  request: WireTurnRequest;
  /** Optional client-prepared turn (server re-prepares authoritatively when absent). */
  prepared?: WirePreparedTurn;
  history?: ChatMessage[];
  options?: WireQueryOptions;
  conversation?: WireConversationState | null;
  externalContextPaths?: string[];
}

export interface HistoryHydrateParams {
  providerId: string;
  conversation: WireConversationRef;
}
export interface HistoryHydrateResult {
  messages: ChatMessage[];
  usage?: UsageInfo;
  providerState?: Record<string, unknown>;
}

export interface TitleGenerateParams {
  providerId: string;
  conversationId: string;
  userMessage: string;
}
export interface TitleGenerateResult {
  title?: string;
  error?: string;
}

/** Runtime methods proxied verbatim through `runtime.call`. */
export const PROXIED_RUNTIME_METHODS = new Set([
  'ensureReady',
  'resetSession',
  'setResumeCheckpoint',
  'reloadMcpServers',
  'getSupportedCommands',
  'getSessionId',
  'getAuxiliaryModel',
  'cancel',
  'steer',
  'rewind',
  'loadSubagentToolCalls',
  'loadSubagentFinalResult',
]);

export function generateId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
