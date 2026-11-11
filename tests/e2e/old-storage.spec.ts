// The app was called Campus Recall before; its storage names changed with its name. Starting
// the app in a real browser deletes what an earlier version kept under the old names, and
// nothing else on the origin.
import { test, expect } from '@playwright/test';

const OLD_CACHES = ['campus-recall-assets-v1', 'campus-recall-share'];
const OLD_DATABASES = ['campus-recall', 'campus-recall-pilot-sync-Account0123456789'];
const OTHER_CACHE = 'someone-elses-cache';
const OTHER_DATABASES = ['someone-elses-database', 'campus-recall-notes'];

test('starting the app removes storage left under the old name, and only that', async ({
  page,
}) => {
  // A page of this origin that does not start the app.
  await page.goto('/icon.svg');
  await page.evaluate(
    async ({ cacheNames, databaseNames }) => {
      for (const name of cacheNames)
        await (await caches.open(name)).put('/old-model.bin', new Response('old bytes'));
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
    {
      cacheNames: [...OLD_CACHES, OTHER_CACHE],
      databaseNames: [...OLD_DATABASES, ...OTHER_DATABASES],
    },
  );

  await page.goto('/#/library');
  await expect(page.getByRole('heading', { name: 'Your library' })).toBeVisible();

  const stored = () =>
    page.evaluate(async () => ({
      caches: await caches.keys(),
      databases: (await indexedDB.databases()).map((entry) => entry.name ?? ''),
      removed: localStorage.getItem('anyrecall:old-storage-removed'),
    }));
  await expect.poll(async () => (await stored()).removed).toBe('1');
  const after = await stored();
  for (const name of OLD_CACHES) expect(after.caches).not.toContain(name);
  for (const name of OLD_DATABASES) expect(after.databases).not.toContain(name);
  expect(after.caches).toContain(OTHER_CACHE);
  for (const name of OTHER_DATABASES) expect(after.databases).toContain(name);
  // The library the app uses now is there.
  expect(after.databases).toContain('anyrecall');
});
