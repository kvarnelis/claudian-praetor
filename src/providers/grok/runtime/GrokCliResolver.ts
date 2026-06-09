import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import { getEnhancedPath, getHostnameKey, parseEnvironmentVariables } from '../../../utils/env';
import { expandHomePath, parsePathEntries } from '../../../utils/path';
import { getGrokProviderSettings } from '../settings';

function isExistingGrokFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function resolveConfiguredGrokPath(configuredPath: string | undefined): string | null {
  const trimmed = (configuredPath ?? '').trim();
  if (!trimmed) {
    return null;
  }

  try {
    const expandedPath = expandHomePath(trimmed);
    return isExistingGrokFile(expandedPath) ? expandedPath : null;
  } catch {
    return null;
  }
}

function findGrokBinaryPath(
  additionalPath?: string,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const homeDir = os.homedir();
  const binaryNames = platform === 'win32' ? ['grok.exe', 'grok'] : ['grok'];
  // Grok Build installs into ~/.grok/bin by default, which login-shell PATH
  // probing can miss, so well-known install dirs are appended after PATH.
  const commonEntries = [
    path.join(homeDir, '.grok', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    path.join(homeDir, '.local', 'bin'),
    path.join(homeDir, 'bin'),
  ];
  const searchEntries = [
    ...parsePathEntries(getEnhancedPath(additionalPath)),
    ...commonEntries,
  ];

  const seen = new Set<string>();
  for (const dir of searchEntries) {
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);

    for (const binaryName of binaryNames) {
      const candidate = path.join(dir, binaryName);
      if (isExistingGrokFile(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

function resolveGrokCliPath(
  hostnamePath: string | undefined,
  legacyPath: string | undefined,
  envText: string,
): string | null {
  const configuredHostnamePath = resolveConfiguredGrokPath(hostnamePath);
  if (configuredHostnamePath) {
    return configuredHostnamePath;
  }

  const configuredLegacyPath = resolveConfiguredGrokPath(legacyPath);
  if (configuredLegacyPath) {
    return configuredLegacyPath;
  }

  const customEnv = parseEnvironmentVariables(envText || '');
  return findGrokBinaryPath(customEnv.PATH);
}

export class GrokCliResolver {
  private resolvedPath: string | null = null;
  private lastHostnamePath = '';
  private lastLegacyPath = '';
  private lastEnvText = '';
  private readonly cachedHostname = getHostnameKey();

  resolveFromSettings(settings: Record<string, unknown>): string | null {
    const grokSettings = getGrokProviderSettings(settings);
    const hostnamePath = (grokSettings.cliPathsByHost[this.cachedHostname] ?? '').trim();
    const legacyPath = grokSettings.cliPath.trim();
    const envText = getRuntimeEnvironmentText(settings, 'grok');

    if (
      this.resolvedPath &&
      hostnamePath === this.lastHostnamePath &&
      legacyPath === this.lastLegacyPath &&
      envText === this.lastEnvText
    ) {
      return this.resolvedPath;
    }

    this.lastHostnamePath = hostnamePath;
    this.lastLegacyPath = legacyPath;
    this.lastEnvText = envText;

    this.resolvedPath = resolveGrokCliPath(hostnamePath, legacyPath, envText);
    return this.resolvedPath;
  }

  reset(): void {
    this.resolvedPath = null;
    this.lastHostnamePath = '';
    this.lastLegacyPath = '';
    this.lastEnvText = '';
  }
}
