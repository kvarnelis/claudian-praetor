import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import test from 'node:test';

function listTypeScriptFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...listTypeScriptFiles(entryPath));
    else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(entryPath);
  }
  return files;
}

function findMatches(roots, pattern) {
  const matches = [];
  for (const root of roots) {
    for (const file of listTypeScriptFiles(root)) {
      if (pattern.test(fs.readFileSync(file, 'utf8'))) {
        matches.push(path.relative(process.cwd(), file));
      }
    }
  }
  return matches;
}

const sourceRoot = path.join(process.cwd(), 'src');
const providerRoot = path.join(sourceRoot, 'providers');

// Read off the provider layer instead of hardcoding a roster, so a newly added
// provider is held to these boundaries without anyone remembering to edit this
// file. Grok shipped exempt for exactly that reason.
const providerNames = fs
  .readdirSync(providerRoot, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)
  .sort();

// Naming the directories keeps `core/providers/...` abstractions importable.
const providerImport = `providers/(?:${providerNames
  .map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|')})`;

test('the provider roster is derived from the provider layer', () => {
  assert.ok(providerNames.length > 0, 'no provider directories found under src/providers');

  const registrations = fs.readFileSync(path.join(providerRoot, 'index.ts'), 'utf8');
  const registered = [...registrations.matchAll(/from\s+'\.\/([^/']+)\//g)].map(match => match[1]);
  assert.ok(registered.length > 0, 'no built-in provider registrations found in src/providers/index.ts');

  const unmatched = registered.filter(name => !providerNames.includes(name)).sort();
  assert.deepEqual(unmatched, []);
});

test('core is independent from main, features, and concrete providers', () => {
  const pattern = new RegExp(`from\\s+['"][^'"]*(?:main['"]|features/|${providerImport})`);
  assert.deepEqual(findMatches([path.join(sourceRoot, 'core')], pattern), []);
});

test('providers are independent from main and features', () => {
  const pattern = /from\s+['"][^'"]*(?:main['"]|features\/)/;
  assert.deepEqual(findMatches([providerRoot], pattern), []);
});

test('features are independent from the composition root and app adapters', () => {
  const pattern = /from\s+['"][^'"]*(?:main['"]|app\/)/;
  assert.deepEqual(findMatches([path.join(sourceRoot, 'features')], pattern), []);
});

test('features and shared UI are independent from concrete providers', () => {
  const pattern = new RegExp(`from\\s+['"][^'"]*${providerImport}`);
  assert.deepEqual(findMatches([
    path.join(sourceRoot, 'features'),
    path.join(sourceRoot, 'shared'),
  ], pattern), []);
});

test('persisted settings changes use the coordinator boundary', () => {
  const matches = findMatches([sourceRoot], /\.saveSettings\(\)/).filter(file => ![
    'src/main.ts',
    'src/app/providers/PraetorProviderHost.ts',
  ].includes(file));
  assert.deepEqual(matches, []);
});
