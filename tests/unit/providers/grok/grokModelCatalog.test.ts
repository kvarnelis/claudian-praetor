import type { ProviderUIOption } from '@/core/providers/types';
import {
  clearGrokModelCatalog,
  getGrokCatalogModelOptions,
  setGrokModelCatalog,
} from '@/providers/grok/grokModelCatalog';

const MODELS: ProviderUIOption[] = [
  { value: 'grok-4.5', label: 'grok-4.5', description: 'Default' },
  { value: 'grok-composer-2.5-fast', label: 'grok-composer-2.5-fast', description: '' },
];

describe('grokModelCatalog', () => {
  afterEach(() => {
    clearGrokModelCatalog();
  });

  it('returns null before any catalog is set', () => {
    expect(getGrokCatalogModelOptions()).toBeNull();
  });

  it('returns the cached picker options', () => {
    setGrokModelCatalog(MODELS);
    expect(getGrokCatalogModelOptions()).toEqual(MODELS);
  });

  it('returns null again after clearing', () => {
    setGrokModelCatalog(MODELS);
    clearGrokModelCatalog();
    expect(getGrokCatalogModelOptions()).toBeNull();
  });

  it('returns null for an empty catalog', () => {
    setGrokModelCatalog([]);
    expect(getGrokCatalogModelOptions()).toBeNull();
  });
});
