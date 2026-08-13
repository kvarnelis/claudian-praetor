// Deliberately retain Claudian's vault paths so existing settings and sessions
// remain available after installing Claude's Codex under its independent plugin id.
export const CLAUDES_CODEX_STORAGE_PATH = '.claudian';

export const LEGACY_CLAUDES_CODEX_SETTINGS_PATH = '.claude/claudian-settings.json';
export const CLAUDES_CODEX_SETTINGS_PATH = `${CLAUDES_CODEX_STORAGE_PATH}/claudian-settings.json`;

export const LEGACY_SESSIONS_PATH = '.claude/sessions';
export const SESSIONS_PATH = `${CLAUDES_CODEX_STORAGE_PATH}/sessions`;
