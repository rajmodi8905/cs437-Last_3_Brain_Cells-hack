import { readFile } from 'node:fs/promises';
import { expect, test, type Browser, type Page } from '@playwright/test';

const title =
  'Research methods: assessment instructions and submission checklist for the autumn semester';
const original = 'Synthetic phone layout check. Meet the mentor at the north library entrance.';

async function openApp(browser: Browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto('/#/library');
  await page.getByRole('button', { name: 'Open my library' }).click();
  return page;
}
async function include(page: Page, email: string) {
  await page.goto('/#/settings');
  const sync = page.getByRole('region', { name: 'Auto-sync' });
  await sync.getByRole('button', { name: 'Set up Auto-sync' }).click();
  await sync.getByLabel('IITGN email').fill(email);
  await sync.getByRole('button', { name: 'Sign in (development)' }).click();
  await sync.getByRole('button', { name: "Include this device's library" }).click();
  await expect(sync).toContainText('Auto-sync is on');
  return sync;
}

test('cloud titles and touch actions fit phones, landscape, tablet and desktop', async ({
  browser,
}) => {
  const email = `mobile.layout.${Date.now()}@iitgn.ac.in`;
  const sender = await openApp(browser);
  const receiver = await openApp(browser);
  try {
    await sender.goto('/#/add');
    await sender.getByRole('tab', { name: 'Note', exact: true }).click();
    await sender.getByRole('textbox', { name: /^Title/ }).fill(title);
    await sender.getByRole('textbox', { name: 'Note', exact: true }).fill(original);
    await sender.getByRole('button', { name: 'Save locally' }).click();
    await expect(sender.getByRole('status')).toContainText('Saved locally');
    await expect(await include(sender, email)).toContainText('1 item synced');
    const sync = await include(receiver, email);
    const row = sync.getByRole('list', { name: 'In your cloud library' }).getByRole('listitem');
    await expect(row).toHaveCount(1);
    for (const viewport of [
      { width: 320, height: 740 },
      { width: 390, height: 844 },
      { width: 640, height: 900 },
      { width: 844, height: 390 },
      { width: 768, height: 1024 },
      { width: 1440, height: 900 },
    ]) {
      await receiver.setViewportSize(viewport);
      const geometry = await row.evaluate((element) => {
        const title = element.querySelector('.cloud-item-title')!.getBoundingClientRect();
        return {
          titleWidth: title.width,
          titleBottom: title.bottom,
          overflow: document.documentElement.scrollWidth - innerWidth,
          actions: Array.from(element.querySelectorAll('button')).map((button) => {
            const rect = button.getBoundingClientRect();
            return {
              x: rect.x,
              right: rect.right,
              top: rect.top,
              width: rect.width,
              height: rect.height,
            };
          }),
        };
      });
      expect(geometry.overflow, `${viewport.width}px document overflow`).toBeLessThanOrEqual(1);
      expect(geometry.titleWidth, `${viewport.width}px title width`).toBeGreaterThan(180);
      for (const action of geometry.actions) {
        expect(action.width).toBeGreaterThanOrEqual(44);
        expect(action.height).toBeGreaterThanOrEqual(44);
        expect(action.x).toBeGreaterThanOrEqual(0);
        expect(action.right).toBeLessThanOrEqual(viewport.width);
        expect(action.top).toBeGreaterThan(geometry.titleBottom);
      }
    }
    await receiver.setViewportSize({ width: 390, height: 844 });
    await row.getByRole('button', { name: `Open ${title}`, exact: true }).click();
    await expect(receiver.locator('.original-text')).toHaveText(original);
    await receiver.getByRole('button', { name: 'Close original' }).click();
    const [download] = await Promise.all([
      receiver.waitForEvent('download'),
      row.getByRole('button', { name: `Download ${title}`, exact: true }).click(),
    ]);
    expect(await readFile((await download.path())!, 'utf8')).toBe(original);
    await row.getByRole('button', { name: `Keep offline ${title}`, exact: true }).click();
    await expect(row).toContainText('Kept offline');
    const choice = sync.getByLabel(/When signing out, also remove/);
    await choice.check();
    await expect(choice).toBeChecked();
    expect((await choice.boundingBox())!.width).toBe(20);
    await choice.uncheck();
  } finally {
    await sender.context().close();
    await receiver.context().close();
  }
});

test('phone navigation starts the next screen at the top after long settings', async ({
  browser,
}) => {
  const page = await openApp(browser);
  try {
    const navigation = page.getByRole('navigation', { name: 'Mobile navigation' });
    await navigation.getByRole('link', { name: 'Settings', exact: true }).click();
    await page
      .getByRole('link', { name: 'Terms and Conditions', exact: true })
      .scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0);
    for (const screen of ['Add', 'Search', 'Library']) {
      await navigation.getByRole('link', { name: screen, exact: true }).click();
      await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
      await expect(page.locator('.mobile-brand')).toBeInViewport();
    }
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(navigation).toBeVisible();
    await expect(page.locator('.sidebar')).toBeHidden();
  } finally {
    await page.context().close();
  }
});
