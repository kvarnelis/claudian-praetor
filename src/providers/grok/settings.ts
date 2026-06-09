import { getProviderConfig, setProviderConfig } from '../../core/providers/providerConfig';
import { getProviderEnvironmentVariables } from '../../core/providers/providerEnvironment';
import type { HostnameCliPaths } from '../../core/types/settings';

export type GrokSafeMode = 'workspace-write' | 'read-only';

export interface PersistedGrokProviderSettings {
  enabled: boolean;
  safeMode: GrokSafeMode;
  cliPath: string;
  cliPathsByHost: HostnameCliPaths;
  environmentVariables: string;
}

export const DEFAULT_GROK_PROVIDER_SETTINGS: Readonly<PersistedGrokProviderSettings> = Object.freeze({
  enabled: false,
  safeMode: 'workspace-write' as GrokSafeMode,
  cliPath: '',
  cliPathsByHost: {},
  environmentVariables: '',
});

function normalizeHostnameCliPaths(value: unknown): HostnameCliPaths {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const result: HostnameCliPaths = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string' && entry.trim()) {
      result[key] = entry.trim();
    }
  }
  return result;
}

export function getGrokProviderSettings(
  settings: Record<string, unknown>,
): PersistedGrokProviderSettings {
  const config = getProviderConfig(settings, 'grok');

  return {
    enabled: (config.enabled as boolean | undefined)
      ?? (settings.grokEnabled as boolean | undefined)
      ?? DEFAULT_GROK_PROVIDER_SETTINGS.enabled,
    safeMode: (config.safeMode as GrokSafeMode | undefined)
      ?? DEFAULT_GROK_PROVIDER_SETTINGS.safeMode,
    cliPath: (config.cliPath as string | undefined)
      ?? DEFAULT_GROK_PROVIDER_SETTINGS.cliPath,
    cliPathsByHost: normalizeHostnameCliPaths(config.cliPathsByHost),
    environmentVariables: (config.environmentVariables as string | undefined)
      ?? getProviderEnvironmentVariables(settings, 'grok')
      ?? DEFAULT_GROK_PROVIDER_SETTINGS.environmentVariables,
  };
}

export function updateGrokProviderSettings(
  settings: Record<string, unknown>,
  updates: Partial<PersistedGrokProviderSettings>,
): PersistedGrokProviderSettings {
  const next: PersistedGrokProviderSettings = {
    ...getGrokProviderSettings(settings),
    ...updates,
  };

  setProviderConfig(settings, 'grok', {
    enabled: next.enabled,
    safeMode: next.safeMode,
    cliPath: next.cliPath,
    cliPathsByHost: next.cliPathsByHost,
    environmentVariables: next.environmentVariables,
  });

  return next;
}
