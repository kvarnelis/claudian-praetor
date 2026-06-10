/**
 * Headless ClaudianPlugin shim: just enough plugin surface for provider
 * registries, workspace services, and chat runtimes to operate outside
 * Obsidian. Every member NOT explicitly provided throws loudly via a Proxy
 * trap so missing surface is discovered instead of silently undefined.
 */

import * as fs from 'fs';
import * as path from 'path';

import { DEFAULT_CLAUDIAN_SETTINGS } from '../../src/app/settings/defaultSettings';
import { SharedStorageService } from '../../src/app/storage/SharedStorageService';
import {
  CLAUDIAN_SETTINGS_PATH,
  CLAUDIAN_STORAGE_PATH,
} from '../../src/core/bootstrap/StoragePaths';
import {
  type EnvironmentScope,
  getEnvironmentVariablesForScope,
  getRuntimeEnvironmentText,
} from '../../src/core/providers/providerEnvironment';
import { ProviderRegistry } from '../../src/core/providers/ProviderRegistry';
import { ProviderSettingsCoordinator } from '../../src/core/providers/ProviderSettingsCoordinator';
import { ProviderWorkspaceRegistry } from '../../src/core/providers/ProviderWorkspaceRegistry';
import type { ProviderId } from '../../src/core/providers/types';
import type { ClaudianSettings } from '../../src/core/types';
import type ClaudianPlugin from '../../src/main';
import { OPENCODE_PLAN_MODE_ID, OPENCODE_SAFE_MODE_ID } from '../../src/providers/opencode/modes';
import type { NodeVaultApp } from './nodeVaultApp';

const DAEMON_DATA_FILE = 'praetor-daemon-data.json';
const SETTINGS_WATCH_DEBOUNCE_MS = 500;

export interface HeadlessPluginHandle {
  plugin: ClaudianPlugin;
  settings: ClaudianSettings;
  storage: SharedStorageService;
  dispose(): void;
}

/** Mirrors the load-time normalization in main.ts loadSettings() (essentials only). */
function normalizeLoadedSettings(settings: ClaudianSettings): void {
  // Plan mode is ephemeral; never boot stuck in it.
  if (settings.permissionMode === 'plan') {
    settings.permissionMode = 'normal';
  }
  if (
    settings.savedProviderPermissionMode
    && typeof settings.savedProviderPermissionMode === 'object'
    && !Array.isArray(settings.savedProviderPermissionMode)
  ) {
    for (const [providerId, mode] of Object.entries(settings.savedProviderPermissionMode)) {
      if (mode === 'plan') {
        settings.savedProviderPermissionMode[providerId] = 'normal';
      }
    }
  }
  const opencodeConfig = settings.providerConfigs?.opencode;
  if (
    opencodeConfig
    && typeof opencodeConfig === 'object'
    && !Array.isArray(opencodeConfig)
    && opencodeConfig.selectedMode === OPENCODE_PLAN_MODE_ID
  ) {
    opencodeConfig.selectedMode = OPENCODE_SAFE_MODE_ID;
  }

  ProviderSettingsCoordinator.projectActiveProviderState(
    settings as unknown as Record<string, unknown>,
  );
}

