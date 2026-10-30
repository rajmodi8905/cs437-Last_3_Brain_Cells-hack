import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page, BrowserContext, Route } from '@playwright/test';
// WebKit cannot synthesize a redirect in route.fulfill. Serve the same pinned
// local mirror bytes directly there; Chromium retains its streaming redirect.
export async function mirrorSetupAsset(route: Route, sha256: string, page: Page) {
  if (page.context().browser()?.browserType().name() === 'webkit') {
    await route.fulfill({
      status: 200,
      body: await readFile(path.resolve('.models', sha256)),
      headers: { 'content-type': 'application/octet-stream', 'access-control-allow-origin': '*' },
    });
  } else {
    await route.fulfill({
      status: 302,
      headers: {
        location: `http://127.0.0.1:4180/${sha256}`,
        'access-control-allow-origin': '*',
      },
    });
  }
}
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
    await mirrorSetupAsset(route, asset.sha256, page);
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
