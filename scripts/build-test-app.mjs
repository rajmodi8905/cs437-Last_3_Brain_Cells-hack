import { execFileSync } from 'node:child_process';
import { cp } from 'node:fs/promises';
execFileSync(process.execPath, ['scripts/prepare-assets.mjs'], { stdio: 'inherit' });
execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], {
  stdio: 'inherit',
  env: { ...process.env, ACCEPTANCE_BUILD: '1' },
});
await cp('tests/fixtures', '.cache/acceptance-dist/tests/fixtures', { recursive: true });
