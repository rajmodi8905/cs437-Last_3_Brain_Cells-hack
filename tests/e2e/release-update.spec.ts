import { test, expect } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
let server: Server;
let base: string;
let generation = 0;
test.beforeAll(async () => {
  const files = new Map<string, Buffer>();
  async function load(prefix = '') {
    for (const entry of await readdir(join('dist', prefix), { withFileTypes: true })) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await load(name);
      else files.set('/' + name, await readFile(join('dist', name)));
    }
  }
  await load();
  const types: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.css': 'text/css',
    '.wasm': 'application/wasm',
    '.json': 'application/json',
    '.webmanifest': 'application/manifest+json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
  };
  server = createServer((request, response) => {
    const path = new URL(request.url!, 'http://localhost').pathname;
    const file = path === '/' ? '/index.html' : path;
    const body = files.get(file);
    if (!body) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, {
      'Content-Type': types[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    response.end(
      file === '/sw.js'
        ? Buffer.concat([
            body,
            Buffer.from(`\n// Synthetic update test generation ${generation}\n`),
          ])
        : body,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Missing update-test listener');
  base = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
test('a real service-worker update waits for the user and preserves the saved original offline', async ({
  page,
  context,
}) => {
  await page.goto(`${base}/#/library`);
  await page.getByRole('button', { name: 'Open my library' }).click();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.goto(base + '/#/add');
  await page.getByRole('tab', { name: 'Note', exact: true }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill('Update preservation');
  const original = 'Synthetic original saved before the app update. Preserve these exact bytes.';
  await page.getByRole('textbox', { name: 'Note', exact: true }).fill(original);
  await page.getByRole('button', { name: 'Save locally' }).click();
  await expect(page.getByRole('status')).toContainText('Saved locally');
  await page.evaluate(() => {
    (window as any).__beforeUpdate = 'still open';
  });
  generation = 1;
  await page.evaluate(async () => {
    await (await navigator.serviceWorker.getRegistration())!.update();
  });
  await expect(page.getByRole('button', { name: 'Reload update', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__beforeUpdate)).toBe('still open');
  await page.getByRole('button', { name: /Update preservation Notes/ }).click();
  await expect(page.locator('.original-text')).toHaveText(original);
  await page.getByRole('button', { name: 'Close original' }).click();
  await Promise.all([
    page.waitForEvent('domcontentloaded'),
    page.getByRole('button', { name: 'Reload update', exact: true }).click(),
  ]);
  expect(await page.evaluate(() => (window as any).__beforeUpdate)).toBeUndefined();
  await expect(page.getByRole('button', { name: /Update preservation Notes/ })).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: /Update preservation Notes/ }).click();
  await expect(page.locator('.original-text')).toHaveText(original);
});
