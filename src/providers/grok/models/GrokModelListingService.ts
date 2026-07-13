import { execFile } from 'child_process';
import { promisify } from 'util';

import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import type { ProviderUIOption } from '../../../core/providers/types';
import type ClaudianPlugin from '../../../main';
import { parseEnvironmentVariables } from '../../../utils/env';
import { getVaultPath } from '../../../utils/path';

export interface GrokModelListProvider {
  listModels(options?: { forceReload?: boolean }): Promise<ProviderUIOption[]>;
  invalidate(): void;
}

interface GrokModelListingServiceOptions {
  ttlMs?: number;
  now?: () => number;
}

const DEFAULT_MODEL_LIST_TTL_MS = 5_000;
const GROK_MODELS_TIMEOUT_MS = 10_000;
const execFileAsync = promisify(execFile);
const ansiEscapePattern = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g');

export class GrokModelListingService implements GrokModelListProvider {
  private cache: ProviderUIOption[] | null = null;
  private cacheExpiresAt = 0;
  private pending: Promise<ProviderUIOption[]> | null = null;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(
    private readonly plugin: ClaudianPlugin,
    options: GrokModelListingServiceOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? DEFAULT_MODEL_LIST_TTL_MS;
    this.now = options.now ?? (() => Date.now());
  }

  async listModels(options?: { forceReload?: boolean }): Promise<ProviderUIOption[]> {
    if (options?.forceReload) {
      const models = await this.fetchModels();
      this.storeCache(models);
      return models;
    }

    if (this.cache && this.now() < this.cacheExpiresAt) {
      return this.cache;
    }

    if (this.pending) {
      return this.pending;
    }

    this.pending = this.fetchModels()
      .then((models) => {
        this.storeCache(models);
        return models;
      })
      .finally(() => {
        this.pending = null;
      });

    return this.pending;
  }

  invalidate(): void {
    this.cache = null;
    this.cacheExpiresAt = 0;
  }

  private async fetchModels(): Promise<ProviderUIOption[]> {
    const command = this.plugin.getResolvedProviderCliPath('grok');
    if (!command) {
      return [];
    }

    const envText = getRuntimeEnvironmentText(this.plugin.settings, 'grok');
    const env = {
      ...process.env,
      ...parseEnvironmentVariables(envText),
    };
    const { stdout } = await execFileAsync(command, ['models'], {
      cwd: getVaultPath(this.plugin.app) ?? process.cwd(),
      encoding: 'utf8',
      env,
      timeout: GROK_MODELS_TIMEOUT_MS,
    });

    return parseGrokModelsOutput(stdout);
  }

  private storeCache(models: ProviderUIOption[]): void {
    this.cache = models;
    this.cacheExpiresAt = this.now() + this.ttlMs;
  }
}

function parseGrokModelsOutput(output: string): ProviderUIOption[] {
  const lines = output.replace(ansiEscapePattern, '').split(/\r?\n/);
  const availableModelsIndex = lines.findIndex(line => line.trim() === 'Available models:');
  if (availableModelsIndex < 0) {
    return [];
  }

  const models: ProviderUIOption[] = [];
  for (const line of lines.slice(availableModelsIndex + 1)) {
    const match = line.match(/^\s*([*-])\s+(\S+)/);
    if (!match) {
      continue;
    }

    const modelId = match[2];
    models.push({
      value: modelId,
      label: modelId,
      description: match[1] === '*' || /\s+\(default\)\s*$/.test(line) ? 'Default' : '',
    });
  }

  return models;
}
