import type { ProviderHost } from '../../../core/providers/ProviderHost';
import type {
  ProviderModule,
  ProviderWorkspaceRegistration,
  ProviderWorkspaceServices,
} from '../../../core/providers/types';
import {
  GrokInlineEditService,
  GrokInstructionRefineService,
  GrokTaskResultInterpreter,
  GrokTitleGenerationService,
} from '../auxiliary/GrokAuxiliaryServices';
import { GROK_PROVIDER_CAPABILITIES } from '../capabilities';
import { grokSettingsReconciler } from '../env/GrokSettingsReconciler';
import { setGrokModelCatalog } from '../grokModelCatalog';
import { GrokConversationHistoryService } from '../history/GrokConversationHistoryService';
import { GrokModelListingService } from '../models/GrokModelListingService';
import { GrokChatRuntime } from '../runtime/GrokChatRuntime';
import { GrokCliResolver } from '../runtime/GrokCliResolver';
import {
  getGrokProviderSettings,
  updateGrokProviderSettings,
} from '../settings';
import { grokChatUIConfig } from '../ui/GrokChatUIConfig';
import { grokSettingsTabRenderer } from '../ui/GrokSettingsTab';

export { grokSettingsReconciler } from '../env/GrokSettingsReconciler';

export function createGrokWorkspaceServices(plugin: ProviderHost): ProviderWorkspaceServices {
  if (getGrokProviderSettings(plugin.settings).enabled) {
    const modelListProvider = new GrokModelListingService(plugin);
    void modelListProvider.listModels()
      .then(setGrokModelCatalog)
      .catch(() => {
        // Non-critical: the selector falls back to GROK_MODELS.
      });
  }

  return {
    cliResolver: new GrokCliResolver(),
    settingsTabRenderer: grokSettingsTabRenderer,
  };
}

export const grokWorkspaceRegistration: ProviderWorkspaceRegistration = {
  initialize: async ({ plugin }) => createGrokWorkspaceServices(plugin),
};

export const grokProviderRegistration: ProviderModule = {
  id: 'grok',
  displayName: 'Grok',
  blankTabOrder: 18,
  isEnabled: (settings) => getGrokProviderSettings(settings).enabled,
  setEnabled: (settings, enabled) => updateGrokProviderSettings(settings, { enabled }),
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
  settingsStorage: {
    hostScopedFields: ['cliPathsByHost'],
    legacyTopLevelFields: ['grokEnabled'],
    normalizeStored(target, stored) {
      updateGrokProviderSettings(target, getGrokProviderSettings(stored));
      return false;
    },
  },
  workspace: grokWorkspaceRegistration,
};
