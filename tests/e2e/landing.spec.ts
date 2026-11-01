import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test('landing page opens at the root, jumps within the page and enters the library', async ({
  page,
}) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Save it here. Find it again.' }),
  ).toBeVisible();
  await expect(page.getByText('Sample data, not a real library')).toBeVisible();
  await page.getByRole('link', { name: 'How it works', exact: true }).first().click();
  await expect(page).not.toHaveURL(/#\/library/);
  await expect(page.locator('#lp-how')).toBeInViewport();
  await expect(page.getByRole('heading', { level: 1, name: /Save it here/ })).toBeAttached();
  await expect(page.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute(
    'href',
    '#/privacy',
  );
  await page.getByRole('link', { name: 'Open library' }).click();
  await expect(page).toHaveURL(/#\/library$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Your library' })).toBeVisible();
  await page.getByRole('button', { name: 'Open my library' }).click();
  await page.getByRole('link', { name: 'About Campus Recall' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /Save it here/ })).toBeVisible();
});
test('landing page has no horizontal overflow or automated WCAG A/AA violations', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const findings: unknown[] = [];
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow, `horizontal overflow at ${width}px`).toBe(false);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    findings.push(...results.violations.map((v) => ({ width, id: v.id, nodes: v.nodes.length })));
  }
  expect(findings).toEqual([]);
});

for (const [route, title] of [
  ['privacy', 'Privacy Policy'],
  ['terms', 'Terms and Conditions'],
]) {
  test(`a first visit from the landing page opens ${route} without onboarding`, async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await expect(page.locator('.lp-title')).toHaveText('Hostel mess rules');
    await page.getByRole('link', { name: title, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#/${route}$`));
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('link', { name: 'Library 0', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });
}

test('landing entry contains welcome focus and remembers dismissal on return', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await expect(page.locator('.lp-title')).toHaveText('Hostel mess rules');
  await page.getByRole('link', { name: 'Open library', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(page.locator('.workspace')).toHaveJSProperty('inert', true);
  const enter = dialog.getByRole('button', { name: 'Open my library' });
  await enter.focus();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('link', { name: 'Privacy Policy', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(enter).toBeFocused();
  await enter.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.workspace')).toHaveJSProperty('inert', false);
  await page.getByRole('link', { name: 'About Campus Recall' }).click();
  await page.getByRole('link', { name: 'Open library', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await expect(dialog).toHaveCount(0);
});

test('sample demo can pause and resume without changing the paused example', async ({ page }) => {
  await page.goto('/');
  const example = page.locator('.lp-title');
  await expect(example).toHaveText('Hostel mess rules');
  await expect(page.locator('.res')).toHaveClass(/show/);
  await expect(page.locator('.demo')).toHaveCSS('opacity', '1');
  const pause = page.getByRole('button', { name: 'Pause demo', exact: true });
  await expect(pause).toBeVisible();
  await pause.click();
  await expect(page.getByRole('button', { name: 'Resume demo' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.demo')).toHaveCSS('opacity', '1');
  const before = await page.locator('.demo').innerText();
  // The normal result changes after 3.8 seconds; pause must outlast that timer.
  await page.waitForTimeout(4200);
  expect(await page.locator('.demo').innerText()).toBe(before);
  await expect(page.locator('.caret')).toHaveCSS('animation-play-state', 'paused');
  await page.getByRole('button', { name: 'Resume demo' }).click();
  await expect(page.locator('.demo')).toHaveCSS('opacity', '1');
  await expect(example).toHaveText('Chess lecture', { timeout: 12000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.lp-typed')).toHaveText('when do guests need a pass');
  await expect(example).toHaveText('Hostel mess rules');
  await expect(page.getByRole('button', { name: /(?:Pause|Resume) demo/ })).toHaveCount(0);
});

test('landing section links leave their labels below the sticky header', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const destinations =
      width === 1440
        ? [
            ['What it holds', '#lp-f-h'],
            ['Your device', '#lp-d-h'],
            ['How it works', '#lp-how-h'],
          ]
        : [['See how it works', '#lp-how-h']];
    for (const [name, label] of destinations) {
      await page.getByRole('link', { name, exact: true }).first().click();
      await expect
        .poll(() =>
          page.locator(label).evaluate((node) => {
            const header = document.querySelector('header.top')!.getBoundingClientRect();
            return node.getBoundingClientRect().top - header.bottom;
          }),
        )
        .toBeGreaterThanOrEqual(8);
      await expect(page.locator(label)).toBeInViewport();
    }
  }
});
