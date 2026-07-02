import type { ModelInfo } from '@anthropic-ai/claude-agent-sdk';

import {
  clearCliModelCatalog,
  getCliEffortLevels,
  getCliModelOptions,
  setCliModelCatalog,
} from '@/providers/claude/modelCatalog';

// Shape reported by Claude Code CLI 2.1.174 via supportedModels()
const CLI_MODELS: ModelInfo[] = [
  {
    value: 'default',
    displayName: 'Default (recommended)',
    description: 'Opus 4.8 · Best for everyday, complex tasks',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  {
    value: 'opus',
    displayName: 'Opus',
    description: 'Opus 4.8 · Best for everyday, complex tasks',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  {
    value: 'claude-fable-5[1m]',
    displayName: 'Fable',
    description: 'Fable 5 · Most capable for your hardest and longest-running tasks',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  {
    value: 'sonnet',
    displayName: 'Sonnet',
    description: 'Sonnet 4.6 · Efficient for routine tasks',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'max'],
  },
  {
    value: 'haiku',
    displayName: 'Haiku',
    description: 'Haiku 4.5 · Fastest for quick answers',
  },
];

describe('modelCatalog', () => {
  afterEach(() => {
    clearCliModelCatalog();
  });

  describe('getCliModelOptions', () => {
    it('returns null before any catalog is set', () => {
      expect(getCliModelOptions()).toBeNull();
    });

    it('returns null again after clearing', () => {
      setCliModelCatalog(CLI_MODELS);
      clearCliModelCatalog();
      expect(getCliModelOptions()).toBeNull();
    });

    it('drops the default pseudo-entry and reverses to ascending capability order', () => {
      setCliModelCatalog(CLI_MODELS);
      const values = getCliModelOptions()?.map((o) => o.value);
      expect(values).toEqual([
        'haiku',
        'sonnet',
        'sonnet[1m]',
        'claude-fable-5[1m]',
        'opus',
        'opus[1m]',
      ]);
    });

    it('synthesizes 1M variants for the opus and sonnet family aliases', () => {
      setCliModelCatalog(CLI_MODELS);
      const options = getCliModelOptions() ?? [];
      const opus1M = options.find((o) => o.value === 'opus[1m]');
      expect(opus1M).toEqual({
        value: 'opus[1m]',
        label: 'Opus 1M',
        description: 'Opus 4.8 · Best for everyday, complex tasks (1M context window)',
      });
    });

    it('uses CLI display names and descriptions verbatim for plain entries', () => {
      setCliModelCatalog(CLI_MODELS);
      const options = getCliModelOptions() ?? [];
      const fable = options.find((o) => o.value === 'claude-fable-5[1m]');
      expect(fable).toEqual({
        value: 'claude-fable-5[1m]',
        label: 'Fable',
        description: 'Fable 5 · Most capable for your hardest and longest-running tasks',
      });
    });

    it('returns null for an empty catalog', () => {
      setCliModelCatalog([]);
      expect(getCliModelOptions()).toBeNull();
    });
  });

  describe('getCliEffortLevels', () => {
    it('returns null before any catalog is set', () => {
      expect(getCliEffortLevels('opus')).toBeNull();
    });

    it('returns the reported levels for an exact value match', () => {
      setCliModelCatalog(CLI_MODELS);
      expect(getCliEffortLevels('sonnet')).toEqual(['low', 'medium', 'high', 'max']);
      expect(getCliEffortLevels('claude-fable-5[1m]')).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    });

    it('falls back to the base entry for synthesized 1M variants', () => {
      setCliModelCatalog(CLI_MODELS);
      expect(getCliEffortLevels('opus[1m]')).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    });

    it('returns null for models without effort support or unknown models', () => {
      setCliModelCatalog(CLI_MODELS);
      expect(getCliEffortLevels('haiku')).toBeNull();
      expect(getCliEffortLevels('claude-unknown-9')).toBeNull();
    });
  });
});
