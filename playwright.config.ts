import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests',
  testMatch: ['e2e/**/*.spec.ts', 'acceptance/**/*.spec.ts'],
  timeout: 120000,
  expect: { timeout: 15000 },
  workers: 1,
  fullyParallel: false,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4174',
    browserName: 'chromium',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'npm run qa:webpages',
      url: 'http://127.0.0.1:4181',
      reuseExistingServer: true,
      timeout: 10000,
    },
    {
      command: 'node scripts/test-asset-server.mjs',
      url: 'http://127.0.0.1:4180',
      ignoreHTTPSErrors: true,
      reuseExistingServer: true,
      timeout: 10000,
    },
    {
      command:
        'node scripts/build-test-app.mjs && npx vite preview --outDir .cache/acceptance-dist --host 127.0.0.1 --port 4173',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: true,
      timeout: 120000,
    },
    {
      command: 'npm run preview -- --port 4174',
      url: 'http://127.0.0.1:4174',
      reuseExistingServer: true,
      timeout: 120000,
    },
  ],
});
