import type { Plugin } from 'obsidian';
import { Notice } from 'obsidian';

import { SessionStorage } from '../../core/bootstrap/SessionStorage';
import type { SharedAppStorage } from '../../core/bootstrap/storage';
import { normalizeTabManagerState } from '../../core/bootstrap/tabManagerState';
import type { AppTabManagerState } from '../../core/providers/types';
import { VaultFileAdapter } from '../../core/storage/VaultFileAdapter';
import { PocketCodexSettingsStorage, type StoredPocketCodexSettings } from '../settings/PocketCodexSettingsStorage';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export class SharedStorageService implements SharedAppStorage {
  readonly pocketCodexSettings: PocketCodexSettingsStorage;
  readonly sessions: SessionStorage;

  private adapter: VaultFileAdapter;
  private plugin: Plugin;
  private pluginDataMutationQueue: Promise<void> = Promise.resolve();

  constructor(plugin: Plugin) {
    this.plugin = plugin;
    this.adapter = new VaultFileAdapter(plugin.app);
    this.pocketCodexSettings = new PocketCodexSettingsStorage(this.adapter);
    this.sessions = new SessionStorage(this.adapter);
  }

  async initialize(): Promise<{ pocketCodex: Record<string, unknown> }> {
    await this.pocketCodexSettings.seedOwnSettingsOnFirstRun();
    const pocketCodex = await this.pocketCodexSettings.load();
    return { pocketCodex };
  }

  async savePocketCodexSettings(settings: Record<string, unknown>): Promise<void> {
    await this.pocketCodexSettings.save(settings as StoredPocketCodexSettings);
  }

  async setTabManagerState(state: AppTabManagerState): Promise<void> {
    try {
      await this.mutatePluginData((data) => {
        data.tabManagerState = state;
      });
    } catch (error) {
      new Notice('Failed to save tab layout');
      throw error;
    }
  }

  async getTabManagerState(): Promise<AppTabManagerState | null> {
    try {
      const data: unknown = await this.loadPluginData();
      if (!isRecord(data) || !data.tabManagerState) {
        return null;
      }

      return normalizeTabManagerState(data.tabManagerState);
    } catch {
      return null;
    }
  }

  async setRemoteDaemonConfig(config: { url: string } | null): Promise<void> {
    try {
      await this.mutatePluginData((data) => {
        if (config) {
          data.remoteDaemon = { url: config.url };
        } else {
          delete data.remoteDaemon;
        }
      });
    } catch {
      new Notice('Failed to save remote daemon settings');
    }
  }

  async getRemoteDaemonConfig(): Promise<{ url: string } | null> {
    try {
      const data: unknown = await this.loadPluginData();
      if (!isRecord(data) || !isRecord(data.remoteDaemon)) {
        return null;
      }
      const remoteDaemon = data.remoteDaemon;
      const { url } = remoteDaemon;
      if (typeof url !== 'string') {
        return null;
      }
      if (Object.keys(remoteDaemon).some((key) => key !== 'url')) {
        await this.mutatePluginData((latest) => {
          if (isRecord(latest.remoteDaemon) && latest.remoteDaemon.url === url) {
            latest.remoteDaemon = { url };
          }
        });
      }
      return { url };
    } catch {
      return null;
    }
  }

  getAdapter(): VaultFileAdapter {
    return this.adapter;
  }


  private async loadPluginData(): Promise<unknown> {
    await this.pluginDataMutationQueue;
    return this.plugin.loadData();
  }

  private mutatePluginData(
    mutation: (data: Record<string, unknown>) => void,
  ): Promise<void> {
    const pending = this.pluginDataMutationQueue.then(async () => {
      const loaded: unknown = await this.plugin.loadData();
      const data = isRecord(loaded) ? loaded : {};
      mutation(data);
      await this.plugin.saveData(data);
    });
    this.pluginDataMutationQueue = pending.catch(() => undefined);
    return pending;
  }

}
