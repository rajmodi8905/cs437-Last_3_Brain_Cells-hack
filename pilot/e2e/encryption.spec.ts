import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';

// docs/pilot/e2ee-design.md, phase 3: the Settings screens for end-to-end encryption. Each test
// uses its own account, so turning encryption on cannot reach another test's library.

const pdf = (text: string) => Buffer.from('%PDF-1.4\n' + `${text} `.repeat(300) + '\n%%EOF');
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const account = () => `e2ee.${randomUUID().slice(0, 8)}@iitgn.ac.in`;

async function openApp(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/#/library');
  await page.getByRole('button', { name: 'Open my library' }).click();
  return page;
}

async function save(page: Page, title: string, bytes: Buffer) {
  await page.goto('/#/add');
  await page
    .getByLabel('Choose files to save')
    .setInputFiles({ name: `${title}.pdf`, mimeType: 'application/pdf', buffer: bytes });
  await page.getByLabel(/^Title/).fill(title);
  await page.getByRole('button', { name: 'Save locally' }).click();
  await expect(page.getByRole('status')).toContainText('Saved locally');
}

/** Signs in and includes this device's library; returns the Auto-sync section. */
async function syncAs(page: Page, email: string) {
  await page.goto('/#/settings');
  const sync = page.getByRole('region', { name: 'Auto-sync' });
  await sync.getByRole('button', { name: 'Set up Auto-sync' }).click();
  await sync.getByLabel('IITGN email').fill(email);
  await sync.getByRole('button', { name: 'Sign in (development)' }).click();
  await expect(sync).toContainText(`Signed in as ${email}`);
  await sync.getByRole('button', { name: "Include this device's library" }).click();
  return sync;
}

/** Turns encryption on, confirming the recovery code; returns the code. */
async function turnOn(sync: Locator) {
  await sync.getByRole('button', { name: 'Turn on end-to-end encryption' }).click();
  const code = (await sync.locator('.recovery-code').innerText()).trim();
  expect(code).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){6}[0-9A-HJKMNP-TV-Z]{3}$/);
  const confirm = sync.getByRole('button', { name: 'Turn on encryption' });
  await expect(confirm).toBeDisabled();
  await sync.getByLabel('Type the last group of the code').fill(code.split('-').at(-1)!);
  await confirm.click();
  await expect(sync).toContainText('On. Originals, titles and search data are encrypted');
  return code;
}

