import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';

const mockDiscoverModels = jest.fn();

jest.mock('@/providers/codex/runtime/CodexModelDiscoveryService', () => ({
  CodexModelDiscoveryService: jest.fn().mockImplementation(() => ({
    discoverModels: mockDiscoverModels,
  })),
}));

import { ProviderWorkspaceRegistry } from '@/core/providers/ProviderWorkspaceRegistry';
import { registerBuiltInProviders } from '@/providers';

import {
  createHeadlessPlugin,
  getSettingsWatchTarget,
} from '../../../daemon/src/headlessPlugin';
import { createNodeVaultApp } from '../../../daemon/src/nodeVaultApp';

describe('daemon headless plugin', () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(path.join(os.tmpdir(), 'pocket-codex-headless-'));
    registerBuiltInProviders();
    mockDiscoverModels.mockResolvedValue({
      kind: 'completed',
      models: [{
        model: 'gpt-current',
        displayName: 'GPT Current',
        description: 'Current test model',
        supportedReasoningEfforts: [{ value: 'medium', description: 'Balanced' }],
        defaultReasoningEffort: 'medium',
        serviceTiers: [],
        defaultServiceTier: null,
        inputModalities: ['text'],
        isDefault: true,
      }],
    });
  });

  afterEach(() => {
    ProviderWorkspaceRegistry.clear();
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it('initializes bundled provider workspaces without forcing Codex model discovery', async () => {
    const settingsDir = path.join(vaultPath, '.claudian');
    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(path.join(settingsDir, 'claudian-settings.json'), JSON.stringify({
      providerConfigs: { codex: { enabled: true } },
    }));
    const handle = await createHeadlessPlugin({
      app: createNodeVaultApp(vaultPath),
      vaultPath,
    });

    try {
      await expect(ProviderWorkspaceRegistry.initializeAll(handle.plugin))
        .resolves.toBeUndefined();
      expect(mockDiscoverModels).not.toHaveBeenCalled();
    } finally {
      handle.dispose();
    }
  });

  it('watches the Pocket Codex-owned settings file', () => {
    expect(getSettingsWatchTarget(vaultPath)).toEqual({
      directory: path.join(vaultPath, '.claudian'),
      fileName: 'pocket-codex-settings.json',
    });
  });

  it('supports the complete provider host surface used by bundled providers', async () => {
    const handle = await createHeadlessPlugin({
      app: createNodeVaultApp(vaultPath),
      vaultPath,
    });

    try {
      for (const member of [
        'saveSettings',
        'mutateSettings',
        'mutateSettingsConditionally',
        'loadData',
        'saveData',
        'normalizeModelVariantSettings',
        'getActiveEnvironmentVariables',
        'getEnvironmentVariablesForScope',
        'applyEnvironmentVariables',
        'applyEnvironmentVariablesBatch',
        'getResolvedProviderCliPath',
        'refreshModelSelectors',
        'broadcastToActiveViewRuntimes',
        'broadcastToAllViewRuntimes',
        'recycleProviderRuntimes',
      ]) {
        expect(() => (handle.plugin as unknown as Record<string, unknown>)[member])
          .not.toThrow();
      }
    } finally {
      handle.dispose();
    }
  });

  it('persists conditional mutations without dropping sibling provider settings', async () => {
    const settingsDir = path.join(vaultPath, '.claudian');
    const sharedSettingsPath = path.join(settingsDir, 'claudian-settings.json');
    const ownSettingsPath = path.join(settingsDir, 'pocket-codex-settings.json');
    mkdirSync(settingsDir, { recursive: true });
    const sharedContent = JSON.stringify({
      providerConfigs: {
        codex: { enabled: false, visibleModels: ['gpt-existing'] },
        opencode: { enabled: true, selectedMode: 'praetor-yolo' },
      },
    });
    writeFileSync(sharedSettingsPath, sharedContent);
    const handle = await createHeadlessPlugin({
      app: createNodeVaultApp(vaultPath),
      vaultPath,
    });

    try {
      await handle.plugin.mutateSettingsConditionally((settings) => {
        settings.providerConfigs.codex = {
          ...settings.providerConfigs.codex,
          visibleModels: ['gpt-current'],
        };
        return true;
      });

      const persisted = JSON.parse(readFileSync(ownSettingsPath, 'utf-8')) as {
        providerConfigs: Record<string, Record<string, unknown>>;
      };
      expect(persisted.providerConfigs.codex.visibleModels).toEqual(['gpt-current']);
      expect(persisted.providerConfigs.opencode).toEqual(expect.objectContaining({
        enabled: true,
        selectedMode: 'praetor-yolo',
      }));
      expect(readFileSync(sharedSettingsPath, 'utf-8')).toBe(sharedContent);
    } finally {
      handle.dispose();
    }
  });
});
