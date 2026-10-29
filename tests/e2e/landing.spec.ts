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
