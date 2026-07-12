import {
  clearCodexModelCatalog,
  getCodexCatalogModelOptions,
  setCodexModelCatalog,
} from '@/providers/codex/codexModelCatalog';
import type { CodexAppServerModel } from '@/providers/codex/runtime/codexAppServerTypes';

const MODELS: CodexAppServerModel[] = [
  {
    id: 'gpt-5.6-id',
    model: 'gpt-5.6',
    displayName: 'GPT-5.6',
    description: 'Newest general model',
    hidden: false,
    isDefault: true,
    defaultReasoningEffort: 'medium',
    supportedReasoningEfforts: [],
  },
  {
    id: 'internal-id',
    model: 'gpt-internal',
    displayName: 'Internal',
    description: 'Hidden model',
    hidden: true,
    isDefault: false,
    defaultReasoningEffort: 'medium',
    supportedReasoningEfforts: [],
  },
  {
    id: 'gpt-5.5-id',
    model: 'gpt-5.5',
    displayName: 'GPT-5.5',
    description: 'Previous model',
    hidden: false,
    isDefault: false,
    defaultReasoningEffort: 'medium',
    supportedReasoningEfforts: [],
  },
];

describe('codexModelCatalog', () => {
  afterEach(() => {
    clearCodexModelCatalog();
  });

  it('returns null before any catalog is set', () => {
    expect(getCodexCatalogModelOptions()).toBeNull();
  });

  it('returns null again after clearing', () => {
    setCodexModelCatalog(MODELS);
    clearCodexModelCatalog();
    expect(getCodexCatalogModelOptions()).toBeNull();
  });

  it('maps app-server models to picker options using the runtime model string', () => {
    setCodexModelCatalog(MODELS);
    expect(getCodexCatalogModelOptions()).toEqual([
      {
        value: 'gpt-5.6',
        label: 'GPT-5.6',
        description: 'Newest general model',
      },
      {
        value: 'gpt-5.5',
        label: 'GPT-5.5',
        description: 'Previous model',
      },
    ]);
  });

  it('filters hidden models without changing server order', () => {
    setCodexModelCatalog(MODELS);
    expect(getCodexCatalogModelOptions()?.map(option => option.value)).toEqual([
      'gpt-5.6',
      'gpt-5.5',
    ]);
  });

  it('returns null for an empty catalog', () => {
    setCodexModelCatalog([]);
    expect(getCodexCatalogModelOptions()).toBeNull();
  });
});
