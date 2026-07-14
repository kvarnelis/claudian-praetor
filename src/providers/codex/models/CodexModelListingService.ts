import type { ProviderHost } from '../../../core/providers/ProviderHost';
import { CodexAppServerProcess } from '../runtime/CodexAppServerProcess';
import {
  initializeCodexAppServerTransport,
  resolveCodexAppServerLaunchSpec,
} from '../runtime/codexAppServerSupport';
import type {
  CodexAppServerModel,
  ModelListParams,
  ModelListResponse,
} from '../runtime/codexAppServerTypes';
import { CodexRpcTransport } from '../runtime/CodexRpcTransport';
import { createCodexRuntimeContext } from '../runtime/CodexRuntimeContext';

export interface CodexModelListProvider {
  listModels(options?: { forceReload?: boolean }): Promise<CodexAppServerModel[]>;
  invalidate(): void;
}

interface CodexModelListingServiceOptions {
  ttlMs?: number;
  now?: () => number;
}

const DEFAULT_MODEL_LIST_TTL_MS = 5_000;

export class CodexModelListingService implements CodexModelListProvider {
  private cache: CodexAppServerModel[] | null = null;
  private cacheExpiresAt = 0;
  private pending: Promise<CodexAppServerModel[]> | null = null;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(
    private readonly plugin: ProviderHost,
    options: CodexModelListingServiceOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? DEFAULT_MODEL_LIST_TTL_MS;
    this.now = options.now ?? (() => Date.now());
  }

  async listModels(options?: { forceReload?: boolean }): Promise<CodexAppServerModel[]> {
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

  private async fetchModels(): Promise<CodexAppServerModel[]> {
    const launchSpec = resolveCodexAppServerLaunchSpec(this.plugin, 'codex');
    const process = new CodexAppServerProcess(launchSpec);
    process.start();

    const transport = new CodexRpcTransport(process);
    transport.start();

    try {
      const initializeResult = await initializeCodexAppServerTransport(transport);
      createCodexRuntimeContext(launchSpec, initializeResult);
      const models: CodexAppServerModel[] = [];
      let cursor: string | null | undefined;

      do {
        const params: ModelListParams = {
          includeHidden: false,
          ...(cursor ? { cursor } : {}),
        };
        const response = await transport.request<ModelListResponse>('model/list', params);
        models.push(...response.data);
        cursor = response.nextCursor;
      } while (cursor);

      return models;
    } finally {
      transport.dispose();
      await process.shutdown();
    }
  }

  private storeCache(models: CodexAppServerModel[]): void {
    this.cache = models;
    this.cacheExpiresAt = this.now() + this.ttlMs;
  }
}
