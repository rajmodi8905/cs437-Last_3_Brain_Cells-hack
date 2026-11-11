// Builds the engine host page (docs/pilot/whatsapp.md) into .cache/engine-host-dist, apart from
// the published app build in dist/.
import { execFileSync } from 'node:child_process';
execFileSync(process.execPath, ['scripts/prepare-assets.mjs'], { stdio: 'inherit' });
execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], {
  stdio: 'inherit',
  env: { ...process.env, ENGINE_HOST_BUILD: '1' },
});
