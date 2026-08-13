const { spawnSync } = require('child_process');
const os = require('os');
const path = require('path');

const jestPath = require.resolve('jest/bin/jest');
const localStorageFile = path.join(os.tmpdir(), 'pocket-codex-localstorage');

const result = spawnSync(
  process.execPath,
  [
    // Web Storage is flag-gated on Node 24 (the engines range); default-on from Node 25
    '--experimental-webstorage',
    `--localstorage-file=${localStorageFile}`,
    jestPath,
    ...process.argv.slice(2),
  ],
  { stdio: 'inherit' }
);

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
