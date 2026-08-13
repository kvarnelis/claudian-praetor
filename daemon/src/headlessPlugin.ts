/**
 * Headless PocketCodexPlugin shim: just enough plugin surface for provider
 * registries, workspace services, and chat runtimes to operate outside
 * Obsidian. Every member NOT explicitly provided throws loudly via a Proxy
 * trap so missing surface is discovered instead of silently undefined.
 */

import * as fs from 'fs';
import * as path from 'path';

import { DEFAULT_POCKET_CODEX_SETTINGS } from '../../src/app/settings/defaultSettings';
import {
  SettingsCoordinator,
  type ConditionalSettingsMutation,
  type SettingsMutation,
} from '../../src/app/settings/SettingsCoordinator';
import { SharedStorageService } from '../../src/app/storage/SharedStorageService';
import {
  POCKET_CODEX_SETTINGS_PATH,
  POCKET_CODEX_STORAGE_PATH,
} from '../../src/core/bootstrap/StoragePaths';
import {
  type EnvironmentScope,
  getEnvironmentVariablesForScope,
  getRuntimeEnvironmentText,
  setEnvironmentVariablesForScope,
} from '../../src/core/providers/providerEnvironment';
import { ProviderRegistry } from '../../src/core/providers/ProviderRegistry';
import type { ProviderHost } from '../../src/core/providers/ProviderHost';
import { ProviderSettingsCoordinator } from '../../src/core/providers/ProviderSettingsCoordinator';
import { ProviderWorkspaceRegistry } from '../../src/core/providers/ProviderWorkspaceRegistry';
import type { ProviderCliResolutionContext, ProviderId } from '../../src/core/providers/types';
import type { PocketCodexSettings } from '../../src/core/types';
import type PocketCodexPlugin from '../../src/main';
import type { NodeVaultApp } from './nodeVaultApp';

const DAEMON_DATA_FILE = 'pocket-codex-daemon-data.json';
const SETTINGS_WATCH_DEBOUNCE_MS = 500;

interface SettingsWatcher {
  close(): void;
}

export interface HeadlessPluginHandle {
  plugin: PocketCodexPlugin;
  settings: PocketCodexSettings;
  storage: SharedStorageService;
  dispose(): void;
}

