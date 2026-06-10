import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import type { ProviderSettingsReconciler } from '../../../core/providers/types';
import type { Conversation } from '../../../core/types';
import { parseEnvironmentVariables } from '../../../utils/env';
import { grokChatUIConfig } from '../ui/GrokChatUIConfig';

// Lives in its own leaf module (mirroring Claude/Codex) so the mobile remote
// registration can import it without dragging the Node-heavy Grok runtime,
// history, and settings-tab modules into the mobile bundle graph.
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
