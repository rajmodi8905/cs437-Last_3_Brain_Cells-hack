import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let directory: string;
let kit: string;
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'recall-chaitanya-kit-'));
  kit = join(directory, 'kit');
  execFileSync(process.execPath, ['scripts/prepare-qa-kit.mjs', '--output-dir', kit]);
});
test.afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('Chaitanya fixtures exercise capture, truncation, blocked fallback and inert HTML through the real UI', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/#/library');
  await page.getByRole('button', { name: 'Open my library' }).click();
  await page.goto('/#/add');
  await page.getByRole('tab', { name: 'Webpage', exact: true }).click();
  const url = page.getByRole('textbox', { name: 'Public webpage URL' });
  const text = page.getByRole('textbox', { name: 'Saved page text' });
  await url.fill('http://127.0.0.1:4181/allowed');
  await page.getByRole('button', { name: 'Capture', exact: true }).click();
  await expect(text).toHaveValue('Robotics induction is on Saturday at the north workshop.');
  await url.fill('http://127.0.0.1:4181/large');
  await page.getByRole('button', { name: 'Capture', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Only the first 20,000');
  expect(Array.from(await text.inputValue())).toHaveLength(20_000);
  await url.fill('http://127.0.0.1:4181/blocked');
  await page.getByRole('button', { name: 'Capture', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Paste its text');
  const fallback = await readFile(join(kit, 'ui/fallback-text.txt'), 'utf8');
  await text.fill(fallback);
  await page.getByRole('textbox', { name: 'Title' }).fill('Fallback snapshot');
  await page.getByRole('button', { name: 'Save locally' }).click();
  await expect(page.getByRole('status')).toContainText('Saved locally');
  await page.getByRole('button', { name: /Fallback snapshot Webpages/ }).click();
  await expect(page.locator('.original-text')).toHaveText(fallback);
  await page.getByRole('button', { name: 'Close original' }).click();
  await page.goto('/#/add');
  await page.getByRole('tab', { name: 'Webpage', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Public webpage URL' })
    .fill('https://example.test/snapshot');
  await page
    .getByLabel('Import an HTML or PDF snapshot')
    .setInputFiles(join(kit, 'ui/snapshot.html'));
  await expect(page.getByRole('textbox', { name: 'Saved page text' })).toHaveValue(
    'Robotics induction is on Saturday at the north workshop.',
  );
  expect(await page.evaluate(() => (window as any).qaImportedScript)).toBeUndefined();
  expect((await (await request.get('http://127.0.0.1:4181/probe-count')).json()).requests).toBe(0);
  expect(errors).toEqual([]);
});

test('UI stress library remains readable on a phone viewport and policy routes reopen offline', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/library');
  await page.getByRole('button', { name: 'Open my library' }).click();
  await page.goto('/#/settings');
  await page.getByLabel('Choose backup ZIP').setInputFiles(join(kit, 'ui-stress.zip'));
  await expect(page.getByRole('status')).toContainText('Restored 3 items');
  await page.goto('/#/library');
  await expect(page.locator('.item-row')).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: /A{120} Notes/ }).click();
  await expect(page.locator('.original-text')).toContainText('maximum-length title');
  await page.getByRole('button', { name: 'Close original' }).click();
  await page.getByRole('button', { name: /Long note boundary Notes/ }).click();
  await expect
    .poll(async () => Array.from((await page.locator('.original-text').textContent()) || '').length)
    .toBe(20_000);
  await page.getByRole('button', { name: 'Close original' }).click();
  await page.getByRole('button', { name: /Unicode and source content Notes/ }).click();
  await expect(page.locator('.original-text')).toContainText(
    'café, नमस्ते, 漢字, and a quoted em dash — retained exactly.',
  );
  await page.getByRole('button', { name: 'Close original' }).click();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await context.setOffline(true);
  for (const [route, heading] of [
    ['privacy', 'Privacy Policy'],
    ['terms', 'Terms and Conditions'],
  ]) {
    await page.goto(`/#/${route}`);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
  }
});
