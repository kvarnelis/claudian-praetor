import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import type {
  ProviderRegistration,
  ProviderSettingsReconciler,
  ProviderWorkspaceRegistration,
  ProviderWorkspaceServices,
} from '../../../core/providers/types';
import type { Conversation } from '../../../core/types';
import { parseEnvironmentVariables } from '../../../utils/env';
import {
  GrokInlineEditService,
  GrokInstructionRefineService,
  GrokTaskResultInterpreter,
  GrokTitleGenerationService,
} from '../auxiliary/GrokAuxiliaryServices';
import { GROK_PROVIDER_CAPABILITIES } from '../capabilities';
import { GrokConversationHistoryService } from '../history/GrokConversationHistoryService';
import { GrokChatRuntime } from '../runtime/GrokChatRuntime';
import { GrokCliResolver } from '../runtime/GrokCliResolver';
import { getGrokProviderSettings } from '../settings';
import { grokChatUIConfig } from '../ui/GrokChatUIConfig';
import { grokSettingsTabRenderer } from '../ui/GrokSettingsTab';

export function createGrokWorkspaceServices(): ProviderWorkspaceServices {
  return {
    cliResolver: new GrokCliResolver(),
    settingsTabRenderer: grokSettingsTabRenderer,
  };
}

export const grokWorkspaceRegistration: ProviderWorkspaceRegistration = {
  initialize: async () => createGrokWorkspaceServices(),
};

export const grokSettingsReconciler: ProviderSettingsReconciler = {
  reconcileModelWithEnvironment(
    settings: Record<string, unknown>,
  ): { changed: boolean; invalidatedConversations: Conversation[] } {
    const envVars = parseEnvironmentVariables(getRuntimeEnvironmentText(settings, 'grok'));
    const envModel = envVars.GROK_MODEL || envVars.XAI_MODEL;
    if (envModel && settings.model !== envModel) {
      settings.model = envModel;
      return { changed: true, invalidatedConversations: [] };
    }
    return { changed: false, invalidatedConversations: [] };
  },

  normalizeModelVariantSettings(settings: Record<string, unknown>): boolean {
    const model = settings.model as string;
    if (!model) {
      return false;
    }

    const normalizedModel = grokChatUIConfig.normalizeModelVariant(model, settings);
    if (normalizedModel === model) {
      return false;
    }

    settings.model = normalizedModel;
    return true;
  },
};

export const grokProviderRegistration: ProviderRegistration = {
  displayName: 'Grok',
  blankTabOrder: 18,
  isEnabled: (settings) => getGrokProviderSettings(settings).enabled,
  capabilities: GROK_PROVIDER_CAPABILITIES,
  environmentKeyPatterns: [/^GROK_/i, /^XAI_/i],
  chatUIConfig: grokChatUIConfig,
  settingsReconciler: grokSettingsReconciler,
  createRuntime: ({ plugin }) => new GrokChatRuntime(plugin),
  createTitleGenerationService: (plugin) => new GrokTitleGenerationService(plugin),
  createInstructionRefineService: (plugin) => new GrokInstructionRefineService(plugin),
  createInlineEditService: (plugin) => new GrokInlineEditService(plugin),
  historyService: new GrokConversationHistoryService(),
  taskResultInterpreter: new GrokTaskResultInterpreter(),
};
