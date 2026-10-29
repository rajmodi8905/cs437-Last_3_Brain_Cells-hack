import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let directory: string;
let kit: string;
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'recall-browser-kit-'));
  kit = join(directory, 'kit');
  execFileSync(process.execPath, ['scripts/prepare-qa-kit.mjs', '--output-dir', kit]);
});
test.afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('QA kit restores thirty exact originals through the production interface before setup', async ({
  page,
}) => {
  await page.goto('/#/library');
  await page.getByRole('button', { name: 'Open my library' }).click();
  await page.goto('/#/settings');
  await page.getByLabel('Choose backup ZIP').setInputFiles(join(kit, 'library-30.zip'));
  await expect(page.getByRole('status')).toContainText('Restored 30 items');
  await page.goto('/#/library');
  await expect(page.locator('.item-row')).toHaveCount(30);
  await expect(page.locator('.item-row .status').filter({ hasText: 'Queued' })).toHaveCount(30);
  const note = 'Meet the mentor at the north library entrance on Tuesday afternoon.';
  await page
    .getByRole('button', {
      name: new RegExp('^' + note.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' Notes'),
    })
    .click();
  await expect(page.locator('.original-text')).toHaveText(note);
  await page.getByRole('button', { name: 'Close original' }).click();
  await page.goto('/#/settings');
  await page.getByLabel('Choose backup ZIP').setInputFiles(join(kit, 'library-30.zip'));
  await expect(page.getByRole('status')).toContainText('Restored 0 items. Skipped 30 duplicates.');
  await page
    .getByLabel('Choose backup ZIP')
    .setInputFiles(join(kit, 'invalid/invalid-version.zip'));
  await expect(page.getByRole('alert')).toContainText('Archive');
  await page.goto('/#/library');
  await expect(page.locator('.item-row')).toHaveCount(30);
});
