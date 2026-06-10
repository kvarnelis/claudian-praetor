/**
 * Minimal Obsidian `App` facsimile backed by fs.promises, sufficient for
 * VaultFileAdapter (and anything else that goes through
 * `app.vault.adapter.*` / `getVaultPath(app)`).
 *
 * Path semantics mirror Obsidian's DataAdapter: vault-relative,
 * '/'-separated, and `list()` returns vault-relative paths (folder prefix
 * included) for both files and folders.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface NodeVaultStat {
  type: 'file' | 'folder';
  ctime: number;
  mtime: number;
  size: number;
}

export interface NodeVaultAdapter {
  basePath: string;
  exists(p: string): Promise<boolean>;
  read(p: string): Promise<string>;
  write(p: string, content: string): Promise<void>;
  remove(p: string): Promise<void>;
  rmdir(p: string, recursive: boolean): Promise<void>;
  list(p: string): Promise<{ files: string[]; folders: string[] }>;
  mkdir(p: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  stat(p: string): Promise<NodeVaultStat | null>;
}

export interface NodeVaultApp {
  vault: {
    adapter: NodeVaultAdapter;
    getName(): string;
  };
}

function normalizeRelative(p: string): string {
  let rel = String(p ?? '').replace(/\\/g, '/');
  rel = rel.replace(/\/+/g, '/');
  while (rel.startsWith('./')) rel = rel.slice(2);
  rel = rel.replace(/^\/+/, '');
  rel = rel.replace(/\/+$/, '');
  return rel === '.' ? '' : rel;
}

export function createNodeVaultApp(vaultPath: string): NodeVaultApp {
  const basePath = path.resolve(vaultPath);

  const toAbsolute = (p: string): string => {
    const rel = normalizeRelative(p);
    const abs = path.resolve(basePath, rel);
    if (abs !== basePath && !abs.startsWith(basePath + path.sep)) {
      throw new Error(`Path escapes vault root: ${p}`);
    }
    return abs;
  };

  const adapter: NodeVaultAdapter = {
    basePath,

    async exists(p: string): Promise<boolean> {
      try {
        await fs.promises.access(toAbsolute(p));
        return true;
      } catch {
        return false;
      }
    },

    async read(p: string): Promise<string> {
      return fs.promises.readFile(toAbsolute(p), 'utf-8');
    },

    async write(p: string, content: string): Promise<void> {
      const abs = toAbsolute(p);
      await fs.promises.mkdir(path.dirname(abs), { recursive: true });
      await fs.promises.writeFile(abs, content, 'utf-8');
    },

    async remove(p: string): Promise<void> {
      await fs.promises.unlink(toAbsolute(p));
    },

    async rmdir(p: string, recursive: boolean): Promise<void> {
      await fs.promises.rm(toAbsolute(p), { recursive, force: false });
    },

    async list(p: string): Promise<{ files: string[]; folders: string[] }> {
      const rel = normalizeRelative(p);
      const entries = await fs.promises.readdir(toAbsolute(p), { withFileTypes: true });
      const files: string[] = [];
      const folders: string[] = [];
      for (const entry of entries) {
        const childRel = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          folders.push(childRel);
        } else if (entry.isFile() || entry.isSymbolicLink()) {
          files.push(childRel);
        }
      }
      return { files, folders };
    },

    async mkdir(p: string): Promise<void> {
      await fs.promises.mkdir(toAbsolute(p), { recursive: true });
    },

    async rename(oldPath: string, newPath: string): Promise<void> {
      const absNew = toAbsolute(newPath);
      await fs.promises.mkdir(path.dirname(absNew), { recursive: true });
      await fs.promises.rename(toAbsolute(oldPath), absNew);
    },

    async stat(p: string): Promise<NodeVaultStat | null> {
      try {
        const st = await fs.promises.stat(toAbsolute(p));
        return {
          type: st.isDirectory() ? 'folder' : 'file',
          ctime: st.ctimeMs,
          mtime: st.mtimeMs,
          size: st.size,
        };
      } catch {
        return null;
      }
    },
  };

  return {
    vault: {
      adapter,
      getName: () => path.basename(basePath),
    },
  };
}
