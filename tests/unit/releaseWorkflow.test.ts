import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const releaseWorkflow = readFileSync(join(process.cwd(), '.github/workflows/release.yml'), 'utf8');

describe('release workflow', () => {
  it('builds and publishes the bundled Praetor daemon asset', () => {
    expect(releaseWorkflow).toContain('npm run build:daemon');
    expect(releaseWorkflow).toContain('daemon/dist/praetord.cjs');
  });
});
