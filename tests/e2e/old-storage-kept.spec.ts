// The app was called Campus Recall before. Starting the app must not delete what is stored
// under the old names: a library kept there stays on the device, and nothing the app does at
// start removes it (#71).
import { test, expect } from '@playwright/test';

const OLD_CACHE = 'campus-recall-assets-v1';
const OLD_DATABASES = ['campus-recall', 'campus-recall-pilot-sync-Account0123456789'];

test('starting the app keeps the storage kept under the old name', async ({ page }) => {
  // A page of this origin that does not start the app.
  await page.goto('/icon.svg');
  await page.evaluate(
    async ({ cacheName, databaseNames }) => {
      await (await caches.open(cacheName)).put('/old-model.bin', new Response('old bytes'));
      for (const name of databaseNames)
        await new Promise<void>((resolve, reject) => {
          const request = indexedDB.open(name);
          request.onupgradeneeded = () => request.result.createObjectStore('rows');
          request.onsuccess = () => {
            request.result.close();
            resolve();
          };
          request.onerror = () => reject(request.error);
        });
    },
    { cacheName: OLD_CACHE, databaseNames: OLD_DATABASES },
  );

  await page.goto('/#/library');
  await expect(page.getByRole('heading', { name: 'Your library' })).toBeVisible();
  // The library the app uses now exists, so start-up has run.
  await expect
    .poll(() =>
      page.evaluate(async () => (await indexedDB.databases()).map((entry) => entry.name ?? '')),
    )
    .toContain('anyrecall');

  const after = await page.evaluate(async () => ({
    caches: await caches.keys(),
    databases: (await indexedDB.databases()).map((entry) => entry.name ?? ''),
  }));
  expect(after.caches).toContain(OLD_CACHE);
  for (const name of OLD_DATABASES) expect(after.databases).toContain(name);
});