export async function createHeadlessPlugin(options: {
  app: NodeVaultApp;
  vaultPath: string;
  log?: (message: string) => void;
}): Promise<HeadlessPluginHandle> {
  const { app, vaultPath } = options;
  const log = options.log ?? ((message: string) => console.error(message));
  const dataFilePath = path.join(vaultPath, CLAUDIAN_STORAGE_PATH, DAEMON_DATA_FILE);

  const loadData = async (): Promise<unknown> => {
    try {
      return JSON.parse(await fs.promises.readFile(dataFilePath, 'utf-8')) as unknown;
    } catch {
      return null;
    }
  };
  const saveData = async (data: unknown): Promise<void> => {
    await fs.promises.mkdir(path.dirname(dataFilePath), { recursive: true });
    await fs.promises.writeFile(dataFilePath, JSON.stringify(data ?? {}, null, 2), 'utf-8');
  };

  // SharedStorageService only touches plugin.app + loadData/saveData.
  const storageHost = { app, loadData, saveData };
  const storage = new SharedStorageService(storageHost as never);
  const { claudian } = await storage.initialize();

  const settings: ClaudianSettings = {
    ...DEFAULT_CLAUDIAN_SETTINGS,
    ...claudian,
  };
  normalizeLoadedSettings(settings);

  const members = {
    app,
    manifest: { id: 'claudian-praetor', name: 'Claudian Praetor', version: '0.1.0' },
    settings,
    storage,
    loadData,
    saveData,
    saveSettings: async (): Promise<void> => {
      ProviderSettingsCoordinator.normalizeProviderSelection(
        settings as unknown as Record<string, unknown>,
      );
      ProviderSettingsCoordinator.persistProjectedProviderState(
        settings as unknown as Record<string, unknown>,
      );
      await storage.saveClaudianSettings(settings);
    },
    getResolvedProviderCliPath: (providerId: ProviderId): string | null =>
      ProviderWorkspaceRegistry.getCliResolver(providerId)?.resolveFromSettings(
        settings as unknown as Record<string, unknown>,
      ) ?? null,
    getActiveEnvironmentVariables: (providerId?: ProviderId): string =>
      getRuntimeEnvironmentText(
        settings as unknown as Record<string, unknown>,
        providerId ?? ProviderRegistry.resolveSettingsProviderId(
          settings as unknown as Record<string, unknown>,
        ),
      ),
    getEnvironmentVariablesForScope: (scope: EnvironmentScope): string =>
      getEnvironmentVariablesForScope(settings as unknown as Record<string, unknown>, scope),
    getAllViews: (): unknown[] => [],
    getView: (): null => null,
    getConversationSync: (): null => null,
    normalizeModelVariantSettings: (): boolean => false,
    persistTabManagerState: async (): Promise<void> => {},
  };

  const plugin = new Proxy(members, {
    get(target, prop, receiver) {
      if (typeof prop === 'symbol') {
        return Reflect.get(target, prop, receiver);
      }
      if (prop in target) {
        return Reflect.get(target, prop, receiver);
      }
      // `await plugin` / promise-chain probes must not explode.
      if (prop === 'then') {
        return undefined;
      }
      throw new Error(`praetord shim: ClaudianPlugin.${String(prop)} is not implemented`);
    },
  }) as unknown as ClaudianPlugin;

  const watcher = watchSettingsFile(vaultPath, async () => {
    try {
      const reloaded = await storage.claudianSettings.load();
      const next: ClaudianSettings = {
        ...DEFAULT_CLAUDIAN_SETTINGS,
        ...reloaded,
      };
      normalizeLoadedSettings(next);
      // Mutate in place: live runtimes hold references to this object.
      for (const key of Object.keys(settings)) {
        delete (settings as unknown as Record<string, unknown>)[key];
      }
      Object.assign(settings, next);
      log('[praetord] settings reloaded from vault');
    } catch (err) {
      log(`[praetord] settings reload failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  return {
    plugin,
    settings,
    storage,
    dispose: () => {
      watcher?.close();
    },
  };
}

/**
 * Watches the `.claudian` directory (not the file itself: Obsidian/sync tools
 * replace the file, which kills file-level watchers) and debounces change
 * bursts before invoking the reload callback.
 */
function watchSettingsFile(
  vaultPath: string,
  onChange: () => Promise<void>,
): fs.FSWatcher | null {
  const settingsDir = path.join(vaultPath, CLAUDIAN_STORAGE_PATH);
  const settingsFileName = path.basename(CLAUDIAN_SETTINGS_PATH);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let reloading = false;
  let pendingReload = false;

  const scheduleReload = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void runReload();
    }, SETTINGS_WATCH_DEBOUNCE_MS);
  };

  const runReload = async (): Promise<void> => {
    if (reloading) {
      pendingReload = true;
      return;
    }
    reloading = true;
    try {
      await onChange();
    } finally {
      reloading = false;
      if (pendingReload) {
        pendingReload = false;
        scheduleReload();
      }
    }
  };

  try {
    fs.mkdirSync(settingsDir, { recursive: true });
    const watcher = fs.watch(settingsDir, (_event, filename) => {
      if (filename && filename !== settingsFileName) return;
      scheduleReload();
    });
    watcher.on('error', () => {
      // Watcher loss is non-fatal; settings just stop live-reloading.
    });
    return watcher;
  } catch {
    return null;
  }
}
