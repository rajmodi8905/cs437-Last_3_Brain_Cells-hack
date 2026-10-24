import { test, expect } from '@playwright/test';
test('first-use policy access, keyboard dialogs, long titles and reduced motion', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/#/privacy');
  await expect(page.getByRole('heading', { name: 'Privacy Policy', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto('/');
  await page.reload();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await page.getByRole('button', { name: 'Open my library' }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Privacy Policy', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Open my library' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.keyboard.press('Meta+k');
  await expect(page.getByRole('textbox', { name: 'Search saved information' })).toBeFocused();
  await page.goto('/#/add');
  await page.getByRole('tab', { name: 'Note', exact: true }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill('A'.repeat(120));
  await page
    .getByRole('textbox', { name: 'Note', exact: true })
    .fill('Unique original sentinel for the long title.');
  await page.getByRole('button', { name: 'Save locally' }).click();
  await expect(page.getByRole('status')).toContainText('Saved locally');
  await page.getByRole('button', { name: `Actions for ${'A'.repeat(120)}` }).click();
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: /A{120} Notes/ }).click();
  await expect(page.locator('.original-text')).toContainText('Unique original sentinel');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
