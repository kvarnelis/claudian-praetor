/**
 * Lazy Node builtin access for modules shared between desktop and mobile.
 *
 * Obsidian ships a single CJS bundle to every platform. On iOS/Android there
 * is no Node runtime, so a top-level `import * as fs from 'fs'` aborts the
 * whole plugin at load time. Replacing those imports with
 * `const fs = requireNodeModule<typeof import('fs')>('fs')` keeps desktop
 * behavior identical (the real module resolves) while mobile receives a shim.
 *
 * The shim matters: shared chat UI (tab construction, file context, plan mode,
 * path display) calls `path`/`fs`/`os` on the mobile import graph. A proxy that
 * *throws* on access turns every such call into a crash that aborts the action
 * (e.g. "Failed to create tab: Node module 'fs' is unavailable"). Instead:
 *   - `path` is pure string math with no host dependency, so we provide a real
 *     POSIX implementation — calls behave correctly on mobile.
 *   - `os`/`fs` genuinely need the host; they degrade to safe no-ops (homedir
 *     '', existsSync false, realpathSync identity) so callers get a sane value
 *     instead of an exception. The daemon does the real filesystem work.
 * Anything without a shim still returns a throwing proxy (loud, not silent).
 */

function posixNormalize(input: string): string {
  const isAbsolute = input.startsWith('/');
  const hasTrailingSlash = input.length > 1 && input.endsWith('/');
  const out: string[] = [];
  for (const segment of input.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (out.length && out[out.length - 1] !== '..') out.pop();
      else if (!isAbsolute) out.push('..');
    } else {
      out.push(segment);
    }
  }
  let result = out.join('/');
  if (isAbsolute) result = '/' + result;
  else if (!result) result = '.';
  // Node preserves a trailing slash (except on bare root).
  if (hasTrailingSlash && result !== '/' && !result.endsWith('/')) result += '/';
  return result;
}

const pathShim = {
  sep: '/',
  delimiter: ':',
  isAbsolute: (p: string): boolean => typeof p === 'string' && p.startsWith('/'),
  normalize: (p: string): string => posixNormalize(p),
  join: (...parts: string[]): string => {
    const joined = parts.filter((p) => typeof p === 'string' && p.length > 0).join('/');
    return joined ? posixNormalize(joined) : '.';
  },
  resolve: (...parts: string[]): string => {
    let resolved = '';
    let isAbsolute = false;
    for (let i = parts.length - 1; i >= 0 && !isAbsolute; i--) {
      const part = parts[i];
      if (!part) continue;
      resolved = resolved ? `${part}/${resolved}` : part;
      isAbsolute = part.startsWith('/');
    }
    // No cwd on mobile; anchor unresolved relatives at root.
    if (!isAbsolute) resolved = `/${resolved}`;
    return posixNormalize(resolved) || '/';
  },
  dirname: (p: string): string => {
    if (!p) return '.';
    const trimmed = p.replace(/\/+$/, '');
    if (trimmed === '') return '/'; // p was all slashes (root)
    const idx = trimmed.lastIndexOf('/');
    if (idx < 0) return '.';
    if (idx === 0) return '/';
    return trimmed.slice(0, idx);
  },
  basename: (p: string, ext?: string): string => {
    let base = p.replace(/\/+$/, '').split('/').pop() ?? '';
    if (ext && base.length > ext.length && base.endsWith(ext)) {
      base = base.slice(0, -ext.length);
    }
    return base;
  },
  extname: (p: string): string => {
    const base = p.split('/').pop() ?? '';
    const dot = base.lastIndexOf('.');
    return dot > 0 ? base.slice(dot) : '';
  },
  relative: (from: string, to: string): string => {
    const f = posixNormalize(from).split('/').filter(Boolean);
    const t = posixNormalize(to).split('/').filter(Boolean);
    let i = 0;
    while (i < f.length && i < t.length && f[i] === t[i]) i++;
    return [...f.slice(i).map(() => '..'), ...t.slice(i)].join('/');
  },
} as Record<string, unknown>;
// Mobile is never win32; alias these so `path.win32.x`/`path.posix.x` resolve.
pathShim.win32 = pathShim;
pathShim.posix = pathShim;

const realpathIdentity = Object.assign((p: string): string => p, {
  native: (p: string): string => p,
});

const fsShim = {
  existsSync: (): boolean => false,
  realpathSync: realpathIdentity,
  readdirSync: (): string[] => [],
  readFileSync: (): never => {
    throw new Error('fs.readFileSync is unavailable on mobile');
  },
  statSync: (): never => {
    throw new Error('fs.statSync is unavailable on mobile');
  },
  lstatSync: (): never => {
    throw new Error('fs.lstatSync is unavailable on mobile');
  },
  writeFileSync: (): void => undefined,
  mkdirSync: (): void => undefined,
} as Record<string, unknown>;

const osShim = {
  homedir: (): string => '',
  tmpdir: (): string => '/tmp',
  platform: (): string => 'ios',
  hostname: (): string => 'mobile',
  EOL: '\n',
} as Record<string, unknown>;

const MOBILE_SHIMS: Record<string, unknown> = {
  path: pathShim,
  fs: fsShim,
  os: osShim,
};

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
    // Fall through to the mobile shim / unavailable stub below.
  }

  const shim = MOBILE_SHIMS[name];
  if (shim) {
    return shim as T;
  }

  return new Proxy(Object.create(null) as object, {
    get(_target, property) {
      throw new Error(
        `Node module '${name}' is unavailable on this platform (tried to access '${String(property)}')`,
      );
    },
  }) as T;
}