/** Mirrors the load-time normalization in main.ts loadSettings() (essentials only). */
function normalizeLoadedSettings(settings: PocketCodexSettings): void {
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
  const dataFilePath = path.join(vaultPath, POCKET_CODEX_STORAGE_PATH, DAEMON_DATA_FILE);

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
  const { pocketCodex } = await storage.initialize();

  const settings: PocketCodexSettings = {
    ...DEFAULT_POCKET_CODEX_SETTINGS,
    ...pocketCodex,
  };
  normalizeLoadedSettings(settings);

  const persistSettings = async (): Promise<void> => {
    ProviderSettingsCoordinator.normalizeProviderSelection(
      settings as unknown as Record<string, unknown>,
    );
    ProviderSettingsCoordinator.persistProjectedProviderState(
      settings as unknown as Record<string, unknown>,
    );
    await storage.savePocketCodexSettings(settings);
  };
  const settingsCoordinator = new SettingsCoordinator(settings, persistSettings);

  const members = {
    app: app as never,
    manifest: { version: '0.1.0' },
    settings,
    storage,
    loadData,
    saveData,
    saveSettings: (): Promise<void> => settingsCoordinator.persistCurrent(),
    mutateSettings: (mutation: SettingsMutation<PocketCodexSettings>): Promise<void> =>
      settingsCoordinator.mutate(mutation),
    mutateSettingsConditionally: (
      mutation: ConditionalSettingsMutation<PocketCodexSettings>,
    ): Promise<void> => settingsCoordinator.mutateConditionally(mutation),
    getResolvedProviderCliPath: async (
      providerId: ProviderId,
      context?: ProviderCliResolutionContext,
    ): Promise<string | null> =>
      await ProviderWorkspaceRegistry.getCliResolver(providerId)?.resolveFromSettings(
        settings as unknown as Record<string, unknown>,
        context,
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
    applyEnvironmentVariables: (scope: EnvironmentScope, envText: string): Promise<void> =>
      settingsCoordinator.mutate((current) => {
        const settingsBag = current as unknown as Record<string, unknown>;
        setEnvironmentVariablesForScope(settingsBag, scope, envText);
        const providerIds = scope === 'shared'
          ? ProviderRegistry.getRegisteredProviderIds()
          : ProviderRegistry.getRegisteredProviderIds().filter(
            providerId => `provider:${providerId}` === scope,
          );
        ProviderSettingsCoordinator.handleEnvironmentChange(settingsBag, providerIds);
        ProviderSettingsCoordinator.normalizeAllModelVariants(settingsBag);
      }),
    applyEnvironmentVariablesBatch: (
      updates: Array<{ scope: EnvironmentScope; envText: string }>,
    ): Promise<void> => settingsCoordinator.mutate((current) => {
      const settingsBag = current as unknown as Record<string, unknown>;
      const affectedProviderIds = new Set<ProviderId>();
      for (const { scope, envText } of updates) {
        setEnvironmentVariablesForScope(settingsBag, scope, envText);
        if (scope === 'shared') {
          for (const providerId of ProviderRegistry.getRegisteredProviderIds()) {
            affectedProviderIds.add(providerId);
          }
        } else {
          const providerId = scope.slice('provider:'.length);
          if (ProviderRegistry.getRegisteredProviderIds().includes(providerId)) {
            affectedProviderIds.add(providerId);
          }
        }
      }
      ProviderSettingsCoordinator.handleEnvironmentChange(
        settingsBag,
        Array.from(affectedProviderIds),
      );
      ProviderSettingsCoordinator.normalizeAllModelVariants(settingsBag);
    }),
    getAllViews: (): unknown[] => [],
    getView: (): null => null,
    getConversationSync: (): null => null,
    normalizeModelVariantSettings: (): boolean =>
      ProviderSettingsCoordinator.normalizeAllModelVariants(
        settings as unknown as Record<string, unknown>,
      ),
    persistTabManagerState: async (): Promise<void> => {},
    refreshModelSelectors: (): void => {},
    broadcastToActiveViewRuntimes: async (): Promise<void> => {},
    broadcastToAllViewRuntimes: async (): Promise<void> => {},
    recycleProviderRuntimes: async (): Promise<void> => {},
  } satisfies Required<ProviderHost> & Record<string, unknown>;

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
      throw new Error(`pocket-codexd shim: PocketCodexPlugin.${String(prop)} is not implemented`);
    },
  }) as unknown as PocketCodexPlugin;

  const watcher = watchSettingsFile(vaultPath, async () => {
    try {
      const reloaded = await storage.pocketCodexSettings.load();
      const next: PocketCodexSettings = {
        ...DEFAULT_POCKET_CODEX_SETTINGS,
        ...reloaded,
      };
      normalizeLoadedSettings(next);
      await settingsCoordinator.mutateConditionally(() => {
        // Mutate in place: live runtimes hold references to this object.
        for (const key of Object.keys(settings)) {
          delete (settings as unknown as Record<string, unknown>)[key];
        }
        Object.assign(settings, next);
        return false;
      });
      log('[pocket-codexd] settings reloaded from vault');
    } catch (err) {
      log(`[pocket-codexd] settings reload failed: ${err instanceof Error ? err.message : String(err)}`);
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
 * Watches the `.claudian` compatibility directory (not the file itself: Obsidian/sync tools
 * replace the file, which kills file-level watchers) and debounces change
 * bursts before invoking the reload callback.
 */
function watchSettingsFile(
  vaultPath: string,
  onChange: () => Promise<void>,
): SettingsWatcher | null {
  const settingsDir = path.join(vaultPath, POCKET_CODEX_STORAGE_PATH);
  const settingsFileName = path.basename(POCKET_CODEX_SETTINGS_PATH);
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
    return {
      close: () => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        watcher.close();
      },
    };
  } catch {
    return null;
  }
}
