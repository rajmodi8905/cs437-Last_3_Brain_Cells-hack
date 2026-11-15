import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

// The deployed site sends Caddy's Content-Security-Policy; the preview server sends none. Apply
// the exact policy from the Caddyfile to every app response so capture is tested as students see it.
const caddyfile = readFileSync('pilot/deploy/Caddyfile', 'utf8');
const productionCsp = /\?Content-Security-Policy "([^"]+)"/.exec(caddyfile)![1];

test.use({ serviceWorkers: 'block' });

test('captures a permitted public HTTPS page under the production Content-Security-Policy', async ({
  page,
}) => {
  await page.route('http://127.0.0.1:4174/**', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: { ...response.headers(), 'content-security-policy': productionCsp },
    });
  });
  // A public page on another HTTPS origin that permits cross-origin reads.
  await page.route('https://pages.example.test/**', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/html', 'access-control-allow-origin': '*' },
      body: '<title>Workshop</title><main><p>Robot workshop registration opens on Thursday.</p></main>',
    }),
  );
  const violations: string[] = [];
  page.on('console', (message) => {
    if (/Content Security Policy/i.test(message.text())) violations.push(message.text());
  });

  const document = page.waitForResponse(
    (response) =>
      response.request().resourceType() === 'document' &&
      response.headers()['content-security-policy'] === productionCsp,
  );
  await page.goto('/#/library');
  await document;
  await page.getByRole('button', { name: 'Open my library' }).click();
  await page.goto('/#/add');
  await page.getByRole('tab', { name: 'Webpage', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Public webpage URL' })
    .fill('https://pages.example.test/workshop');
  await page.getByRole('button', { name: 'Capture', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Saved page text' })).toHaveValue(
    'Robot workshop registration opens on Thursday.',
  );
  expect(violations.filter((text) => text.includes('connect-src'))).toEqual([]);
});
