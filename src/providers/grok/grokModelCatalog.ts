import type { ProviderUIOption } from '../../core/providers/types';

/**
 * Session-level cache of models reported by the Grok CLI.
 * Consumers fall back to GROK_MODELS until a non-empty list arrives.
 */
let grokModelCatalog: ProviderUIOption[] | null = null;

export function setGrokModelCatalog(models: ProviderUIOption[]): void {
  grokModelCatalog = models;
}

export function clearGrokModelCatalog(): void {
  grokModelCatalog = null;
}

export function getGrokCatalogModelOptions(): ProviderUIOption[] | null {
  return grokModelCatalog && grokModelCatalog.length > 0 ? grokModelCatalog : null;
}
