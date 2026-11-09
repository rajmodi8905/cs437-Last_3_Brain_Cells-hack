import { expect, test, type Browser, type Page } from '@playwright/test';
// The cloud viewer closes like the local one: Escape closes it, and so does Back, which
// leaves no extra history entry behind.

let account = 0;
const freshEmail = () => `keys.${Date.now()}.${account++}@iitgn.ac.in`;

async function openApp(browser: Browser, path = '/#/library') {
  const page = await (await browser.newContext()).newPage();
  await page.goto(path);
  await page.getByRole('button', { name: 'Open my library' }).click();
  return page;
}
async function signInAndInclude(page: Page, email: string) {
  await page.goto('/#/settings');
  const sync = page.getByRole('region', { name: 'Auto-sync' });
  await sync.getByRole('button', { name: 'Set up Auto-sync' }).click();
  await sync.getByLabel('IITGN email').fill(email);
  await sync.getByRole('button', { name: 'Sign in (development)' }).click();
  await expect(sync).toContainText(`Signed in as ${email}`);
  await sync.getByRole('button', { name: "Include this device's library" }).click();
  await expect(sync).toContainText('Auto-sync is on');
  return sync;
}

test('Escape and Back close the cloud viewer', async ({ browser }) => {
  const email = freshEmail();
  const phone = await openApp(browser);
  await phone.goto('/#/add');
  await phone.getByRole('tab', { name: 'Note' }).click();
  await phone.getByLabel('Note').fill('Return the oscilloscope by Friday.');
  await phone.getByLabel(/^Title/).fill('Lab return');
  await phone.getByRole('button', { name: 'Save locally' }).click();
  await expect(phone.getByRole('status')).toContainText('Saved locally');
  const phoneSync = await signInAndInclude(phone, email);
  await expect(phoneSync).toContainText('1 item synced');

  const laptop = await openApp(browser);
  const laptopSync = await signInAndInclude(laptop, email);
  const cloud = laptopSync.getByRole('list', { name: 'In your cloud library' });
  await expect(cloud).toContainText('Lab return');
  const note = laptop.getByRole('region', { name: 'Lab return' });

  await cloud.getByRole('button', { name: 'Open Lab return' }).click();
  await expect(note).toContainText('Return the oscilloscope by Friday.');
  await laptop.keyboard.press('Escape');
  await expect(note).toHaveCount(0);

  await cloud.getByRole('button', { name: 'Open Lab return' }).click();
  await expect(note).toContainText('Return the oscilloscope by Friday.');
  await laptop.goBack();
  await expect(note).toHaveCount(0);
  expect(new URL(laptop.url()).hash).toBe('#/settings');
});
