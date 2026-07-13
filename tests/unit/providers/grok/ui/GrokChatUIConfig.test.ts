import {
  clearGrokModelCatalog,
  setGrokModelCatalog,
} from '@/providers/grok/grokModelCatalog';
import { GROK_MODELS, grokChatUIConfig } from '@/providers/grok/ui/GrokChatUIConfig';

const LIVE_MODELS = [
  { value: 'grok-4.5', label: 'grok-4.5', description: 'Default' },
  { value: 'grok-composer-2.5-fast', label: 'grok-composer-2.5-fast', description: '' },
];

describe('GrokChatUIConfig', () => {
  afterEach(() => {
    clearGrokModelCatalog();
  });

  it('falls back to GROK_MODELS when the live catalog is unset', () => {
    expect(grokChatUIConfig.getModelOptions({})).toEqual(GROK_MODELS);
  });

  it('prefers the live Grok catalog over GROK_MODELS', () => {
    setGrokModelCatalog(LIVE_MODELS);
    expect(grokChatUIConfig.getModelOptions({})).toEqual(LIVE_MODELS);
    expect(grokChatUIConfig.isDefaultModel('grok-4.5')).toBe(true);
    expect(grokChatUIConfig.ownsModel('grok-4.5', {})).toBe(true);
  });

  it('prepends a distinct env custom model to the live catalog', () => {
    setGrokModelCatalog(LIVE_MODELS);
    const options = grokChatUIConfig.getModelOptions({
      providerConfigs: {
        grok: {
          environmentVariables: 'GROK_MODEL=custom-xai-model',
        },
      },
    });

    expect(options).toEqual([
      { value: 'custom-xai-model', label: 'custom-xai-model', description: 'Custom (env)' },
      ...LIVE_MODELS,
    ]);
  });

  it('does not duplicate an env model already present in the live catalog', () => {
    setGrokModelCatalog(LIVE_MODELS);
    const options = grokChatUIConfig.getModelOptions({
      environmentVariables: 'XAI_MODEL=grok-4.5',
    });

    expect(options).toEqual(LIVE_MODELS);
    expect(grokChatUIConfig.getCustomModelIds({ XAI_MODEL: 'grok-4.5' })).toEqual(new Set());
  });
});
