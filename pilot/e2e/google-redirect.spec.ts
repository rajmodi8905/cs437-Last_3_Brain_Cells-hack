import { expect, test } from '@playwright/test';

// The second pilot server runs in Google sign-in mode (see playwright.config.ts).
const site = 'http://127.0.0.1:4611';

test('Sign in with Google goes to Google with PKCE, and a cancelled return is reported', async ({
  page,
}) => {
  // A browser follows redirects itself, so Google's page cannot be intercepted after one.
  // Instead the server's own redirect is caught here and never followed: nothing reaches Google.
  const google: URL[] = [];
  const outside: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith(site)) outside.push(request.url());
  });
  await page.route('**/api/v1/auth/google/start', async (route) => {
    const response = await route.fetch({ maxRedirects: 0 });
    expect(response.status()).toBe(302);
    google.push(new URL(response.headers()['location']));
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      headers: { 'set-cookie': response.headers()['set-cookie'] },
      body: '<p>Google stand-in</p>',
    });
  });
  await page.route('https://accounts.google.com/**', (route) => route.abort());
  await page.goto(`${site}/#/library`);
  await page.getByRole('button', { name: 'Open my library' }).click();
  await page.getByRole('link', { name: 'Settings' }).first().click();
  const sync = page.getByRole('region', { name: 'Auto-sync' });
  await expect(sync.getByLabel('IITGN email')).toHaveCount(0);
  await sync.getByRole('button', { name: 'Sign in with Google' }).click();
  await expect(page.getByText('Google stand-in')).toBeVisible();

  expect(google).toHaveLength(1);
  const to = google[0];
  expect(`${to.origin}${to.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth');
  expect(Object.fromEntries(to.searchParams)).toMatchObject({
    client_id: 'pilot-e2e.apps.googleusercontent.com',
    redirect_uri: `${site}/api/v1/auth/google/callback`,
    response_type: 'code',
    code_challenge_method: 'S256',
    hd: 'iitgn.ac.in',
  });

  // The user cancels at Google; Google returns with an error and the attempt's state.
  const state = to.searchParams.get('state')!;
  await page.goto(`${site}/api/v1/auth/google/callback?error=access_denied&state=${state}`);
  await expect.poll(() => page.url()).toBe(`${site}/#/settings`);
  const open = page.getByRole('button', { name: 'Open my library' });
  if (await open.isVisible()) await open.click();
  const back = page.getByRole('region', { name: 'Auto-sync' });
  await expect(back.getByRole('alert')).toHaveText('Sign-in was cancelled.');
  await expect(back.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
  expect(google).toHaveLength(1);
  expect(outside).toEqual([]);
});
