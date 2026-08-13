import type { ProviderConfigMap } from '../core/types/settings';
import { DEFAULT_CLAUDE_PROVIDER_SETTINGS } from './claude/settings';
import { DEFAULT_CODEX_PROVIDER_CONFIG } from './codex/settings';
import { DEFAULT_GROK_PROVIDER_SETTINGS } from './grok/settings';

export function getBuiltInProviderDefaultConfigs(): ProviderConfigMap {
  return {
    claude: { ...DEFAULT_CLAUDE_PROVIDER_SETTINGS },
    grok: { ...DEFAULT_GROK_PROVIDER_SETTINGS },
    codex: { ...DEFAULT_CODEX_PROVIDER_CONFIG },
  };
}
