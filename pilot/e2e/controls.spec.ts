import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test, type Browser, type Page } from '@playwright/test';

const pdf = (text: string) => Buffer.from('%PDF-1.4\n' + `${text} `.repeat(300) + '\n%%EOF');
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
let account = 0;
const freshEmail = () => `controls.${Date.now()}.${account++}@iitgn.ac.in`;

async function openApp(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/#/library');
  await page.getByRole('button', { name: 'Open my library' }).click();
  return page;
}
async function savePdf(page: Page, title: string, bytes: Buffer) {
  await page.goto('/#/add');
  await page
    .getByLabel('Choose files to save')
    .setInputFiles({ name: `${title}.pdf`, mimeType: 'application/pdf', buffer: bytes });
  await page.getByLabel(/^Title/).fill(title);
  await page.getByRole('button', { name: 'Save locally' }).click();
  await expect(page.getByRole('status')).toContainText('Saved locally');
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
async function phoneAndLaptop(browser: Browser) {
  const email = freshEmail();
  const bytes = pdf('Guests need a pass from the warden before 6 pm.');
  const phone = await openApp(browser);
  await savePdf(phone, 'Hostel mess rules', bytes);
  const phoneSync = await signInAndInclude(phone, email);
  await expect(phoneSync).toContainText('1 item synced');
  const laptop = await openApp(browser);
  const laptopSync = await signInAndInclude(laptop, email);
  const cloud = laptopSync.getByRole('list', { name: 'In your cloud library' });
  await expect(cloud).toContainText('Hostel mess rules');
  return { phone, phoneSync, laptop, laptopSync, cloud, bytes };
}

test('a kept-offline copy opens without the network, and removing it only removes this copy', async ({
  browser,
}) => {
  const { laptop, cloud, bytes } = await phoneAndLaptop(browser);
  await cloud.getByRole('button', { name: 'Keep offline Hostel mess rules' }).click();
  await expect(cloud).toContainText('Kept offline');

  await laptop.context().setOffline(true);
  const [download] = await Promise.all([
    laptop.waitForEvent('download'),
    cloud.getByRole('button', { name: 'Download Hostel mess rules' }).click(),
  ]);
  expect(sha(await readFile((await download.path())!))).toBe(sha(bytes));

  await laptop.context().setOffline(false);
  await cloud.getByRole('button', { name: 'Remove download of Hostel mess rules' }).click();
  await expect(cloud).not.toContainText('Kept offline');
  await expect(cloud).toContainText('Hostel mess rules');
  await laptop.context().setOffline(true);
  await cloud.getByRole('button', { name: 'Download Hostel mess rules' }).click();
  await expect(laptop.getByRole('region', { name: 'Auto-sync' }).getByRole('alert')).toBeVisible();
});

test('a kept-offline copy still opens after the app restarts without the network', async ({
  browser,
}) => {
  const { laptop, cloud, bytes } = await phoneAndLaptop(browser);
  await cloud.getByRole('button', { name: 'Keep offline Hostel mess rules' }).click();
  await expect(cloud).toContainText('Kept offline');

  // The app is closed and reopened while the sync service cannot be reached.
  await laptop.route('**/api/v1/**', (route) => route.abort('internetdisconnected'));
  await laptop.reload();
  await laptop.goto('/#/settings');
  await laptop.waitForLoadState();
  const sync = laptop.getByRole('region', { name: 'Auto-sync' });
  await expect(sync).toContainText('Offline');
  const kept = sync.getByRole('list', { name: 'Kept offline' });
  await expect(kept).toContainText('Hostel mess rules');

  const [download] = await Promise.all([
    laptop.waitForEvent('download'),
    kept.getByRole('button', { name: 'Download Hostel mess rules' }).click(),
  ]);
  expect(sha(await readFile((await download.path())!))).toBe(sha(bytes));
  await kept.getByRole('button', { name: 'Open Hostel mess rules' }).click();
  await expect(laptop.getByRole('region', { name: 'Hostel mess rules' })).toBeVisible();
  await expect(sync.getByRole('alert')).toHaveCount(0);
});

test('removing the cloud library stops other devices until they start again', async ({
  browser,
}) => {
  const { phone, phoneSync, laptopSync } = await phoneAndLaptop(browser);
  await laptopSync.getByRole('button', { name: 'Remove cloud library' }).click();
  await laptopSync.getByRole('button', { name: 'Yes, remove cloud library' }).click();
  await expect(
    laptopSync.getByRole('button', { name: "Include this device's library" }),
  ).toBeVisible();
  await expect(laptopSync.getByRole('list', { name: 'In your cloud library' })).toHaveCount(0);

  const uploads: string[] = [];
  phone.on('request', (request) => {
    if (/\/api\/v1\/(items|uploads)\//.test(request.url())) uploads.push(request.url());
  });
  await phoneSync.getByRole('button', { name: 'Sync now' }).click();
  await expect(phoneSync).toContainText('Your cloud library was removed or reset');
  expect(uploads).toEqual([]);
  await phoneSync.getByRole('button', { name: 'Start again' }).click();
  await phoneSync.getByRole('button', { name: "Include this device's library" }).click();
  await expect(phoneSync).toContainText('1 item synced');
  expect(uploads.length).toBeGreaterThan(0);
});

test('pausing sync on a device sends nothing until it resumes', async ({ browser }) => {
  const email = freshEmail();
  const phone = await openApp(browser);
  await savePdf(phone, 'First', pdf('First file'));
  const sync = await signInAndInclude(phone, email);
  await expect(sync).toContainText('1 item synced');
  await sync.getByRole('button', { name: 'Pause sync on this device' }).click();
  await expect(sync).toContainText('Sync is paused on this device');

  const uploads: string[] = [];
  phone.on('request', (request) => {
    if (/\/api\/v1\/(items|uploads)\//.test(request.url())) uploads.push(request.url());
  });
  await savePdf(phone, 'Second', pdf('Second file'));
  await phone.waitForTimeout(2000);
  expect(uploads).toEqual([]);

  await phone.goto('/#/settings');
  const again = phone.getByRole('region', { name: 'Auto-sync' });
  await again.getByRole('button', { name: 'Resume sync' }).click();
  await expect(again).toContainText('2 items synced');
});
