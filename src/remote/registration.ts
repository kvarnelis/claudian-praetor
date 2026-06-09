/**
 * Remote provider registrations for mobile: same provider ids and chat UI
 * configuration as the local registrations, but runtimes/history/aux services
 * proxy to the Praetor daemon over WebSocket.
 *
 * Every import here must stay free of Node usage — this module loads on iOS.
 */

import { Notice } from 'obsidian';

import { ProviderRegistry } from '../core/providers/ProviderRegistry';
import { ProviderWorkspaceRegistry } from '../core/providers/ProviderWorkspaceRegistry';
import type {
  InlineEditResult,
  InlineEditService,
  InstructionRefineService,
  ProviderCapabilities,
  ProviderChatUIConfig,
  ProviderConversationHistoryService,
  ProviderId,
  ProviderRegistration,
  ProviderSettingsReconciler,
  ProviderTaskResultInterpreter,
  ProviderTaskTerminalStatus,
  TitleGenerationCallback,
  TitleGenerationService,
} from '../core/providers/types';
import type { Conversation, InstructionRefineResult } from '../core/types';
import type ClaudianPlugin from '../main';
import { CLAUDE_PROVIDER_CAPABILITIES } from '../providers/claude/capabilities';
import { claudeSettingsReconciler } from '../providers/claude/env/ClaudeSettingsReconciler';
import { claudeChatUIConfig } from '../providers/claude/ui/ClaudeChatUIConfig';
import { CODEX_PROVIDER_CAPABILITIES } from '../providers/codex/capabilities';
import { codexSettingsReconciler } from '../providers/codex/env/CodexSettingsReconciler';
import { getCodexProviderSettings } from '../providers/codex/settings';
import { codexChatUIConfig } from '../providers/codex/ui/CodexChatUIConfig';
import { grokSettingsReconciler } from '../providers/grok/app/GrokWorkspaceServices';
import { GROK_PROVIDER_CAPABILITIES } from '../providers/grok/capabilities';
import { getGrokProviderSettings } from '../providers/grok/settings';
import { grokChatUIConfig } from '../providers/grok/ui/GrokChatUIConfig';
import {
  type HistoryHydrateParams,
  type HistoryHydrateResult,
  type TitleGenerateParams,
  type TitleGenerateResult,
} from './protocol';
import { RemoteChatRuntime } from './RemoteChatRuntime';
import { RemoteClient } from './RemoteClient';

const sharedClient = new RemoteClient();
const liveRuntimes = new Set<RemoteChatRuntime>();

sharedClient.setReconnectedHook(() => {
  for (const runtime of liveRuntimes) {
    void runtime.reattach();
  }
});

export function getRemoteClient(): RemoteClient {
  return sharedClient;
}

function readRemoteConfig(plugin: ClaudianPlugin): { url: string; token: string } | null {
  // Registration runs before loadSettings(); settings may not exist yet.
  const settings = plugin.settings as unknown as Record<string, unknown> | undefined;
  const raw = settings?.remoteDaemon;
  if (!raw || typeof raw !== 'object') return null;
  const { url, token } = raw as { url?: unknown; token?: unknown };
  if (typeof url !== 'string' || !url.trim() || typeof token !== 'string') return null;
  return { url: url.trim(), token };
}

function createRemoteRuntime(plugin: ClaudianPlugin, providerId: ProviderId, capabilities: ProviderCapabilities): RemoteChatRuntime {
  const config = readRemoteConfig(plugin);
  if (config) {
    sharedClient.configure(config);
  }
  const runtime = new RemoteChatRuntime({
    client: sharedClient,
    providerId,
    capabilities,
    onDisposed: (self) => liveRuntimes.delete(self),
  });
  liveRuntimes.add(runtime);
  return runtime;
}

class RemoteConversationHistoryService implements ProviderConversationHistoryService {
  constructor(private readonly providerId: ProviderId) {}

