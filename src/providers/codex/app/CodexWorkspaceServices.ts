import type { ProviderCommandCatalog } from '../../../core/providers/commands/ProviderCommandCatalog';
import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import type {
  ProviderCliResolver,
  ProviderWorkspaceRegistration,
  ProviderWorkspaceServices,
} from '../../../core/providers/types';
import { HomeFileAdapter } from '../../../core/storage/HomeFileAdapter';
import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import type ClaudianPlugin from '../../../main';
import { getVaultPath } from '../../../utils/path';
import { CodexAgentMentionProvider } from '../agents/CodexAgentMentionProvider';
import { setCodexModelCatalog } from '../codexModelCatalog';
import { CodexSkillCatalog } from '../commands/CodexSkillCatalog';
import { CodexModelListingService } from '../models/CodexModelListingService';
import { CodexCliResolver } from '../runtime/CodexCliResolver';
import { getCodexProviderSettings } from '../settings';
import { CodexSkillListingService } from '../skills/CodexSkillListingService';
import { CodexSkillStorage } from '../storage/CodexSkillStorage';
import { CodexSubagentStorage } from '../storage/CodexSubagentStorage';
import { codexSettingsTabRenderer } from '../ui/CodexSettingsTab';

export interface CodexWorkspaceServices extends ProviderWorkspaceServices {
  subagentStorage: CodexSubagentStorage;
  commandCatalog: ProviderCommandCatalog;
  agentMentionProvider: CodexAgentMentionProvider;
  cliResolver: ProviderCliResolver;
}

function createCodexCliResolver(): ProviderCliResolver {
  return new CodexCliResolver();
}

export async function createCodexWorkspaceServices(
  plugin: ClaudianPlugin,
  vaultAdapter: VaultFileAdapter,
  homeAdapter: HomeFileAdapter,
): Promise<CodexWorkspaceServices> {
  const subagentStorage = new CodexSubagentStorage(vaultAdapter);
  const agentMentionProvider = new CodexAgentMentionProvider(subagentStorage);
  await agentMentionProvider.loadAgents();

  if (getCodexProviderSettings(plugin.settings).enabled) {
    const modelListProvider = new CodexModelListingService(plugin);
    void modelListProvider.listModels()
      .then(models => setCodexModelCatalog(models.filter(model => !model.hidden)))
      .catch(() => {
        // Non-critical: the selector falls back to DEFAULT_CODEX_MODELS.
      });
  }

  const skillListProvider = new CodexSkillListingService(plugin);
  const commandCatalog = new CodexSkillCatalog(
    new CodexSkillStorage(
      vaultAdapter,
      homeAdapter,
    ),
    skillListProvider,
    getVaultPath(plugin.app),
  );

  return {
    subagentStorage,
    commandCatalog,
    agentMentionProvider,
    cliResolver: createCodexCliResolver(),
    settingsTabRenderer: codexSettingsTabRenderer,
    refreshAgentMentions: async () => {
      await agentMentionProvider.loadAgents();
    },
  };
}

export const codexWorkspaceRegistration: ProviderWorkspaceRegistration<CodexWorkspaceServices> = {
  initialize: async ({ plugin, vaultAdapter, homeAdapter }) => createCodexWorkspaceServices(
    plugin,
    vaultAdapter,
    // Local registrations only initialize on desktop; mobile registers remote services.
    homeAdapter ?? new HomeFileAdapter(),
  ),
};

export function maybeGetCodexWorkspaceServices(): CodexWorkspaceServices | null {
  return ProviderWorkspaceRegistry.getServices('codex') as CodexWorkspaceServices | null;
}

export function getCodexWorkspaceServices(): CodexWorkspaceServices {
  return ProviderWorkspaceRegistry.requireServices('codex') as CodexWorkspaceServices;
}
