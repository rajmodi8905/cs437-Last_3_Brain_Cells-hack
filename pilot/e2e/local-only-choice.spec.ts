import { expect, test } from '@playwright/test';
// "Use Local only" reads as a choice, with a line saying what it means, and the INSIIT note
// (which explains how to sign in) shows only while the student is not signed in.

test('Use Local only is described as a choice, and the INSIIT note goes once signed in', async ({
  browser,
}) => {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/?from=insiit#/library');
  await page.getByRole('button', { name: 'Open my library' }).click();
  await page.goto('/#/settings');
  const sync = page.getByRole('region', { name: 'Auto-sync' });
  await expect(sync).toContainText('You opened Campus Recall from INSIIT');
  await sync.getByRole('button', { name: 'Set up Auto-sync' }).click();
  const localOnly = sync.getByRole('button', { name: 'Use Local only' });
  await expect(localOnly).toHaveAccessibleDescription(
    'Keep everything on this device. You can turn on Auto-sync later.',
  );
  await expect(sync).toContainText('You opened Campus Recall from INSIIT');
  const email = `choice.${Date.now()}@iitgn.ac.in`;
  await sync.getByLabel('IITGN email').fill(email);
  await sync.getByRole('button', { name: 'Sign in (development)' }).click();
  await expect(sync).toContainText(`Signed in as ${email}`);
  await expect(sync).not.toContainText('You opened Campus Recall from INSIIT');
  await expect(sync.getByRole('button', { name: 'Use Local only' })).toHaveCount(0);
});
