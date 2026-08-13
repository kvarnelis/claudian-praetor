// Deliberately retain Claudian's vault paths so existing settings and sessions
// remain available after installing Pocket Codex under its independent plugin id.
export const POCKET_CODEX_STORAGE_PATH = '.claudian';

export const LEGACY_POCKET_CODEX_SETTINGS_PATH = '.claude/claudian-settings.json';
export const POCKET_CODEX_SETTINGS_PATH = `${POCKET_CODEX_STORAGE_PATH}/claudian-settings.json`;

export const LEGACY_SESSIONS_PATH = '.claude/sessions';
export const SESSIONS_PATH = `${POCKET_CODEX_STORAGE_PATH}/sessions`;
