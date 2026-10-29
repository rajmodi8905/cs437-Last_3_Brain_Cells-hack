import { test, expect } from '@playwright/test';
async function enter(page: any) {
  await page.goto('/#/library');
  await page.getByRole('button', { name: 'Open my library' }).click();
}
test('save, reopen exact original, rename, backup and delete without models', async ({ page }) => {
  await enter(page);
  await page.getByRole('link', { name: 'Save something', exact: true }).click();
  await page.getByRole('tab', { name: 'Note', exact: true }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill('CS437 group instructions');
  await page
    .getByRole('textbox', { name: 'Note', exact: true })
    .fill('Synthetic demo: groups may contain three members. Keep a source reference.');
  await page.getByRole('button', { name: 'Save locally' }).click();
  await expect(page.getByRole('status')).toContainText('Saved locally');
  await page.reload();
  await page.getByRole('button', { name: /CS437 group instructions Notes/ }).click();
  await expect(page.locator('.original-text')).toContainText('three members');
  await page.getByRole('button', { name: 'Close original' }).click();
  await page.getByRole('button', { name: 'Actions for CS437 group instructions' }).click();
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Renamed instructions');
  await page.getByRole('button', { name: 'Save title' }).click();
  await expect(page.getByText('Renamed instructions', { exact: true })).toBeVisible();
  await page.locator('.settings-link').click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export library', exact: true }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toMatch(/\.zip$/);
  await page.goto('/#/library');
  await page.getByRole('button', { name: 'Actions for Renamed instructions' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Delete item', exact: true }).click();
  await expect(page.getByText('No saved items yet.')).toBeVisible();
});
test('responsive screens, policy direct routes, safe HTML fallback and offline shell', async ({
  page,
  context,
}) => {
  await enter(page);
  for (const width of [390, 768, 1440])
    for (const route of ['library', 'add', 'settings', 'privacy', 'terms']) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/#/${route}`);
      await expect(page.locator('h1')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: `test-results/ui-${route}-${width}.png`, fullPage: true });
    }
  const importedResources: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('example.test')) importedResources.push(request.url());
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/add');
  await page.getByRole('tab', { name: 'Webpage', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Public webpage URL' })
    .fill('https://example.test/campus');
  await page.getByLabel('Import an HTML text snapshot').setInputFiles({
    name: 'snapshot.html',
    mimeType: 'text/html',
    buffer: Buffer.from(
      '<title>Campus event</title><main><p>Debate at the library.</p><script>window.hacked=true</script><img src="https://example.test/leak"></main>',
    ),
  });
  await expect(page.getByRole('textbox', { name: 'Saved page text' })).toHaveValue(
    'Debate at the library.',
  );
  expect(await page.evaluate(() => (window as any).hacked)).toBeUndefined();
  expect(importedResources).toEqual([]);
  await page.getByRole('button', { name: 'Save locally' }).click();
  await expect(page.getByRole('status')).toContainText('Saved locally');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await context.setOffline(true);
  await page.goto('/#/library');
  await page.reload();
  await expect(page.getByText('Campus event', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Campus event Webpages/ }).click();
  await expect(page.locator('.original-text')).toContainText('Debate');
  await page.getByRole('button', { name: 'Close original' }).click();
  await page.goto('/#/privacy');
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Privacy');
});
test('a partially saved batch reports remaining files instead of losing its error', async ({
  page,
}) => {
  await enter(page);
  await page.goto('/#/add');
  await page.getByLabel('Choose files to save').setInputFiles([
    {
      name: 'one.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jJXQAAAAASUVORK5CYII=',
        'base64',
      ),
    },
    { name: 'unsupported.txt', mimeType: 'text/plain', buffer: Buffer.from('unsupported') },
  ]);
  await page.getByRole('button', { name: 'Save locally' }).click();
  await expect(page.getByRole('status')).toContainText('Saved locally');
  await expect(page.getByRole('alert')).toContainText('1 remaining file(s) were not saved');
  await expect(page.getByText('one', { exact: true })).toBeVisible();
  await page.goto('/#/add');
  await page.getByRole('tab', { name: 'Note', exact: true }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill('Later note');
  await page.getByRole('textbox', { name: 'Note', exact: true }).fill('Saved after the batch.');
  await page.getByRole('button', { name: 'Save locally' }).click();
  await expect(page.getByText('Later note', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
test('duplicate titles open exact originals and a missing source never substitutes another', async ({
  page,
}) => {
  await enter(page);
  for (const text of ['First distinct original', 'Second distinct original']) {
    await page.goto('/#/add');
    await page.getByRole('tab', { name: 'Note', exact: true }).click();
    await page.getByRole('textbox', { name: 'Title' }).fill('Same title');
    await page.getByRole('textbox', { name: 'Note', exact: true }).fill(text);
    await page.getByRole('button', { name: 'Save locally' }).click();
    await expect(page.getByRole('status')).toContainText('Saved locally');
  }
  const oldest = await page.evaluate(
    () =>
      new Promise<any>((resolve, reject) => {
        const request = indexedDB.open('campus-recall');
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('items');
          const all = tx.objectStore('items').getAll();
          all.onsuccess = () =>
            resolve(all.result.sort((a: any, b: any) => a.createdAt - b.createdAt)[0]);
          tx.oncomplete = () => db.close();
        };
        request.onerror = () => reject(request.error);
      }),
  );
  await page.locator(`article[data-item-id="${oldest.id}"] .item-open`).click();
  await expect(page.locator('.original-text')).toHaveText('First distinct original');
  await page.getByRole('button', { name: 'Close original' }).click();
  await page.evaluate(
    (item) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('campus-recall');
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('originals', 'readwrite');
          tx.objectStore('originals').delete(item.originalBlobId);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    oldest,
  );
  await page.locator(`article[data-item-id="${oldest.id}"] .item-open`).click();
  await expect(page.locator('.source-body')).toContainText('This original is unavailable');
  await expect(page.locator('.original-text')).toHaveCount(0);
});
test('direct webpage capture omits credentials, reports truncation and offers blocked-fetch fallback', async ({
  page,
  context,
}) => {
  await enter(page);
  await context.addCookies([
    { name: 'not-for-capture', value: 'private-cookie', url: 'http://127.0.0.1:4174' },
  ]);
  const imported: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('example.test')) imported.push(r.url());
  });
  await page.goto('/#/add');
  await page.getByRole('tab', { name: 'Webpage', exact: true }).click();
  const url = page.getByRole('textbox', { name: 'Public webpage URL' });
  await url.fill('http://127.0.0.1:4180/capture-success');
  await page.getByRole('button', { name: 'Capture', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Saved page text' })).toHaveValue(
    'Robot workshop registration opens on Thursday.',
  );
  expect(imported).toEqual([]);
  expect(await page.evaluate(() => (window as any).executedImport)).toBeUndefined();
  await url.fill('http://127.0.0.1:4180/capture-large');
  await page.getByRole('button', { name: 'Capture', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Only the first 20,000');
  expect(
    Array.from(await page.getByRole('textbox', { name: 'Saved page text' }).inputValue()),
  ).toHaveLength(20000);
  await url.fill('http://127.0.0.1:4180/capture-blocked');
  await page.getByRole('button', { name: 'Capture', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Paste its text');
});

test('[S6] exported originals restore into an independent browser profile and stay queued', async ({
  page,
  browser,
}) => {
  await enter(page);
  const title = 'Synthetic transfer note';
  const original = 'Distinct original for manual transfer. No models or embeddings are included.';
  await page.goto('/#/add');
  await page.getByRole('tab', { name: 'Note', exact: true }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill(title);
  await page.getByRole('textbox', { name: 'Note', exact: true }).fill(original);
  await page.getByRole('button', { name: 'Save locally' }).click();
  await expect(page.getByRole('status')).toContainText('Saved locally');
  await page.goto('/#/settings');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export library', exact: true }).click();
  const archive = await (await download).path();
  expect(archive).toBeTruthy();
  const second = await browser.newContext();
  try {
    const restored = await second.newPage();
    await enter(restored);
    await expect(restored.getByText('No saved items yet.')).toBeVisible();
    await restored.goto('/#/settings');
    await restored.getByLabel('Choose backup ZIP').setInputFiles(archive!);
    await expect(restored.getByRole('status')).toContainText('Restored 1 items');
    await restored.goto('/#/library');
    await expect(restored.locator('.item-row .status')).toHaveText('Queued');
    await restored.getByRole('button', { name: new RegExp(title + ' Notes') }).click();
    await expect(restored.locator('.original-text')).toHaveText(original);
    await restored.getByRole('button', { name: 'Close original' }).click();
    await restored.goto('/#/settings');
    await restored.getByLabel('Choose backup ZIP').setInputFiles(archive!);
    await expect(restored.getByRole('status')).toContainText(
      'Restored 0 items. Skipped 1 duplicates.',
    );
  } finally {
    await second.close();
  }
});
