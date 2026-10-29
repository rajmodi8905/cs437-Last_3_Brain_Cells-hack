import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
test('critical library routes have no automated WCAG A/AA violations', async ({ page }) => {
  await page.goto('/#/library');
  await page.getByRole('button', { name: 'Open my library' }).click();
  const findings: any[] = [];
  for (const width of [390, 1440])
    for (const route of ['library', 'add', 'settings', 'privacy', 'terms']) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/#/${route}`);
      await expect(page.locator('h1')).toBeVisible();
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      findings.push(
        ...results.violations.map((v) => ({
          route,
          width,
          id: v.id,
          impact: v.impact,
          nodes: v.nodes.map((n) => ({ html: n.html, summary: n.failureSummary })),
        })),
      );
    }
  await writeFile('test-results/axe.json', JSON.stringify(findings, null, 2));
  expect(findings).toEqual([]);
});
