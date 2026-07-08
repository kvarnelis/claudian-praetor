import type { AppSessionStorage, AppTabManagerState } from '../providers/types';
import type { VaultFileAdapter } from '../storage/VaultFileAdapter';

/**
 * Minimal shared app storage contract.
 *
 * This interface covers only the storage concerns that are shared across
 * all providers: Claudian settings, tab manager state, and session metadata.
 *
 * Provider-specific storage surfaces (CC settings, slash commands, skills,
 * agents, MCP config) live behind provider-owned modules.
 */
export interface SharedAppStorage {
  initialize(): Promise<{ claudian: Record<string, unknown> }>;
  saveClaudianSettings(settings: Record<string, unknown>): Promise<void>;
  setTabManagerState(state: AppTabManagerState): Promise<void>;
  getTabManagerState(): Promise<AppTabManagerState | null>;
  /**
   * Remote daemon connection, stored in the plugin's own data.json so it rides
   * Obsidian Sync's "community plugin settings" channel between devices (the
   * vault-level .claudian/ folder is a hidden top-level dir Sync skips).
   */
  setRemoteDaemonConfig(config: { url: string } | null): Promise<void>;
  getRemoteDaemonConfig(): Promise<{ url: string } | null>;
  sessions: AppSessionStorage;
  getAdapter(): VaultFileAdapter;
}
