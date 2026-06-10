/**
 * Builds praetord into a single CJS file. Mirrors the SDK import.meta patch
 * from the root esbuild.config.mjs (cjs output has no import.meta); the
 * renderer-unref patch is intentionally skipped — praetord runs in real Node.
 */

import esbuild from 'esbuild';
import { promises as fsPromises } from 'fs';
import { builtinModules } from 'module';
import * as path from 'path';
import { fileURLToPath } from 'url';

const daemonDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(daemonDir, '..');

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getNamedImportAliases(contents, importedName, moduleNames) {
  const aliases = new Set();
  const moduleAlternatives = moduleNames.map(escapeRegExp).join('|');
  const importPattern = new RegExp(
    `import\\s*\\{([^}]*)\\}\\s*from\\s*["'](?:${moduleAlternatives})["']`,
    'g',
  );
  for (const match of contents.matchAll(importPattern)) {
    for (const segment of match[1].split(',')) {
      const [name, alias] = segment.split(/\s+as\s+/).map((part) => part.trim());
      if (name === importedName) {
        aliases.add(alias ?? name);
      }
    }
  }
  return aliases;
}

function patchSdkImportMetaUrl(contents) {
  let patched = contents.replace(
    'createRequire(import.meta.url)',
    'createRequire(__filename)',
  );
  for (const alias of getNamedImportAliases(patched, 'createRequire', ['module', 'node:module'])) {
    patched = patched.replace(
      new RegExp(`\\b${escapeRegExp(alias)}\\(import\\.meta\\.url\\)`, 'g'),
      `${alias}(__filename)`,
    );
  }
  for (const alias of getNamedImportAliases(patched, 'fileURLToPath', ['url', 'node:url'])) {
    patched = patched.replace(
      new RegExp(`\\b${escapeRegExp(alias)}\\(import\\.meta\\.url\\)`, 'g'),
      '__filename',
    );
  }
  return patched;
}

const patchSdkImportMeta = {
  name: 'patch-sdk-import-meta',
  setup(build) {
    build.onLoad(
      {
        filter: /[\\/]node_modules[\\/](?:@openai[\\/]codex-sdk[\\/]dist[\\/]index\.js|@anthropic-ai[\\/]claude-agent-sdk[\\/]sdk\.mjs)$/,
      },
      async (args) => {
        const contents = await fsPromises.readFile(args.path, 'utf8');
        return { contents: patchSdkImportMetaUrl(contents), loader: 'js' };
      },
    );
  },
};

await esbuild.build({
  entryPoints: [path.join(daemonDir, 'src', 'index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  outfile: path.join(daemonDir, 'dist', 'praetord.cjs'),
  alias: {
    obsidian: path.join(daemonDir, 'src', 'obsidianStub.ts'),
  },
  external: [
    'electron',
    ...builtinModules,
    ...builtinModules.map((m) => `node:${m}`),
  ],
  plugins: [patchSdkImportMeta],
  logLevel: 'info',
  absWorkingDir: repoRoot,
});

console.log('praetord built: daemon/dist/praetord.cjs');
