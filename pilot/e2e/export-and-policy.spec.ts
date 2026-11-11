import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from '@playwright/test';

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

test('pilot policies explain opt-in, operator access and export before inclusion', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const [route, heading] of [
    ['privacy', 'Privacy Policy'],
    ['terms', 'Terms and Conditions'],
  ]) {
    await page.goto(`/#/${route}`);
    await expect(page).toHaveTitle(/AnyRecall/);
    await expect(page.getByRole('heading', { level: 1, name: heading, exact: true })).toBeVisible();
    await expect(page.locator('article.policy')).toContainText('Auto-sync');
    await expect(page.locator('article.policy')).toContainText(/not end-to-end encrypt/);
    await expect(page.locator('article.policy')).toContainText(
      '6 December 2026 at 17:47 IST (12:17 UTC)',
    );
  }
  await page.goto('/#/library');
  await page.getByRole('button', { name: 'Open my library' }).click();
  await page.goto('/#/settings');
  const sync = page.getByRole('region', { name: 'Auto-sync' });
  await sync.getByRole('button', { name: 'Set up Auto-sync' }).click();
  await sync.getByLabel('IITGN email').fill(`policy.${Date.now()}@iitgn.ac.in`);
  await sync.getByRole('button', { name: 'Sign in (development)' }).click();
  await expect(sync).toContainText('Authorized project operators can access cloud content');
  await expect(sync.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute(
    'href',
    '#/privacy',
  );
  await expect(sync.getByRole('link', { name: 'Terms and Conditions' })).toHaveAttribute(
    'href',
    '#/terms',
  );
  const dir = process.env.PILOT_QA_DIR;
  if (dir) {
    await mkdir(dir, { recursive: true });
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(
        page.getByRole('button', { name: "Include this device's library" }),
      ).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: `${dir}/pilot-opt-in-${width}.png`, fullPage: true });
    }
  }
  expect(errors).toEqual([]);
});

test('Export cloud library downloads verified originals including a locally mapped item', async ({
  page,
}) => {
  const bytes = Buffer.from(
    '%PDF-1.4\n' + 'Whole cloud library export sentinel. '.repeat(100) + '\n%%EOF',
  );
  await page.goto('/#/library');
  await page.getByRole('button', { name: 'Open my library' }).click();
  await page.goto('/#/add');
  await page
    .getByLabel('Choose files to save')
    .setInputFiles({ name: 'export.pdf', mimeType: 'application/pdf', buffer: bytes });
  await page.getByLabel(/^Title/).fill('Cloud export original');
  await page.getByRole('button', { name: 'Save locally' }).click();
  await expect(page.getByRole('status')).toContainText('Saved locally');
  await page.goto('/#/settings');
  const sync = page.getByRole('region', { name: 'Auto-sync' });
  await sync.getByRole('button', { name: 'Set up Auto-sync' }).click();
  await sync.getByLabel('IITGN email').fill(`export.${Date.now()}@iitgn.ac.in`);
  await sync.getByRole('button', { name: 'Sign in (development)' }).click();
  await sync.getByRole('button', { name: "Include this device's library" }).click();
  await expect(sync).toContainText('1 item synced');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    sync.getByRole('button', { name: 'Export cloud library' }).click(),
  ]);
  const files = unzipSync(await readFile((await download.path())!));
  const manifest = JSON.parse(strFromU8(files['manifest.json']));
  expect(manifest.items).toHaveLength(1);
  expect(manifest.items[0].title).toBe('Cloud export original');
  expect(sha(files[manifest.items[0].originalPath])).toBe(sha(bytes));
  expect(manifest.items[0].contentSha256).toBe(sha(bytes));
  expect(Object.keys(files)).toHaveLength(2);
  await expect(sync).toContainText('1 export ZIP ready');
});
