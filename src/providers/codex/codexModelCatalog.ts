import type { ProviderUIOption } from '../../core/providers/types';
import type { CodexAppServerModel } from './runtime/codexAppServerTypes';

/**
 * Session-level cache of models reported by the initialized Codex app-server.
 * Consumers fall back to DEFAULT_CODEX_MODELS until a non-empty list arrives.
 */
let codexModelCatalog: CodexAppServerModel[] | null = null;

export function setCodexModelCatalog(models: CodexAppServerModel[]): void {
  codexModelCatalog = models;
}

export function clearCodexModelCatalog(): void {
  codexModelCatalog = null;
}

export function getCodexCatalogModelOptions(): ProviderUIOption[] | null {
  if (!codexModelCatalog) {
    return null;
  }

  const options = codexModelCatalog
    .filter(model => !model.hidden)
    .map(model => ({
      value: model.model,
      label: model.displayName,
      description: model.description,
    }));

  return options.length > 0 ? options : null;
}
