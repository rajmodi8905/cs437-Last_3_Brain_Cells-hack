import { test, expect, type Page } from '@playwright/test';
// Regression coverage for issues #10 and #12-#17. #11 is covered in tests/engine/assets.test.ts.
async function enter(page: Page) {
  await page.goto('/#/library');
  await page.getByRole('button', { name: 'Open my library' }).click();
}
async function saveNote(page: Page, title: string) {
  await page.goto('/#/add');
  await page.getByRole('tab', { name: 'Note', exact: true }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill(title);
  await page.getByRole('textbox', { name: 'Note', exact: true }).fill('Synthetic focus fixture.');
  await page.getByRole('button', { name: 'Save locally' }).click();
  await expect(page.getByRole('status')).toContainText('Saved locally');
  await page.getByRole('button', { name: 'Dismiss notification' }).click();
}
const focused = (page: Page) =>
  page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    return {
      label: element?.getAttribute('aria-label') ?? element?.textContent?.trim() ?? '',
      behind: !!element?.closest('.skip-link,.sidebar,.workspace,.mobile-nav'),
      body: element === document.body,
    };
  });

test('#10 a saved PDF opens in the viewer before offline setup, online and offline', async ({
  page,
  context,
}) => {
  await enter(page);
  await page.goto('/#/add');
  await page.getByLabel('Choose files to save').setInputFiles('tests/fixtures/sample-03.pdf');
  await page.getByRole('button', { name: 'Save locally' }).click();
  await expect(page.getByRole('status')).toContainText('Saved locally');
  for (const offline of [false, true]) {
    if (offline) {
      await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
      await page.reload();
      await context.setOffline(true);
      await page.reload();
    }
    await page.getByRole('button', { name: /sample-03 PDFs/ }).click();
    await expect(page.locator('.pdf-navigation')).toContainText('of 3');
    await expect
      .poll(() => page.locator('.pdf-canvas').evaluate((c: HTMLCanvasElement) => c.width))
      .toBeGreaterThan(0);
    await expect(page.locator('.viewer [role=alert]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Close original' }).click();
  }
  await context.setOffline(false);
});

test('#12 the full-screen phone viewer holds focus and returns it on close', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await enter(page);
  await saveNote(page, 'Focus fixture');
  const row = page.getByRole('button', { name: /Focus fixture Notes/ });
  await row.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Close original' })).toBeFocused();
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    expect((await focused(page)).behind).toBe(false);
  }
  await page.getByRole('button', { name: 'Close original' }).click();
  await expect(row).toBeFocused();
  await row.press('Enter');
  await page.keyboard.press('Escape');
  await expect(row).toBeFocused();
  expect(await page.locator('.workspace').evaluate((el: HTMLElement) => el.inert)).toBe(false);
});

test('#12 closing the desktop viewer returns focus to its row', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await enter(page);
  await saveNote(page, 'Desktop focus fixture');
  const row = page.getByRole('button', { name: /Desktop focus fixture Notes/ });
  await row.click();
  await page.getByRole('button', { name: 'Close original' }).click();
  await expect(row).toBeFocused();
});

test('#13 closing Rename or Delete returns focus to the item Actions button', async ({ page }) => {
  await enter(page);
  await saveNote(page, 'Dialog fixture');
  const actions = page.getByRole('button', { name: 'Actions for Dialog fixture' });
  const open = async (name: string) => {
    await actions.click();
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
  };
  await open('Rename');
  await page.keyboard.press('Escape');
  await expect(actions).toBeFocused();
  await open('Rename');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(actions).toBeFocused();
  await open('Delete');
  await page.keyboard.press('Escape');
  await expect(actions).toBeFocused();
  await open('Delete');
  await page.getByRole('button', { name: 'Keep item' }).click();
  await expect(actions).toBeFocused();
  await open('Rename');
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Renamed dialog fixture');
  await page.getByRole('button', { name: 'Save title' }).click();
  await expect(
    page.getByRole('button', { name: 'Actions for Renamed dialog fixture' }),
  ).toBeFocused();
});

test('#14 a PDF snapshot fills the webpage text and keeps its URL', async ({ page }) => {
  await enter(page);
  await page.goto('/#/add');
  await page.getByRole('tab', { name: 'Webpage', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Public webpage URL' })
    .fill('https://example.test/guidelines');
  await page
    .getByLabel('Import an HTML or PDF snapshot')
    .setInputFiles('tests/fixtures/sample-03.pdf');
  const text = page.getByRole('textbox', { name: 'Saved page text' });
  await expect(text).toHaveValue(/A project group may contain at most three students\./);
  const saved = await text.inputValue();
  await page.getByRole('textbox', { name: 'Title' }).fill('PDF snapshot fixture');
  await page.getByRole('button', { name: 'Save locally' }).click();
  await expect(page.getByRole('status')).toContainText('Saved locally');
  await page.getByRole('button', { name: /PDF snapshot fixture Webpages/ }).click();
  await expect(page.locator('.original-text')).toHaveText(saved);
  await expect(page.getByRole('link', { name: 'Open website' })).toHaveAttribute(
    'href',
    'https://example.test/guidelines',
  );
});

test('#15 Settings stays reachable from the sidebar in phone landscape', async ({ page }) => {
  await enter(page);
  for (const [width, height] of [
    [667, 375],
    [740, 360],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto('/#/library');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const settings = page.locator('.settings-link');
    const box = await settings.boundingBox();
    expect(box && box.y + box.height).toBeLessThanOrEqual(height);
    await settings.click();
    await expect(page).toHaveURL(/#\/settings$/);
  }
});

test('#16 current page and active filter are exposed to assistive technology', async ({ page }) => {
  await enter(page);
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav.getByRole('link', { name: /Library/ })).toHaveAttribute('aria-current', 'page');
  const filters = page.getByRole('group', { name: 'Filter by file type' });
  await expect(filters.getByRole('button', { name: /All files/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await filters.getByRole('button', { name: /Images/ }).click();
  await expect(filters.getByRole('button', { name: /Images/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(filters.getByRole('button', { name: /All files/ })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await page.goto('/#/settings');
  await expect(page.locator('.settings-link')).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('link', { name: /Library/ })).not.toHaveAttribute('aria-current');
});

test('#17 Settings separates the asset size and inference sentences', async ({ page }) => {
  await enter(page);
  await page.goto('/#/settings');
  await expect(page.getByText(/MB of assets\. Model inference uses this device/)).toBeVisible();
});
