import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page, BrowserContext } from '@playwright/test';
export async function prepare(page: Page, context: BrowserContext) {
  const manifest = JSON.parse(await readFile('public/asset-manifest.json', 'utf8'));
  for (const asset of manifest.assets.filter((a: any) => a.url.startsWith('https:')))
    try {
      await access(path.resolve('.models', asset.sha256));
    } catch {
      throw Error('Acceptance assets missing. Run npm run models:download first.');
    }
  let setup = true;
  const external: string[] = [];
  await context.route(/^https:\/\//, async (route) => {
    const asset = manifest.assets.find((a: any) => a.url === route.request().url());
    if (!asset || !setup) {
      external.push(route.request().url());
      await route.abort();
      return;
    }
    await route.fulfill({
      status: 302,
      headers: {
        location: `http://127.0.0.1:4180/${asset.sha256}`,
        'access-control-allow-origin': '*',
      },
    });
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('BROWSER:', msg.text());
  });
  await page.goto('http://127.0.0.1:4173/tests/harness.html');
  await page.waitForFunction(
    () => !!(window as any).harness && !!navigator.serviceWorker.controller,
  );
  await page.evaluate(async () => {
    const h = (window as any).harness;
    await h.setupAssets(await h.getManifest(), () => {});
  });
  setup = false;
  return { external };
}
export async function fixture(page: Page, file: string) {
  return page.evaluate(async (file) => {
    const r = await fetch(`/tests/fixtures/${file}`);
    return Array.from(new Uint8Array(await r.arrayBuffer()));
  }, file);
}
