import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
// First five minutes on the production build: a search before offline setup asks for the
// one-time download in place. Every model asset request is blocked, so nothing large downloads.
test.use({ serviceWorkers: 'block' });

async function enter(page: Page) {
  const assetRequests: string[] = [];
  await page.route('**/*', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.hostname !== '127.0.0.1' || request.headers()['x-anyrecall-setup'] === '1') {
      assetRequests.push(url.href);
      return route.abort();
    }
    return route.continue();
  });
  await page.goto('/#/library');
  await page.getByRole('button', { name: 'Open my library' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  return assetRequests;
}

async function searchBeforeSetup(page: Page, text: string) {
  const search = page.getByRole('textbox', { name: 'Search saved information' });
  await search.fill(text);
  await search.press('Enter');
  return page.getByRole('region', { name: 'Search needs a one-time download' });
}

test('a search before setup shows the download card with the real size and no error', async ({
  page,
}) => {
  const assetRequests = await enter(page);
  const card = await searchBeforeSetup(page, 'lab access card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('445 MB');
  await expect(card).toContainText('Wi-Fi');
  await expect(card).toContainText('lab access card');
  await expect(card.getByRole('button', { name: 'Download search (445 MB)' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText(/Set up offline search in Settings first/)).toHaveCount(0);
  await expect(page.getByText('Processing and search run on this device.')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Download offline search' })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Filter by file type' })).toBeVisible();
  // Spec S7: nothing downloads until the student presses the button.
  expect(assetRequests).toEqual([]);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(results.violations.map((v) => v.id)).toEqual([]);
  }
});

test('a stopped download stays in the card with a plain message and a retry', async ({ page }) => {
  const assetRequests = await enter(page);
  const card = await searchBeforeSetup(page, 'exam timetable');
  await card.getByRole('button', { name: 'Download search (445 MB)' }).click();
  await expect(card).toContainText(/download stopped/i);
  await expect(card.getByRole('button', { name: /^(Try again|Resume download)/ })).toBeVisible();
  await expect(card).not.toContainText('ONNX');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(assetRequests.length).toBeGreaterThan(0);
  await page.goto('/#/settings');
  await expect(page.getByText('Setup needed', { exact: true })).toBeVisible();
});

test('the Library setup banner leads to the Search download card', async ({ page }) => {
  await enter(page);
  await expect(page.getByRole('link', { name: 'Save something', exact: true })).toBeVisible();
  await page.getByRole('link', { name: /Set up offline search/ }).click();
  await expect(page).toHaveURL(/#\/search$/);
  await expect(
    page.getByRole('region', { name: 'Search needs a one-time download' }),
  ).toBeVisible();
});
