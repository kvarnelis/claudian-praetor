/**
 * Lazy Node builtin access for modules shared between desktop and mobile.
 *
 * Obsidian ships a single CJS bundle to every platform. On iOS/Android there
 * is no Node runtime, so a top-level `import * as fs from 'fs'` aborts the
 * whole plugin at load time. Replacing those imports with
 * `const fs = requireNodeModule<typeof import('fs')>('fs')` keeps desktop
 * behavior identical (the real module resolves) while mobile receives a stub
 * that only throws when a Node API is actually *used* — never at import time.
 */
export function requireNodeModule<T>(name: string): T {
  try {
    if (typeof require === 'function') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const resolved = require(name) as T | null | undefined;
      // Some loaders return undefined instead of throwing for unknown modules.
      if (resolved != null) {
        return resolved;
      }
    }
  } catch {
    // Fall through to the unavailable-module stub below.
  }

  return new Proxy(Object.create(null) as object, {
    get(_target, property) {
      throw new Error(
        `Node module '${name}' is unavailable on this platform (tried to access '${String(property)}')`,
      );
    },
  }) as T;
}
