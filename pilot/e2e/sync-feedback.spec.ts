import { expect, test, type Browser, type Page } from '@playwright/test';

// Auto-sync actions that used to finish silently now confirm what happened, and a sign-in
// result from Google shows at the top of the Auto-sync section.
let account = 0;
const freshEmail = () => `feedback.${Date.now()}.${account++}@iitgn.ac.in`;
const pdf = (text: string) => Buffer.from('%PDF-1.4\n' + `${text} `.repeat(300) + '\n%%EOF');

async function openApp(browser: Browser) {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/#/library');
  await page.getByRole('button', { name: 'Open my library' }).click();
  return page;
}
async function savePdf(page: Page, title: string) {
  await page.goto('/#/add');
  await page
    .getByLabel('Choose files to save')
    .setInputFiles({ name: `${title}.pdf`, mimeType: 'application/pdf', buffer: pdf(title) });
  await page.getByLabel(/^Title/).fill(title);
  await page.getByRole('button', { name: 'Save locally' }).click();
  await expect(page.locator('.toast')).toContainText('Saved locally');
}
async function signIn(page: Page, email: string) {
  await page.goto('/#/settings');
  const sync = page.getByRole('region', { name: 'Auto-sync' });
  await sync.getByRole('button', { name: 'Set up Auto-sync' }).click();
  await sync.getByLabel('IITGN email').fill(email);
  await sync.getByRole('button', { name: 'Sign in (development)' }).click();
  await expect(sync).toContainText(`Signed in as ${email}`);
  return sync;
}
const toast = (page: Page) => page.locator('.toast');

test('including, syncing, cloud item actions and signing out each confirm what happened', async ({
  browser,
}) => {
  const email = freshEmail();
  const phone = await openApp(browser);
  await savePdf(phone, 'Mess timings');
  const phoneSync = await signIn(phone, email);
  await phoneSync.getByRole('button', { name: "Include this device's library" }).click();
  await expect(toast(phone)).toContainText(/included/i);
  await expect(phoneSync).toContainText('1 item synced');
  await phoneSync.getByRole('button', { name: 'Sync now' }).click();
  await expect(toast(phone)).toContainText('Up to date');

  const laptop = await openApp(browser);
  const laptopSync = await signIn(laptop, email);
  await laptopSync.getByRole('button', { name: "Include this device's library" }).click();
  const cloud = laptopSync.getByRole('list', { name: 'In your cloud library' });
  await expect(cloud).toContainText('Mess timings');
  await cloud.getByRole('button', { name: 'Keep offline Mess timings' }).click();
  await expect(toast(laptop)).toContainText(/kept offline/i);
  await cloud.getByRole('button', { name: 'Remove download of Mess timings' }).click();
  await expect(toast(laptop)).toContainText(/removed from this device/i);
  await Promise.all([
    laptop.waitForEvent('download'),
    cloud.getByRole('button', { name: 'Download Mess timings' }).click(),
  ]);
  await expect(toast(laptop)).toContainText(/download/i);
  await cloud.getByRole('button', { name: 'Delete Mess timings from your cloud library' }).click();
  await cloud
    .getByRole('button', { name: 'Confirm deleting Mess timings from your cloud library' })
    .click();
  await expect(toast(laptop)).toContainText('Deleted from your cloud library.');

  await laptopSync.getByRole('button', { name: 'Sign out' }).click();
  await expect(toast(laptop)).toContainText(
    'Signed out. Your library on this device is unchanged.',
  );
  await phoneSync.getByLabel(/When signing out, also remove/).check();
  await phoneSync.getByRole('button', { name: 'Sign out' }).click();
  await expect(toast(phone)).toContainText(/offline copies/i);
  await expect(phoneSync).toContainText('Local only');
});

test('a sign-in result shows at the top of Auto-sync and is scrolled into view', async ({
  browser,
}) => {
  const page = await openApp(browser);
  await page.setViewportSize({ width: 390, height: 500 });
  await page.goto('/?signin=failed#/settings');
  const sync = page.getByRole('region', { name: 'Auto-sync' });
  const alert = sync.getByRole('alert');
  await expect(alert).toHaveText('Sign-in did not finish. Try again.');
  await expect(alert).toBeInViewport();
  // The result comes before the section's other content, not after it.
  const order = await sync.evaluate((section) => {
    const alert = section.querySelector('[role="alert"]')!;
    const dates = Array.from(section.querySelectorAll('p')).find((p) =>
      p.textContent?.includes('Cloud access and export end'),
    )!;
    return alert.compareDocumentPosition(dates) & Node.DOCUMENT_POSITION_FOLLOWING;
  });
  expect(order).toBeTruthy();
});
