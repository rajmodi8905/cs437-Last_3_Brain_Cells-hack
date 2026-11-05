import { crc32, deflateSync } from 'node:zlib';
import { expect, test, type Browser, type Page } from '@playwright/test';

let account = 0;
const freshEmail = () => `viewer.${Date.now()}.${account++}@iitgn.ac.in`;

/** A real 4 by 4 PNG, so the viewer has an image to decode. */
function png() {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(4, 0);
  header.writeUInt32BE(4, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const rows = Buffer.concat(
    Array.from({ length: 4 }, () => Buffer.from([0, ...Array(12).fill(200)])),
  );
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function openApp(browser: Browser, path = '/#/library') {
  const page = await (await browser.newContext()).newPage();
  await page.goto(path);
  await page.getByRole('button', { name: 'Open my library' }).click();
  return page;
}
async function signInAndInclude(page: Page, email: string) {
  await page.goto('/#/settings');
  const sync = page.getByRole('region', { name: 'Auto-sync' });
  await sync.getByLabel('IITGN email').fill(email);
  await sync.getByRole('button', { name: 'Sign in (development)' }).click();
  await expect(sync).toContainText(`Signed in as ${email}`);
  await sync.getByRole('button', { name: "Include this device's library" }).click();
  await expect(sync).toContainText('Auto-sync is on');
  return sync;
}

test('an INSIIT link opens the site, drops any token from the address and never sends it', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const sent: string[] = [];
  page.on('request', (request) => {
    // The link itself is opened by the browser; everything after it must not carry the token.
    if (request.isNavigationRequest() && request.frame() === page.mainFrame() && !sent.length)
      return void sent.push('opened');
    const headers = request.headers();
    sent.push(`${request.url()} ${headers.referer ?? ''} ${request.postData() ?? ''}`);
  });
  await page.goto('/?from=insiit&id_token=leak-123#/library?access_token=leak-456');
  await expect.poll(() => page.url()).not.toContain('leak');
  expect(page.url()).not.toContain('from=');
  expect(new URL(page.url()).hash).toBe('#/library');

  await page.getByRole('button', { name: 'Open my library' }).click();
  await page.getByRole('link', { name: 'Settings' }).first().click();
  const sync = page.getByRole('region', { name: 'Auto-sync' });
  await expect(sync).toContainText('You opened Campus Recall from INSIIT');
  await expect(sync).toContainText('Local only');
  expect(sent[0]).toBe('opened');
  expect(sent.filter((line) => line.includes('/api/v1/')).length).toBeGreaterThan(0);
  expect(sent.filter((line) => line.includes('/api/v1/') && line.includes('leak'))).toEqual([]);
  expect(sent.filter((line) => line.includes('/api/v1/session') && line.includes('POST'))).toEqual(
    [],
  );
});

test("another device's note and image open in the viewer from the cloud library", async ({
  browser,
}) => {
  const email = freshEmail();
  const phone = await openApp(browser);
  await phone.goto('/#/add');
  await phone.getByRole('tab', { name: 'Note' }).click();
  await phone.getByLabel('Note').fill('Bring the lab coat on Thursday.');
  await phone.getByLabel(/^Title/).fill('Lab reminder');
  await phone.getByRole('button', { name: 'Save locally' }).click();
  await expect(phone.getByRole('status')).toContainText('Saved locally');
  await expect(phone).toHaveURL(/#\/library$/);
  await phone.goto('/#/add');
  await phone
    .getByLabel('Choose files to save')
    .setInputFiles({ name: 'mess-menu.png', mimeType: 'image/png', buffer: png() });
  await phone.getByLabel(/^Title/).fill('Mess menu photo');
  await phone.getByRole('button', { name: 'Save locally' }).click();
  await expect(phone.getByRole('status')).toContainText('Saved locally');
  await expect(phone).toHaveURL(/#\/library$/);
  const phoneSync = await signInAndInclude(phone, email);
  await expect(phoneSync).toContainText('2 items synced');

  const laptop = await openApp(browser);
  const laptopSync = await signInAndInclude(laptop, email);
  const cloud = laptopSync.getByRole('list', { name: 'In your cloud library' });
  await expect(cloud).toContainText('Lab reminder');

  await cloud.getByRole('button', { name: 'Open Lab reminder' }).click();
  const note = laptop.getByRole('region', { name: 'Lab reminder' });
  await expect(note).toContainText('Bring the lab coat on Thursday.');
  // The item is not saved on this device, so there is no local backup export to offer.
  await expect(note.getByRole('button', { name: 'Export this item as backup' })).toHaveCount(0);
  await note.getByRole('button', { name: 'Close original' }).click();
  await expect(note).toHaveCount(0);

  await cloud.getByRole('button', { name: 'Open Mess menu photo' }).click();
  const image = laptop
    .getByRole('region', { name: 'Mess menu photo' })
    .getByRole('img', { name: 'Mess menu photo' });
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth))
    .toBe(4);
});
