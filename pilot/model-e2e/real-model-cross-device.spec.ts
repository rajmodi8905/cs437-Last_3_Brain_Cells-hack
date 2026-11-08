/// <reference types="node" />
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const query = 'How many classmates can work together for CS437?';
const title = 'Synced synthetic document';
const expectedPdfHash = '5b124fb2928e9db137ff87b77d6351100f828b9853059733f39e61bab3480374';

async function prepare(context: BrowserContext, page: Page) {
  const manifest = JSON.parse(await readFile('public/asset-manifest.json', 'utf8')) as {
    assets: { url: string; sha256: string }[];
  };
  const external: string[] = [];
  let setup = true;
  await context.route(/^https?:\/\//, async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1') return route.continue();
    const asset = manifest.assets.find((entry) => entry.url === url.href);
    if (!setup || !asset) {
      external.push(`${route.request().method()} ${url.href}`);
      return route.abort();
    }
    return route.fulfill({
      status: 302,
      headers: {
        location: `http://127.0.0.1:4180/${asset.sha256}`,
        'access-control-allow-origin': '*',
      },
    });
  });
  await page.goto('/#/library');
  await page.getByRole('button', { name: 'Open my library' }).click();
  await page.goto('/#/settings');
  await page.getByRole('button', { name: 'Download offline search', exact: true }).click();
  await expect(page.getByText('Assets verified', { exact: true })).toBeVisible({
    timeout: 180_000,
  });
  setup = false;
  return { external };
}

async function include(page: Page, email: string) {
  await page.goto('/#/settings');
  const region = page.getByRole('region', { name: 'Auto-sync' });
  await region.getByRole('button', { name: 'Set up Auto-sync' }).click();
  await region.getByLabel('IITGN email').fill(email);
  await region.getByRole('button', { name: 'Sign in (development)' }).click();
  await expect(region).toContainText(`Signed in as ${email}`);
  await region.getByRole('button', { name: "Include this device's library" }).click();
  await expect(region).toContainText('Auto-sync is on');
  return region;
}

test('P05/P06: a second browser searches a synced real PDF index locally without its original', async ({
  browser,
}, testInfo) => {
  const bytes = await readFile('tests/fixtures/sample-03.pdf');
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(expectedPdfHash);
  const email = `real-model.${Date.now()}@iitgn.ac.in`;
  const phone = await browser.newContext();
  const page = await phone.newPage();
  const sourceNetwork = await prepare(phone, page);
  await page.goto('/#/add');
  await page.getByLabel('Choose files to save').setInputFiles({
    name: 'synthetic.pdf',
    mimeType: 'application/pdf',
    buffer: bytes,
  });
  await page.getByLabel(/^Title/).fill(title);
  await page.getByRole('button', { name: 'Save locally' }).click();
  await expect(page.locator('[data-item-id]').filter({ hasText: title })).toContainText('Ready', {
    timeout: 180_000,
  });
  const sourceSync = await include(page, email);
  await expect(sourceSync).toContainText('1 item synced');
  // Original upload completes before index publication. A sync pass after Ready must publish it.
  await sourceSync.getByRole('button', { name: 'Sync now', exact: true }).click();
  await expect(sourceSync.getByRole('button', { name: 'Sync now', exact: true })).toBeEnabled();
  expect(sourceNetwork.external).toEqual([]);
  await phone.close();

  const laptop = await browser.newContext();
  const second = await laptop.newPage();
  const targetNetwork = await prepare(laptop, second);
  const requests: { url: string; method: string; body: string }[] = [];
  second.on('request', (request) =>
    requests.push({
      url: request.url(),
      method: request.method(),
      body: request.postData() ?? '',
    }),
  );
  const targetSync = await include(second, email);
  await expect(targetSync.getByRole('list', { name: 'In your cloud library' })).toContainText(
    title,
  );
  await targetSync.getByRole('button', { name: 'Sync now', exact: true }).click();
  await expect(targetSync.getByRole('button', { name: 'Sync now', exact: true })).toBeEnabled();
  expect(requests.some((request) => /\/items\/[^/]+\/index$/.test(request.url))).toBe(true);
  expect(requests.filter((request) => request.url.includes('/original'))).toEqual([]);
  await targetSync.getByRole('button', { name: 'Pause sync on this device' }).click();
  await expect(targetSync).toContainText('Paused');
  await second.goto('/#/library');
  // The receiver has a catalogue and embeddings, but no local original or local-item record.
  await expect(second.locator('[data-item-id]')).toHaveCount(0);
  await laptop.setOffline(true);
  const requestCountBeforeQuery = requests.length;
  const input = second.getByRole('textbox', { name: 'Search saved information' });
  await input.fill(query);
  await input.press('Enter');
  const result = second.locator('[data-cloud-item-id]').filter({ hasText: title });
  await expect(result).toContainText('Page 2', { timeout: 180_000 });
  await expect(result.getByRole('button', { name: `Open ${title} at Page 2` })).toBeVisible();
  await expect(second.locator('[data-item-id]')).toHaveCount(0);
  expect(
    requests.slice(requestCountBeforeQuery).filter((request) => request.url.includes('/api/v1/')),
  ).toEqual([]);
  expect(
    requests.some(
      (request) => decodeURIComponent(request.url).includes(query) || request.body.includes(query),
    ),
  ).toBe(false);
  expect(targetNetwork.external).toEqual([]);
  const stored = await second.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open('campus-recall');
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });
    try {
      const counts: Record<string, number> = {};
      for (const name of ['items', 'originals'])
        counts[name] = await new Promise<number>((resolve, reject) => {
          const request = db.transaction(name).objectStore(name).count();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      return counts;
    } finally {
      db.close();
    }
  });
  expect(stored).toEqual({ items: 0, originals: 0 });
  await second.screenshot({
    path: testInfo.outputPath('offline-cloud-search.png'),
    fullPage: true,
  });
  const report = {
    source: 'actual PDF extraction and pinned local embedding model',
    querySource: 'fresh browser context using its own pinned local query model',
    sourcePdfSha256: expectedPdfHash,
    query,
    result: await result.innerText(),
    page: 2,
    cloudId: await result.getAttribute('data-cloud-item-id'),
    localStoredRecords: stored,
    originalDownloadRequests: requests.filter((request) => request.url.includes('/original'))
      .length,
    apiRequestsDuringOfflineQuery: requests
      .slice(requestCountBeforeQuery)
      .filter((request) => request.url.includes('/api/v1/')).length,
    indexDownloadRequests: requests.filter((request) => /\/items\/[^/]+\/index$/.test(request.url))
      .length,
    unexpectedExternalRequests: targetNetwork.external,
  };
  await testInfo.attach('actual-model-cross-device-report', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });
  console.log('REAL MODEL CROSS DEVICE', JSON.stringify(report));
  await laptop.close();
});
