import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

// Deliberately separate from the quick pilot browser suite: this check runs pinned real models.
// Download assets once with models:download, then run:
// CR_PILOT_MODEL_EVIDENCE_DIR=/absolute/evidence npx playwright test --config pilot/real-model.config.ts
const evidence = resolve(process.env.CR_PILOT_MODEL_EVIDENCE_DIR ?? '/tmp/anyrecall-pilot-model');
const port = 4612;
export default defineConfig({
  testDir: 'model-e2e',
  timeout: 600_000,
  expect: { timeout: 30_000 },
  workers: 1,
  fullyParallel: false,
  outputDir: `${evidence}/artifacts`,
  reporter: [['list'], ['json', { outputFile: `${evidence}/results.json` }]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    browserName: 'chromium',
    viewport: { width: 1440, height: 900 },
    trace: 'off',
  },
  webServer: [
    {
      command: 'node scripts/test-asset-server.mjs',
      cwd: '..',
      url: 'http://127.0.0.1:4180',
      reuseExistingServer: false,
      timeout: 10_000,
    },
    {
      command: `node pilot/scripts/dev-key.mjs && npm run build && npm run build:engine-host && PILOT_SIGN_IN_PER_MINUTE=1000 PILOT_DEV_KEY_FILE=.cache/pilot-dev-key/dev-private.pem PILOT_PORT=${port} npm run pilot:server`,
      cwd: '..',
      url: `http://127.0.0.1:${port}`,
      reuseExistingServer: false,
      timeout: 300_000,
    },
  ],
});
