const LOCAL_DAEMON_HOST_ENABLED_KEY = 'claudian-praetor.mobileDaemon.hostThisMac';

function getLocalStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function isLocalDaemonHostEnabled(): boolean {
  return getLocalStorage()?.getItem(LOCAL_DAEMON_HOST_ENABLED_KEY) === 'true';
}

export function setLocalDaemonHostEnabled(enabled: boolean): void {
  const storage = getLocalStorage();
  if (!storage) return;

  try {
    if (enabled) {
      storage.setItem(LOCAL_DAEMON_HOST_ENABLED_KEY, 'true');
    } else {
      storage.removeItem(LOCAL_DAEMON_HOST_ENABLED_KEY);
    }
  } catch {
    // localStorage can be unavailable in restricted renderer contexts.
  }
}

export { LOCAL_DAEMON_HOST_ENABLED_KEY };
