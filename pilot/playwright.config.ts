import { defineConfig } from '@playwright/test';

const port = 4610;
export const googlePort = 4611;
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
  webServer: [
    {
      command: `node pilot/scripts/dev-key.mjs && npm run build && PILOT_DEV_KEY_FILE=.cache/pilot-dev-key/dev-private.pem PILOT_PORT=${port} npm run pilot:server`,
      cwd: '..',
      url: `http://127.0.0.1:${port}`,
      reuseExistingServer: false,
      timeout: 300_000,
    },
    {
      // The same build in Google sign-in mode, with placeholder client values. Tests intercept
      // Google's page and only use Google-free outcomes, so nothing reaches Google.
      command: `until curl -sf http://127.0.0.1:${port} >/dev/null; do sleep 1; done; PILOT_GOOGLE_CLIENT_ID=pilot-e2e.apps.googleusercontent.com PILOT_GOOGLE_CLIENT_SECRET=placeholder-not-a-secret PILOT_PORT=${googlePort} node .cache/pilot-server/main.mjs`,
      cwd: '..',
      url: `http://127.0.0.1:${googlePort}`,
      reuseExistingServer: false,
      timeout: 300_000,
    },
  ],
});