async function wcag(page: Page) {
  const { default: AxeBuilder } = await import('@axe-core/playwright');
  const results = await new AxeBuilder({ page })
    .include('[aria-labelledby="autosync-title"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  return results.violations.map((v) => v.id);
}

test('a second device opens an encrypted library only with the recovery code', async ({
  browser,
}) => {
  const email = account();
  const phone = await openApp(browser);
  const phoneSync = await syncAs(phone, email);
  await expect(phoneSync).toContainText('Auto-sync is on');
  await expect(phoneSync).toContainText('Off. Cloud copies are encrypted in storage');
  const code = await turnOn(phoneSync);
  expect(await wcag(phone)).toEqual([]);

  const uploads: string[] = [];
  phone.on('request', (request) => {
    if (/\/items\/[^/]+\/upload$/.test(request.url())) uploads.push(request.postData() ?? '');
  });
  const bytes = pdf('Room allotment list for the winter term');
  await save(phone, 'Room allotment', bytes);
  await phone.goto('/#/settings');
  await expect(phoneSync).toContainText('1 item synced');
  expect(uploads).toHaveLength(1);
  expect(uploads[0]).toContain('"sealed"');
  expect(uploads[0]).not.toContain('Room allotment');

  const laptop = await openApp(browser);
  const laptopSync = await syncAs(laptop, email);
  await expect(laptopSync).toContainText('waiting for your library');
  await expect(laptopSync).toContainText('Your cloud library is end-to-end encrypted');
  expect(await wcag(laptop)).toEqual([]);
  await laptopSync.getByLabel('Recovery code').fill('ABCD-EFGH');
  await laptopSync.getByRole('button', { name: 'Unlock' }).click();
  await expect(laptopSync.getByRole('alert')).toContainText('recovery code');
  await laptopSync.getByLabel('Recovery code').fill(code.toLowerCase());
  await laptopSync.getByRole('button', { name: 'Unlock' }).click();

  const cloud = laptopSync.getByRole('list', { name: 'In your cloud library' });
  await expect(cloud).toContainText('Room allotment');
  const [download] = await Promise.all([
    laptop.waitForEvent('download'),
    cloud.getByRole('button', { name: 'Download Room allotment' }).click(),
  ]);
  expect(sha(await readFile((await download.path())!))).toBe(sha(bytes));
  await laptopSync.getByRole('button', { name: 'Show recovery code' }).click();
  await expect(laptopSync.locator('.recovery-code')).toHaveText(code);
});

test('pairing passes the key to a new device once both show the same number', async ({
  browser,
}) => {
  const email = account();
  const phone = await openApp(browser);
  const phoneSync = await syncAs(phone, email);
  await turnOn(phoneSync);
  await save(phone, 'Mess menu', pdf('Paneer on Tuesday and Friday'));
  await phone.goto('/#/settings');
  await expect(phoneSync).toContainText('1 item synced');

  const tablet = await openApp(browser);
  const tabletSync = await syncAs(tablet, email);
  await tabletSync.getByRole('button', { name: 'Pair with another device' }).click();
  const pairingCode = (await tabletSync.locator('.recovery-code').innerText()).trim();
  expect(pairingCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);

  await phoneSync.getByRole('button', { name: 'Add a device' }).click();
  await phoneSync.getByLabel('Pairing code from the new device').fill(pairingCode);
  await phoneSync.getByRole('button', { name: 'Continue' }).click();

  const onPhone = phoneSync.locator('.check-number');
  const onTablet = tabletSync.locator('.check-number');
  await expect(onPhone).toHaveText(/^\d{3} \d{3}$/, { timeout: 15_000 });
  await expect(onTablet).toHaveText(/^\d{3} \d{3}$/, { timeout: 15_000 });
  expect(await onTablet.innerText()).toBe(await onPhone.innerText());
  expect(await wcag(tablet)).toEqual([]);

  await phoneSync.getByRole('button', { name: 'The numbers match' }).click();
  await tabletSync.getByRole('button', { name: 'The numbers match' }).click();
  await expect(tabletSync).toContainText('On. Originals, titles and search data are encrypted', {
    timeout: 15_000,
  });
  await expect(tabletSync.getByRole('list', { name: 'In your cloud library' })).toContainText(
    'Mess menu',
  );
});

test('turning encryption on seals what is already in the cloud library', async ({ browser }) => {
  const email = account();
  const phone = await openApp(browser);
  const bytes = pdf('Hostel rules for guests and visitors');
  await save(phone, 'Hostel rules', bytes);
  const phoneSync = await syncAs(phone, email);
  await expect(phoneSync).toContainText('1 item synced');

  const reseals: string[] = [];
  phone.on('request', (request) => {
    if (/\/items\/[^/]+\/upload$/.test(request.url())) reseals.push(request.postData() ?? '');
  });
  const code = await turnOn(phoneSync);
  await expect.poll(() => reseals.length).toBe(1);
  expect(reseals[0]).toContain('"reseal"');
  expect(reseals[0]).not.toContain('Hostel rules');

  const laptop = await openApp(browser);
  const laptopSync = await syncAs(laptop, email);
  await laptopSync.getByLabel('Recovery code').fill(code);
  await laptopSync.getByRole('button', { name: 'Unlock' }).click();
  const cloud = laptopSync.getByRole('list', { name: 'In your cloud library' });
  await expect(cloud).toContainText('Hostel rules');
  const [download] = await Promise.all([
    laptop.waitForEvent('download'),
    cloud.getByRole('button', { name: 'Download Hostel rules' }).click(),
  ]);
  expect(sha(await readFile((await download.path())!))).toBe(sha(bytes));
});

/** Signs in without including this device's library; returns the Auto-sync section. */
async function signInOnly(page: Page, email: string) {
  await page.goto('/#/settings');
  const sync = page.getByRole('region', { name: 'Auto-sync' });
  await sync.getByRole('button', { name: 'Set up Auto-sync' }).click();
  await sync.getByLabel('IITGN email').fill(email);
  await sync.getByRole('button', { name: 'Sign in (development)' }).click();
  await expect(sync).toContainText(`Signed in as ${email}`);
  return sync;
}

test('a library can be encrypted before its first upload', async ({ browser }) => {
  const email = account();
  const phone = await openApp(browser);
  await save(phone, 'Exam timetable', pdf('Midsem exams start on the third Monday'));
  const uploads: string[] = [];
  phone.on('request', (request) => {
    if (/\/items\/[^/]+\/upload$/.test(request.url())) uploads.push(request.postData() ?? '');
  });
  const sync = await signInOnly(phone, email);
  await sync
    .getByRole('checkbox', { name: /Encrypt end to end before anything is uploaded/ })
    .check();
  await sync.getByRole('button', { name: "Include this device's library" }).click();
  const code = (await sync.locator('.recovery-code').innerText()).trim();
  expect(code).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){6}[0-9A-HJKMNP-TV-Z]{3}$/);
  expect(await wcag(phone)).toEqual([]);
  // Nothing is included or uploaded while the code is on screen.
  await phone.waitForTimeout(1000);
  expect(uploads).toEqual([]);
  await sync.getByLabel('Type the last group of the code').fill(code.split('-').at(-1)!);
  await sync.getByRole('button', { name: 'Include and encrypt' }).click();
  await expect(sync).toContainText('1 item synced');
  await expect(sync).toContainText('On. Originals, titles and search data are encrypted');
  expect(uploads).toHaveLength(1);
  expect(uploads[0]).toContain('"sealed"');
  expect(uploads[0]).not.toContain('"reseal"');
  expect(uploads[0]).not.toContain('Exam timetable');

  // Another device is told before it includes anything.
  const laptop = await openApp(browser);
  const laptopSync = await signInOnly(laptop, email);
  await expect(laptopSync).toContainText('Your cloud library is end-to-end encrypted');
  await expect(laptopSync.getByRole('checkbox', { name: /Encrypt end to end/ })).toHaveCount(0);
});
