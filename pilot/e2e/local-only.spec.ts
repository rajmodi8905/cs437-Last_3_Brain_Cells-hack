import { expect, test } from '@playwright/test';

test('P01 Local only saves, searches, opens and reloads with zero pilot API or identity requests', async ({
  page,
}) => {
  const external: string[] = [];
  page.on('request', (request) => {
    if (/\/api\/v1(?:\/|$)|accounts\.google\.com|oauth2\.googleapis\.com/.test(request.url()))
      external.push(request.url());
  });
  await page.goto('/#/library');
  await page.getByRole('button', { name: 'Open my library' }).click();
  await page.goto('/#/add');
  await page.getByRole('tab', { name: 'Note', exact: true }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill('Private local sentinel');
  await page
    .getByRole('textbox', { name: 'Note', exact: true })
    .fill('This private note stays in this browser.');
  await page.getByRole('button', { name: 'Save locally' }).click();
  await expect(page.getByRole('status')).toContainText('Saved locally');
  await page.reload();
  await page.getByRole('button', { name: /Private local sentinel Notes/ }).click();
  await expect(page.locator('.original-text')).toContainText('private note');
  await page.getByRole('button', { name: 'Close original' }).click();
  await page.getByRole('textbox', { name: 'Search saved information' }).fill('private note');
  await page.getByRole('textbox', { name: 'Search saved information' }).press('Enter');
  await page.goto('/#/settings');
  await expect(page.getByRole('button', { name: 'Set up Auto-sync' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Set up Auto-sync' })).toBeVisible();
  expect(external).toEqual([]);
});
