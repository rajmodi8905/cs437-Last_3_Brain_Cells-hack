import { defineConfig } from '@playwright/test';
import base from './playwright.config';
// Playwright WebKit is additional engine evidence, not an installed Safari/iOS version.
export default defineConfig({
  ...base,
  testMatch: [
    'e2e/**/*.spec.ts',
    'acceptance/models.spec.ts',
    'acceptance/offline.spec.ts',
    'acceptance/wasm-backend.spec.ts',
  ],
  outputDir: 'test-results/webkit',
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report/webkit' }]],
  use: { ...base.use, browserName: 'webkit' },
});
