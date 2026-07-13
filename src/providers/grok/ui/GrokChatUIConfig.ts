import { getRuntimeEnvironmentVariables } from '../../../core/providers/providerEnvironment';
import type {
  ProviderChatUIConfig,
  ProviderIconSvg,
  ProviderPermissionModeToggleConfig,
  ProviderReasoningOption,
  ProviderUIOption,
} from '../../../core/providers/types';
import { getGrokCatalogModelOptions } from '../grokModelCatalog';

export const XAI_PROVIDER_ICON: ProviderIconSvg = {
  viewBox: '0 0 24 24',
  path: 'M3.787 9.362 12.039 21h3.668L7.454 9.362H3.787Zm3.664 6.464L3.782 21h3.671l1.833-2.586-1.835-2.588ZM16.547 3l-6.343 8.944 1.835 2.588L20.217 3h-3.67Zm.664 5.534V21h3.006V4.294l-3.006 4.24Z',
};

export const GROK_MODELS: ProviderUIOption[] = [
  { value: 'grok-build', label: 'Grok Build', description: 'xAI coding agent' },
];

const GROK_EFFORT_LEVELS: ProviderReasoningOption[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'XHigh' },
  { value: 'max', label: 'Max' },
];

const GROK_PERMISSION_MODE_TOGGLE: ProviderPermissionModeToggleConfig = {
  inactiveValue: 'normal',
  inactiveLabel: 'Safe',
  activeValue: 'yolo',
  activeLabel: 'YOLO',
  planValue: 'plan',
  planLabel: 'Plan',
};

function looksLikeGrokModel(model: string): boolean {
  return /^grok-/i.test(model);
}

function getBaseGrokModelOptions(): ProviderUIOption[] {
  const catalog = getGrokCatalogModelOptions();
  return catalog ? [...catalog] : [...GROK_MODELS];
}

export const grokChatUIConfig: ProviderChatUIConfig = {
  getModelOptions(settings: Record<string, unknown>): ProviderUIOption[] {
    const models = getBaseGrokModelOptions();
    const envVars = getRuntimeEnvironmentVariables(settings, 'grok');
    const customModel = envVars.GROK_MODEL || envVars.XAI_MODEL;
    if (customModel && !models.some(model => model.value === customModel)) {
      models.unshift({ value: customModel, label: customModel, description: 'Custom (env)' });
    }

    return models;
  },

  ownsModel(model: string, settings: Record<string, unknown>): boolean {
    if (this.getModelOptions(settings).some((option) => option.value === model)) {
      return true;
    }

    return looksLikeGrokModel(model);
  },

  isAdaptiveReasoningModel(_model: string, _settings: Record<string, unknown>): boolean {
    return true;
  },

  getReasoningOptions(_model: string, _settings: Record<string, unknown>): ProviderReasoningOption[] {
    return [...GROK_EFFORT_LEVELS];
  },

  getDefaultReasoningValue(_model: string, _settings: Record<string, unknown>): string {
    return 'high';
  },

  getContextWindowSize(model: string, customLimits?: Record<string, number>): number {
    return customLimits?.[model] ?? 256_000;
  },

  isDefaultModel(model: string): boolean {
    return getBaseGrokModelOptions().some(option => option.value === model);
  },

  applyModelDefaults(): void {
    // Grok Build has no per-model defaults to apply.
  },

  normalizeModelVariant(model: string, settings: Record<string, unknown>): string {
    return this.ownsModel(model, settings) ? model : GROK_MODELS[0].value;
  },

  getCustomModelIds(envVars: Record<string, string>): Set<string> {
    const ids = new Set<string>();
    const customModel = envVars.GROK_MODEL || envVars.XAI_MODEL;
    if (customModel && !getBaseGrokModelOptions().some(model => model.value === customModel)) {
      ids.add(customModel);
    }
    return ids;
  },

  getPermissionModeToggle(): ProviderPermissionModeToggleConfig {
    return GROK_PERMISSION_MODE_TOGGLE;
  },

  getProviderIcon() {
    return XAI_PROVIDER_ICON;
  },
};
