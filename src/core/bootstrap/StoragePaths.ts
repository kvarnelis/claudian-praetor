// Deliberately retain Claudian's vault paths so existing settings and sessions
// remain available after installing Praetor under its independent plugin id.
export const PRAETOR_STORAGE_PATH = '.claudian';

export const LEGACY_PRAETOR_SETTINGS_PATH = '.claude/claudian-settings.json';
export const PRAETOR_SETTINGS_PATH = `${PRAETOR_STORAGE_PATH}/claudian-settings.json`;

export const LEGACY_SESSIONS_PATH = '.claude/sessions';
export const SESSIONS_PATH = `${PRAETOR_STORAGE_PATH}/sessions`;
