import { clearCliModelCatalog, setCliModelCatalog } from '@/providers/claude/modelCatalog';
import { claudeChatUIConfig } from '@/providers/claude/ui/ClaudeChatUIConfig';

describe('claudeChatUIConfig', () => {
  afterEach(() => {
    clearCliModelCatalog();
  });

  describe('CLI model catalog integration', () => {
    const CLI_MODELS = [
      { value: 'opus', displayName: 'Opus', description: 'Opus 4.8 · Best for everyday, complex tasks', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] as ('low' | 'medium' | 'high' | 'xhigh' | 'max')[] },
      { value: 'claude-fable-5[1m]', displayName: 'Fable', description: 'Fable 5 · Most capable', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] as ('low' | 'medium' | 'high' | 'xhigh' | 'max')[] },
      { value: 'sonnet', displayName: 'Sonnet', description: 'Sonnet 4.6 · Efficient', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] as ('low' | 'medium' | 'high' | 'xhigh' | 'max')[] },
      { value: 'haiku', displayName: 'Haiku', description: 'Haiku 4.5 · Fastest' },
    ];

    it('uses catalog-reported models instead of the static defaults once set', () => {
      setCliModelCatalog(CLI_MODELS);
      const options = claudeChatUIConfig.getModelOptions({ providerConfigs: {} });
      expect(options.map((o) => o.value)).toEqual([
        'haiku',
        'sonnet',
        'claude-fable-5[1m]',
        'opus',
      ]);
      expect(options.find((o) => o.value === 'opus')?.description).toBe('Opus 4.8 · Best for everyday, complex tasks');
    });

    it('applies 1M variant toggles to catalog-backed options', () => {
      setCliModelCatalog(CLI_MODELS);
      const options = claudeChatUIConfig.getModelOptions({
        providerConfigs: { claude: { enableOpus1M: true, enableSonnet1M: true } },
      });
      expect(options.map((o) => o.value)).toEqual([
        'haiku',
        'sonnet[1m]',
        'claude-fable-5[1m]',
        'opus[1m]',
      ]);
    });

    it('keeps env-defined custom models taking precedence over the catalog', () => {
      setCliModelCatalog(CLI_MODELS);
      const options = claudeChatUIConfig.getModelOptions({
        providerConfigs: {
          claude: { environmentVariables: 'ANTHROPIC_MODEL=my-proxy-model' },
        },
      });
      expect(options).toHaveLength(1);
      expect(options[0].value).toContain('my-proxy-model');
    });

    it('falls back to the static defaults when the catalog is not set', () => {
      const options = claudeChatUIConfig.getModelOptions({ providerConfigs: {} });
      expect(options.map((o) => o.value)).toEqual([
        'haiku',
        'sonnet',
        'opus',
        'claude-fable-5[1m]',
      ]);
    });

    it('lets catalog effort levels override the static xhigh heuristic', () => {
      // Catalog says sonnet supports xhigh — static heuristic says it does not
      setCliModelCatalog(CLI_MODELS);
      const levels = claudeChatUIConfig.getReasoningOptions('sonnet', {}).map((o) => o.value);
      expect(levels).toContain('xhigh');
    });
  });

  describe('getModelOptions', () => {
    it('appends settings-defined custom models after the built-in options', () => {
      const options = claudeChatUIConfig.getModelOptions({
        providerConfigs: {
          claude: {
            customModels: 'claude-opus-4-6\nclaude-opus-4-6[1m]',
          },
        },
      });

      expect(options.map(option => option.value)).toEqual([
        'haiku',
        'sonnet',
        'opus',
        'claude-fable-5[1m]',
        'claude-code/claude-opus-4-6',
        'claude-code/claude-opus-4-6[1m]',
      ]);
      expect(options.slice(-2)).toEqual([
        {
          value: 'claude-code/claude-opus-4-6',
          label: 'Opus 4.6',
          description: 'Custom model',
        },
        {
          value: 'claude-code/claude-opus-4-6[1m]',
          label: 'Opus 4.6 (1M)',
          description: 'Custom model',
        },
      ]);
    });

    it('deduplicates settings-defined custom models against exact duplicates', () => {
      const options = claudeChatUIConfig.getModelOptions({
        providerConfigs: {
          claude: {
            customModels: 'haiku\nclaude-opus-4-6\nclaude-opus-4-6\n',
          },
        },
      });

      expect(options.map(option => option.value)).toEqual([
        'haiku',
        'sonnet',
        'opus',
        'claude-fable-5[1m]',
        'claude-code/claude-opus-4-6',
      ]);
    });

    it('formats dated settings-defined custom models with shortened date tags', () => {
      const options = claudeChatUIConfig.getModelOptions({
        providerConfigs: {
          claude: {
            customModels: 'claude-opus-4-5-20251101',
          },
        },
      });

      expect(options.at(-1)).toEqual({
        value: 'claude-code/claude-opus-4-5-20251101',
        label: 'Opus 4.5 (2511)',
        description: 'Custom model',
      });
    });

    it('uses custom model aliases for settings-defined custom model labels', () => {
      const options = claudeChatUIConfig.getModelOptions({
        customModelAliases: {
          'claude-opus-4-6': 'Work Opus',
        },
        providerConfigs: {
          claude: {
            customModels: 'claude-opus-4-6',
          },
        },
      });

      expect(options.at(-1)).toEqual({
        value: 'claude-code/claude-opus-4-6',
        label: 'Work Opus',
        description: 'Custom model',
      });
    });

    it('keeps environment-defined custom models as a full override', () => {
      const options = claudeChatUIConfig.getModelOptions({
        providerConfigs: {
          claude: {
            customModels: 'claude-opus-4-6',
            environmentVariables: 'ANTHROPIC_MODEL=claude-sonnet-4-5',
          },
        },
      });

      expect(options).toEqual([
        {
          value: 'claude-code/claude-sonnet-4-5',
          label: 'Sonnet 4.5',
          description: 'Custom model (model)',
        },
      ]);
    });

    it('uses custom model aliases for environment-defined custom model labels', () => {
      const options = claudeChatUIConfig.getModelOptions({
        customModelAliases: {
          'claude-sonnet-4-5': 'Gateway Sonnet',
        },
        providerConfigs: {
          claude: {
            environmentVariables: 'ANTHROPIC_MODEL=claude-sonnet-4-5',
          },
        },
      });

      expect(options).toEqual([
        {
          value: 'claude-code/claude-sonnet-4-5',
          label: 'Gateway Sonnet',
          description: 'Custom model (model)',
        },
      ]);
    });
  });

  describe('getReasoningOptions', () => {
    it('hides xhigh on models that do not support it', () => {
      const options = claudeChatUIConfig.getReasoningOptions('claude-sonnet-4-5', {});

      expect(options.map(option => option.value)).toEqual(['low', 'medium', 'high', 'max']);
    });

    it('keeps xhigh on supported opus models', () => {
      const options = claudeChatUIConfig.getReasoningOptions('claude-opus-4-7', {});

      expect(options.map(option => option.value)).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    });

    it('uses effort options for custom model ids', () => {
      const options = claudeChatUIConfig.getReasoningOptions('custom-model', {});

      expect(options.map(option => option.value)).toEqual(['low', 'medium', 'high', 'max']);
      expect(options.some(option => option.tokens !== undefined)).toBe(false);
    });
  });

  describe('applyModelDefaults', () => {
    it('clamps stale xhigh effort when switching to a custom sonnet model', () => {
      const settings: Record<string, unknown> = {
        effortLevel: 'xhigh',
        providerConfigs: {},
      };

      claudeChatUIConfig.applyModelDefaults('claude-sonnet-4-5', settings);

      expect(settings.effortLevel).toBe('high');
      expect(settings.lastCustomModel).toBe('claude-sonnet-4-5');
    });

    it('preserves xhigh on custom opus models that support it', () => {
      const settings: Record<string, unknown> = {
        effortLevel: 'xhigh',
        providerConfigs: {},
      };

      claudeChatUIConfig.applyModelDefaults('claude-opus-4-7', settings);

      expect(settings.effortLevel).toBe('xhigh');
    });
  });
});
