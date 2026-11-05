import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test, type Browser, type Page } from '@playwright/test';

const pdf = Buffer.from(
  '%PDF-1.4\n' + 'Guests need a pass from the warden before 6 pm. '.repeat(400) + '\n%%EOF',
);
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

async function openApp(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/#/library');
  await page.getByRole('button', { name: 'Open my library' }).click();
  return page;
}
async function signIn(page: Page, email: string) {
  await page.goto('/#/settings');
  const sync = page.getByRole('region', { name: 'Auto-sync' });
  await expect(sync).toContainText('Local only');
  await sync.getByLabel('IITGN email').fill(email);
  await sync.getByRole('button', { name: 'Sign in (development)' }).click();
  await expect(sync).toContainText(`Signed in as ${email}`);
  return sync;
}

test('a PDF saved on the phone is found and opened byte for byte on the laptop', async ({
  browser,
}) => {
  const phone = await openApp(browser);
  const uploads: string[] = [];
  phone.on('request', (request) => {
    if (/\/api\/v1\/(items|uploads)\//.test(request.url())) uploads.push(request.url());
  });
  await phone.goto('/#/add');
  await phone
    .getByLabel('Choose files to save')
    .setInputFiles({ name: 'mess-rules.pdf', mimeType: 'application/pdf', buffer: pdf });
  await phone.getByLabel(/^Title/).fill('Hostel mess rules');
  await phone.getByRole('button', { name: 'Save locally' }).click();
  await expect(phone.getByRole('status')).toContainText('Saved locally');

  const phoneSync = await signIn(phone, 'student@iitgn.ac.in');
  // Signing in alone uploads nothing.
  await phone.waitForTimeout(1500);
  expect(uploads).toEqual([]);
  await phoneSync.getByRole('button', { name: "Include this device's library" }).click();
  await expect(phoneSync).toContainText('Auto-sync is on');
  await expect(phoneSync).toContainText('1 item synced');
  expect(uploads.length).toBeGreaterThan(0);

  const laptop = await openApp(browser);
  const laptopSync = await signIn(laptop, 'student@iitgn.ac.in');
  await laptopSync.getByRole('button', { name: "Include this device's library" }).click();
  const cloud = laptopSync.getByRole('list', { name: 'In your cloud library' });
  await expect(cloud.getByRole('listitem')).toHaveCount(1);
  await expect(cloud).toContainText('Hostel mess rules');
  const [download] = await Promise.all([
    laptop.waitForEvent('download'),
    cloud.getByRole('button', { name: 'Download Hostel mess rules' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('Hostel mess rules.pdf');
  const bytes = await readFile((await download.path())!);
  expect(sha(bytes)).toBe(sha(pdf));

  // A different account sees none of it.
  const other = await openApp(browser);
  const otherSync = await signIn(other, 'someone.else@iitgn.ac.in');
  await otherSync.getByRole('button', { name: "Include this device's library" }).click();
  await expect(otherSync).toContainText('Auto-sync is on');
  await expect(otherSync.getByRole('list', { name: 'In your cloud library' })).toHaveCount(0);
});

test('a non-IITGN email cannot sign in', async ({ browser }) => {
  const page = await openApp(browser);
  await page.goto('/#/settings');
  const sync = page.getByRole('region', { name: 'Auto-sync' });
  await sync.getByLabel('IITGN email').fill('someone@gmail.com');
  await sync.getByRole('button', { name: 'Sign in (development)' }).click();
  await expect(sync.getByRole('alert')).toContainText('IITGN');
  await expect(sync).toContainText('Local only');
});

test('signing in survives a reload', async ({ browser }) => {
  const page = await openApp(browser);
  await signIn(page, 'student@iitgn.ac.in');
  await page.reload();
  await expect(page.getByRole('region', { name: 'Auto-sync' })).toContainText(
    'Signed in as student@iitgn.ac.in',
  );
});

test('the Auto-sync section has no automated WCAG A/AA violations', async ({ browser }) => {
  const { default: AxeBuilder } = await import('@axe-core/playwright');
  const page = await openApp(browser);
  const findings: unknown[] = [];
  const scan = async (state: string) => {
    const results = await new AxeBuilder({ page })
      .include('[aria-labelledby="autosync-title"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    findings.push(...results.violations.map((v) => ({ state, id: v.id, nodes: v.nodes.length })));
  };
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#/settings');
    await expect(page.getByRole('region', { name: 'Auto-sync' })).toContainText('Local only');
    await scan(`signed out ${width}`);
  }
  const sync = await signIn(page, 'student@iitgn.ac.in');
  await scan('signed in');
  await sync.getByRole('button', { name: "Include this device's library" }).click();
  await expect(sync).toContainText('Auto-sync is on');
  await scan('included');
  expect(findings).toEqual([]);
});
