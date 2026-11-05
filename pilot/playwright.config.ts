import { defineConfig } from '@playwright/test';

const port = 4610;
// Builds the app fresh and starts the local pilot server with a development signing key.
export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  outputDir: '../test-results/pilot-e2e',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    browserName: 'chromium',
    acceptDownloads: true,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `node pilot/scripts/dev-key.mjs && npm run build && PILOT_DEV_KEY_FILE=.cache/pilot-dev-key/dev-private.pem PILOT_PORT=${port} npm run pilot:server`,
    cwd: '..',
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
