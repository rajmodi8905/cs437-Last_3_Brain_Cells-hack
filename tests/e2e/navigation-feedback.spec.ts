import { test, expect, type Page } from '@playwright/test';
// Production build: screen changes move focus to the new heading and name the screen in the
// title, stale errors clear on the next screen, raw errors become plain sentences with the raw
// text behind "Show details", and quiet actions confirm what happened.
async function enter(page: Page) {
  await page.goto('/#/library');
  await page.getByRole('button', { name: 'Open my library' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function saveNote(page: Page, title: string) {
  await page.goto('/#/add');
  await page.getByRole('tab', { name: 'Note', exact: true }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill(title);
  await page.getByRole('textbox', { name: 'Note', exact: true }).fill('Dinner is at 7:30 pm.');
  await page.getByRole('button', { name: 'Save locally' }).click();
  await expect(page.locator('.toast')).toContainText('Saved locally');
}
const heading = (page: Page) => page.getByRole('heading', { level: 1 });

test('each screen change focuses the new heading and names the screen in the title', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Campus Recall');
  await enter(page);
  await expect(page).toHaveTitle('Library · Campus Recall');
  await page.reload();
  // A full load leaves focus where the browser puts it.
  await expect(heading(page)).not.toBeFocused();
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  for (const [link, title, name] of [
    ['Search', 'Search', 'Find your saved information'],
    ['Add to library', 'Add to library', 'Add to your library'],
    ['Library', 'Library', 'Your library'],
  ]) {
    await nav.getByRole('link', { name: new RegExp(`^${link}`) }).click();
    await expect(heading(page)).toHaveText(name);
    await expect(heading(page)).toBeFocused();
    await expect(page).toHaveTitle(`${title} · Campus Recall`);
  }
  await page.locator('.settings-link').click();
  await expect(heading(page)).toBeFocused();
  await expect(page).toHaveTitle('Settings · Campus Recall');
  await page.getByRole('link', { name: 'Privacy Policy', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeFocused();
  await expect(page).toHaveTitle('Privacy Policy · Campus Recall');
  await page.goto('/#/terms');
  await expect(page.getByRole('heading', { level: 1, name: 'Terms and Conditions' })).toBeFocused();
  await expect(page).toHaveTitle('Terms and Conditions · Campus Recall');
  await page.goto('/#/nowhere');
  await expect(heading(page)).toBeFocused();
  await expect(page).toHaveTitle('Page not found · Campus Recall');
  // The skip link still moves focus to the main content.
  await page.goto('/#/library');
  await page.reload();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
});

test('submitting a search keeps focus in the search box', async ({ page }) => {
  await enter(page);
  const search = page.getByRole('textbox', { name: 'Search saved information' });
  await search.fill('mess timings');
  await search.press('Enter');
  await expect(page).toHaveURL(/#\/search$/);
  await expect(page).toHaveTitle('Search · Campus Recall');
  await expect(search).toBeFocused();
});

test('an error clears on the next screen and a raw error reads as a plain sentence', async ({
  page,
}) => {
  await enter(page);
  await page.goto('/#/settings');
  await page.getByLabel('Choose backup ZIP').setInputFiles({
    name: 'not-a-backup.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from('not a zip'),
  });
  await expect(page.getByRole('alert')).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', {
      name: /^Library/,
    })
    .click();
  await expect(heading(page)).toHaveText('Your library');
  await expect(page.getByRole('alert')).toHaveCount(0);

  await saveNote(page, 'Mess timings');
  await page.getByRole('button', { name: 'Actions for Mess timings' }).click();
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('   ');
  await page.getByRole('button', { name: 'Save title' }).click();
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('120 characters');
  await expect(alert.getByText('Title must be between')).toBeHidden();
  // The dialog stays open with the typed title; closing it returns to the page and its error.
  await page.getByRole('button', { name: 'Cancel' }).click();
  await alert.getByText('Show details').click();
  await expect(alert.getByText('Title must be between')).toBeVisible();
});

test('downloads, item backups and cancelled processing confirm what happened', async ({ page }) => {
  await enter(page);
  await saveNote(page, 'Mess timings');
  await page.getByRole('button', { name: 'Dismiss notification' }).click();
  await page.getByRole('button', { name: /^Mess timings Notes/ }).click();
  const viewer = page.getByRole('region', { name: 'Mess timings' });
  await Promise.all([
    page.waitForEvent('download'),
    viewer.getByRole('button', { name: 'Download original' }).click(),
  ]);
  await expect(page.locator('.toast')).toContainText(/download/i);
  await Promise.all([
    page.waitForEvent('download'),
    viewer.getByRole('button', { name: 'Export this item as backup' }).click(),
  ]);
  await expect(page.locator('.toast')).toContainText(/backup/i);
  await viewer.getByRole('button', { name: 'Close original' }).click();
  // Before offline setup the note waits in the queue, so its processing can be cancelled.
  await page.getByRole('button', { name: 'Actions for Mess timings' }).click();
  await page.getByRole('button', { name: 'Cancel processing' }).click();
  await expect(page.locator('.toast')).toContainText(/cancelled/i);
});