  async hydrateConversationHistory(conversation: Conversation): Promise<void> {
    if (conversation.messages.length > 0) return;
    try {
      const params: HistoryHydrateParams = {
        providerId: this.providerId,
        conversation: {
          id: conversation.id,
          providerId: conversation.providerId,
          sessionId: conversation.sessionId,
          providerState: conversation.providerState,
          createdAt: conversation.createdAt,
        },
      };
      const result = await sharedClient.rpc<HistoryHydrateResult>('history.hydrate', params);
      if (Array.isArray(result.messages) && result.messages.length > 0) {
        conversation.messages = result.messages;
      }
      if (result.usage) conversation.usage = result.usage;
      if (result.providerState) conversation.providerState = result.providerState;
    } catch {
      // History stays empty when the daemon is unreachable; the conversation
      // list itself comes from vault-synced metadata and still renders.
    }
  }

  async deleteConversationSession(conversation: Conversation): Promise<void> {
    try {
      await sharedClient.rpc('history.delete', {
        providerId: this.providerId,
        conversation: {
          id: conversation.id,
          providerId: conversation.providerId,
          sessionId: conversation.sessionId,
          providerState: conversation.providerState,
        },
      } satisfies HistoryHydrateParams);
    } catch {
      // Provider transcripts live on the desktop; deletion is best-effort.
    }
  }

  resolveSessionIdForConversation(conversation: Conversation | null): string | null {
    return conversation?.sessionId ?? null;
  }

  isPendingForkConversation(): boolean {
    return false;
  }

  buildForkProviderState(
    sourceSessionId: string,
    resumeAt: string,
    sourceProviderState?: Record<string, unknown>,
  ): Record<string, unknown> {
    return {
      ...(sourceProviderState ?? {}),
      forkSource: { sessionId: sourceSessionId, resumeAt },
    };
  }
}

class RemoteTitleGenerationService implements TitleGenerationService {
  private cancelled = false;

  constructor(
    private readonly plugin: ClaudianPlugin,
    private readonly providerId: ProviderId,
  ) {}

