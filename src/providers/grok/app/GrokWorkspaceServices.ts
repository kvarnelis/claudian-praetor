import type {
  ProviderRegistration,
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
import { GrokConversationHistoryService } from '../history/GrokConversationHistoryService';
import { GrokChatRuntime } from '../runtime/GrokChatRuntime';
import { GrokCliResolver } from '../runtime/GrokCliResolver';
import { getGrokProviderSettings } from '../settings';
import { grokChatUIConfig } from '../ui/GrokChatUIConfig';
import { grokSettingsTabRenderer } from '../ui/GrokSettingsTab';

export { grokSettingsReconciler } from '../env/GrokSettingsReconciler';

export function createGrokWorkspaceServices(): ProviderWorkspaceServices {
  return {
    cliResolver: new GrokCliResolver(),
    settingsTabRenderer: grokSettingsTabRenderer,
  };
}

export const grokWorkspaceRegistration: ProviderWorkspaceRegistration = {
  initialize: async () => createGrokWorkspaceServices(),
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
