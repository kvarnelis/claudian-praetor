/**
 * Provider code written for Obsidian's webview reaches `window.*` for a small
 * set of APIs (timers, localStorage for the device-settings key, crypto).
 * Node has no `window`; provide a minimal distinct object — NOT an alias of
 * globalThis, because Node >= 22 ships a stub `localStorage` global whose
 * methods throw without --localstorage-file. The in-memory localStorage shim
 * reproduces the pre-window fallback behavior (fresh device key per process,
 * provider CLI resolution falls back to PATH search). This module must stay
 * the first import of the daemon entry point.
 */
const g = globalThis as Record<string, unknown>;
if (typeof g.window === 'undefined') {
  const mem = new Map<string, string>();
  g.window = {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    setInterval: globalThis.setInterval.bind(globalThis),
    clearInterval: globalThis.clearInterval.bind(globalThis),
    crypto: globalThis.crypto,
    localStorage: {
      getItem: (key: string): string | null => mem.get(key) ?? null,
      setItem: (key: string, value: string): void => {
        mem.set(key, String(value));
      },
      removeItem: (key: string): void => {
        mem.delete(key);
      },
    },
  };
}
export {};