  async generateTitle(
    conversationId: string,
    userMessage: string,
    callback: TitleGenerationCallback,
  ): Promise<void> {
    this.cancelled = false;
    try {
      const config = readRemoteConfig(this.plugin);
      if (config) sharedClient.configure(config);
      const result = await sharedClient.rpc<TitleGenerateResult>('aux.generateTitle', {
        providerId: this.providerId,
        conversationId,
        userMessage,
      } satisfies TitleGenerateParams);
      if (this.cancelled) return;
      if (result.title) {
        await callback(conversationId, { success: true, title: result.title });
      } else {
        await callback(conversationId, { success: false, error: result.error ?? 'Title generation failed' });
      }
    } catch (err) {
      if (this.cancelled) return;
      await callback(conversationId, {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  cancel(): void {
    this.cancelled = true;
  }
}

const REMOTE_UNAVAILABLE = 'This feature runs on the desktop runtime and is not available remotely yet.';

class RemoteInstructionRefineService implements InstructionRefineService {
  resetConversation(): void {
    // no conversation state client-side
  }

  async refineInstruction(): Promise<InstructionRefineResult> {
    return { success: false, error: REMOTE_UNAVAILABLE };
  }

  async continueConversation(): Promise<InstructionRefineResult> {
    return { success: false, error: REMOTE_UNAVAILABLE };
  }

  cancel(): void {
    // nothing in flight
  }
}

class RemoteInlineEditService implements InlineEditService {
  resetConversation(): void {
    // no conversation state client-side
  }

  async editText(): Promise<InlineEditResult> {
    return { success: false, error: REMOTE_UNAVAILABLE };
  }

  async continueConversation(): Promise<InlineEditResult> {
    return { success: false, error: REMOTE_UNAVAILABLE };
  }

  cancel(): void {
    // nothing in flight
  }
}

class RemoteTaskResultInterpreter implements ProviderTaskResultInterpreter {
  hasAsyncLaunchMarker(): boolean {
    return false;
  }

  extractAgentId(): string | null {
    return null;
  }

  extractStructuredResult(): string | null {
    return null;
  }

  resolveTerminalStatus(
    _toolUseResult: unknown,
    fallbackStatus: ProviderTaskTerminalStatus,
  ): ProviderTaskTerminalStatus {
    return fallbackStatus;
  }

  extractTagValue(): string | null {
    return null;
  }
}

interface RemoteProviderSpec {
  providerId: ProviderId;
  displayName: string;
  blankTabOrder: number;
  capabilities: ProviderCapabilities;
  chatUIConfig: ProviderChatUIConfig;
  settingsReconciler: ProviderSettingsReconciler;
  isEnabled: (settings: Record<string, unknown>) => boolean;
  environmentKeyPatterns?: RegExp[];
}

const REMOTE_PROVIDER_SPECS: RemoteProviderSpec[] = [
  {
    providerId: 'claude',
    displayName: 'Claude',
    blankTabOrder: 20,
    capabilities: CLAUDE_PROVIDER_CAPABILITIES,
    chatUIConfig: claudeChatUIConfig,
    settingsReconciler: claudeSettingsReconciler,
    isEnabled: () => true,
    environmentKeyPatterns: [/^ANTHROPIC_/i, /^CLAUDE_/i],
  },
  {
    providerId: 'codex',
    displayName: 'Codex',
    blankTabOrder: 15,
    capabilities: CODEX_PROVIDER_CAPABILITIES,
    chatUIConfig: codexChatUIConfig,
    settingsReconciler: codexSettingsReconciler,
    isEnabled: (settings) => getCodexProviderSettings(settings).enabled,
    environmentKeyPatterns: [/^OPENAI_/i, /^CODEX_/i],
  },
  {
    providerId: 'grok',
    displayName: 'Grok',
    blankTabOrder: 18,
    capabilities: GROK_PROVIDER_CAPABILITIES,
    chatUIConfig: grokChatUIConfig,
    settingsReconciler: grokSettingsReconciler,
    isEnabled: (settings) => getGrokProviderSettings(settings).enabled,
    environmentKeyPatterns: [/^GROK_/i, /^XAI_/i],
  },
];

let remoteProvidersRegistered = false;

export function registerRemoteProviders(plugin: ClaudianPlugin): void {
  if (remoteProvidersRegistered) return;

  const config = readRemoteConfig(plugin);
  if (config) {
    sharedClient.configure(config);
  } else {
    new Notice('Claudian Praetor: remote daemon is not configured. Set remoteDaemon.url and remoteDaemon.token in .claudian/claudian-settings.json on any synced device.', 10_000);
  }

  for (const spec of REMOTE_PROVIDER_SPECS) {
    const registration: ProviderRegistration = {
      displayName: spec.displayName,
      blankTabOrder: spec.blankTabOrder,
      isEnabled: spec.isEnabled,
      capabilities: spec.capabilities,
      environmentKeyPatterns: spec.environmentKeyPatterns,
      chatUIConfig: spec.chatUIConfig,
      settingsReconciler: spec.settingsReconciler,
      createRuntime: ({ plugin: runtimePlugin }) =>
        createRemoteRuntime(runtimePlugin, spec.providerId, spec.capabilities),
      createTitleGenerationService: (titlePlugin) =>
        new RemoteTitleGenerationService(titlePlugin, spec.providerId),
      createInstructionRefineService: () => new RemoteInstructionRefineService(),
      createInlineEditService: () => new RemoteInlineEditService(),
      historyService: new RemoteConversationHistoryService(spec.providerId),
      taskResultInterpreter: new RemoteTaskResultInterpreter(),
    };

    ProviderRegistry.register(spec.providerId, registration);
    ProviderWorkspaceRegistry.register(spec.providerId, {
      initialize: async () => ({}),
    });
  }

  remoteProvidersRegistered = true;
}
