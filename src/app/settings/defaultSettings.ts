import { getDefaultHiddenProviderCommands } from '../../core/providers/commands/hiddenCommands';
import { DEFAULT_REASONING_VALUE } from '../../core/providers/reasoning';
import { type ClaudesCodexSettings } from '../../core/types/settings';
import { getBuiltInProviderDefaultConfigs } from '../../providers/defaultProviderConfigs';

export const DEFAULT_CLAUDES_CODEX_SETTINGS: ClaudesCodexSettings = {
  userName: '',

  permissionMode: 'yolo',

  model: 'haiku',
  thinkingBudget: 'off',
  effortLevel: DEFAULT_REASONING_VALUE,
  serviceTier: 'default',
  enableAutoTitleGeneration: true,
  titleGenerationModel: '',

  excludedTags: [],
  mediaFolder: '',
  systemPrompt: '',
  persistentExternalContextPaths: [],

  sharedEnvironmentVariables: '',
  envSnippets: [],
  customContextLimits: {},
  customModelAliases: {},

  keyboardNavigation: {
    scrollUpKey: 'w',
    scrollDownKey: 's',
    focusInputKey: 'i',
  },
  requireCommandOrControlEnterToSend: false,

  locale: 'en',

  providerConfigs: getBuiltInProviderDefaultConfigs(),

  settingsProvider: 'claude',
  savedProviderModel: {},
  savedProviderEffort: {},
  savedProviderServiceTier: {},
  savedProviderThinkingBudget: {},
  savedProviderPermissionMode: {},
  pendingProviderSessionInvalidations: {},

  lastCustomModel: '',

  maxTabs: 3,
  enableAutoScroll: true,
  deferMathRenderingDuringStreaming: true,
  expandFileEditsByDefault: false,
  useThemeNativeAppearance: false,
  chatViewPlacement: 'right-sidebar',

  hiddenProviderCommands: getDefaultHiddenProviderCommands(),
};
