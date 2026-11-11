import { crc32, deflateSync } from 'node:zlib';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
// Production build: the app behaves like an installed phone app. Back closes the source
// viewer, the item menu closes on an outside tap or Escape, the manifest uses the paper
// colour and accepts shares, the library asks to be kept, Chromium gets one install offer
// after a save, iPhone Safari gets a Home Screen tip before the download, and a share from
// another app arrives on Add through the service worker without leaving the device.

/** A real 4 by 4 PNG. `shade` makes each image's bytes different. */
function png(shade = 200) {
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
    Array.from({ length: 4 }, () => Buffer.from([0, ...Array(12).fill(shade)])),
  );
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
async function enter(page: Page) {
  await page.goto('/#/library');
  await page.getByRole('button', { name: 'Open my library' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function saveNote(page: Page, title: string) {
  await page.goto('/#/add');
  await page.getByRole('tab', { name: 'Note', exact: true }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill(title);
  await page.getByRole('textbox', { name: 'Note', exact: true }).fill(`Body of ${title}.`);
  await page.getByRole('button', { name: 'Save locally' }).click();
  await expect(page.locator('.toast')).toContainText('Saved locally');
  await expect(page).toHaveURL(/#\/library$/);
}
async function saveImages(page: Page, count: number) {
  await page.goto('/#/add');
  await page.getByLabel('Choose files to save').setInputFiles(
    Array.from({ length: count }, (_, i) => ({
      name: `photo-${String(i + 1).padStart(2, '0')}.png`,
      mimeType: 'image/png',
      buffer: png(100 + i),
    })),
  );
  await page.getByRole('button', { name: 'Save locally' }).click();
  await expect(page.locator('.toast')).toContainText(`${count} items saved locally`);
  await expect(page).toHaveURL(/#\/library$/);
}
const viewer = (page: Page) => page.locator('.preview-panel');
const hash = (page: Page) => page.evaluate(() => location.hash);

test.describe('on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test('Back closes the full-screen viewer, keeps the list scrolled and returns focus', async ({
    page,
  }) => {
    await enter(page);
    await saveImages(page, 10);
    const row = page.locator('[data-item-id]').nth(8).locator('.item-open');
    await row.scrollIntoViewIfNeeded();
    const scrolled = await page.evaluate(() => scrollY);
    expect(scrolled).toBeGreaterThan(100);
    await row.tap();
    await expect(viewer(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Close original' })).toBeFocused();
    await page.goBack();
    await expect(viewer(page)).toHaveCount(0);
    expect(await hash(page)).toBe('#/library');
    await expect(row).toBeFocused();
    expect(Math.abs((await page.evaluate(() => scrollY)) - scrolled)).toBeLessThanOrEqual(2);
    // No entry is left behind: the next Back returns to the previous screen.
    await page.goBack();
    await expect.poll(() => hash(page)).toBe('#/add');
  });

  test('the close button leaves no extra Back step', async ({ page }) => {
    await enter(page);
    await saveNote(page, 'Close fixture');
    await page.getByRole('button', { name: /Close fixture Notes/ }).tap();
    await expect(viewer(page)).toBeVisible();
    await page.getByRole('button', { name: 'Close original' }).tap();
    await expect(viewer(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Close fixture Notes/ })).toBeFocused();
    await page.goBack();
    await expect.poll(() => hash(page)).toBe('#/add');
  });

  test('a tap opens the item menu where it can be seen, and a tap outside closes it', async ({
    page,
  }) => {
    await enter(page);
    await saveImages(page, 6);
    // The last row sits just above the bottom bar and the save notification.
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    const actions = page.getByRole('button', { name: /^Actions for / }).last();
    await actions.tap();
    await expect(actions).toHaveAttribute('aria-expanded', 'true');
    const menu = page.locator('.dropdown');
    await expect(menu).toBeVisible();
    for (const name of ['Rename', 'Delete']) {
      const option = menu.getByRole('button', { name, exact: true });
      const reachable = await option.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return r.top >= 0 && r.bottom <= innerHeight && !!hit && el.contains(hit);
      });
      expect(reachable, `${name} can be tapped`).toBe(true);
    }
    await page.getByRole('heading', { level: 1 }).tap();
    await expect(menu).toHaveCount(0);
    await expect(actions).toHaveAttribute('aria-expanded', 'false');
    // Escape closes the menu only, and focus goes back to its button.
    await actions.tap();
    await expect(menu).toBeVisible();
    await menu.getByRole('button', { name: 'Rename', exact: true }).focus();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(actions).toBeFocused();
    // The menu still works: Rename opens its dialog.
    await actions.tap();
    await menu.getByRole('button', { name: 'Rename', exact: true }).tap();
    await expect(page.getByRole('dialog')).toBeVisible();
  });
});

test('on a laptop, Escape closes the viewer and opening another item adds no Back step', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await enter(page);
  await saveNote(page, 'First fixture');
  await saveNote(page, 'Second fixture');
  await page.getByRole('button', { name: /First fixture Notes/ }).click();
  await expect(page.getByRole('region', { name: 'First fixture' })).toBeVisible();
  await page.getByRole('button', { name: /Second fixture Notes/ }).click();
  await expect(page.getByRole('region', { name: 'Second fixture' })).toBeVisible();
  await page.goBack();
  await expect(viewer(page)).toHaveCount(0);
  expect(await hash(page)).toBe('#/library');
  await page.getByRole('button', { name: /First fixture Notes/ }).click();
  await expect(viewer(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(viewer(page)).toHaveCount(0);
  await page.goBack();
  await expect.poll(() => hash(page)).toBe('#/add');
});

test('the manifest uses the paper colour and accepts shared files and text', async ({ page }) => {
  await page.goto('/#/library');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  const manifest = await (await page.request.get(new URL(href!, page.url()).href)).json();
  expect(manifest.theme_color).toBe('#f4f1ea');
  expect(manifest.background_color).toBe('#f4f1ea');
  const share = manifest.share_target;
  expect(share).toMatchObject({
    action: './share-target',
    method: 'POST',
    enctype: 'multipart/form-data',
    params: { title: 'title', text: 'text', url: 'url' },
  });
  const files = [share.params.files].flat();
  const accepted = files.flatMap((f: { accept: string | string[] }) => [f.accept].flat());
  for (const type of [
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
    'audio/mpeg',
    'audio/wav',
    'audio/mp4',
    'video/mp4',
  ])
    expect(accepted).toContain(type);
});

/** Replaces the browser's persistence answers so a test can count requests. */
async function stubPersistence(context: BrowserContext, grant: boolean) {
  await context.addInitScript((grant) => {
    let granted = false;
    const w = window as unknown as { persistCalls: number };
    w.persistCalls = 0;
    Object.defineProperty(navigator.storage, 'persisted', {
      configurable: true,
      value: async () => granted,
    });
    Object.defineProperty(navigator.storage, 'persist', {
      configurable: true,
      value: async () => {
        w.persistCalls++;
        granted = grant;
        return grant;
      },
    });
  }, grant);
}
const persistCalls = (page: Page) =>
  page.evaluate(() => (window as unknown as { persistCalls: number }).persistCalls);

test('the first save asks the browser to keep the library, and Settings says when it will', async ({
  page,
  context,
}) => {
  await stubPersistence(context, true);
  await enter(page);
  await page.goto('/#/settings');
  await expect(page.getByRole('button', { name: 'Keep my library on this device' })).toBeVisible();
  expect(await persistCalls(page)).toBe(0);
  await saveNote(page, 'Persist fixture');
  await expect.poll(() => persistCalls(page)).toBe(1);
  await saveNote(page, 'Second persist fixture');
  await page.locator('.settings-link').click();
  await expect(
    page.getByText('This browser will keep your library unless you clear site data.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Keep my library on this device' })).toHaveCount(0);
  expect(await persistCalls(page)).toBe(1);
});

test('a refused request is not repeated in the same session and the button stays', async ({
  page,
  context,
}) => {
  await stubPersistence(context, false);
  await enter(page);
  await saveNote(page, 'Refused fixture');
  await expect.poll(() => persistCalls(page)).toBe(1);
  await saveNote(page, 'Second refused fixture');
  await page.locator('.settings-link').click();
  await expect(page.getByRole('button', { name: 'Keep my library on this device' })).toBeVisible();
  expect(await persistCalls(page)).toBe(1);
});

/** Dispatches a stand-in for Chromium's install event shortly after each load. */
async function offerInstall(context: BrowserContext) {
  await context.addInitScript(() => {
    const w = window as unknown as { installPrompts: number };
    w.installPrompts = 0;
    addEventListener('load', () =>
      setTimeout(() => {
        const event = new Event('beforeinstallprompt', { cancelable: true });
        Object.assign(event, {
          prompt: async () => {
            w.installPrompts++;
          },
          userChoice: Promise.resolve({ outcome: 'accepted', platform: 'web' }),
        });
        dispatchEvent(event);
      }, 200),
    );
  });
}
const OFFER = 'Install AnyRecall for quick access and so your library is kept';

test('Chromium gets one install offer after the first save, and Not now is remembered', async ({
  page,
  context,
}) => {
  await offerInstall(context);
  await page.goto('/#/library');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.getByText(OFFER)).toHaveCount(0);
  await page.getByRole('button', { name: 'Open my library' }).click();
  await expect(page.getByText(OFFER)).toHaveCount(0);
  await saveNote(page, 'Install fixture');
  await expect(page.getByText(OFFER)).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Not now', exact: true }).click();
  await expect(page.getByText(OFFER)).toHaveCount(0);
  await saveNote(page, 'Second install fixture');
  await expect(page.getByText(OFFER)).toHaveCount(0);
  await page.reload();
  await page.waitForTimeout(500);
  await saveNote(page, 'Third install fixture');
  await expect(page.getByText(OFFER)).toHaveCount(0);
});

test('Install opens the browser install prompt and the offer goes away', async ({
  page,
  context,
}) => {
  await offerInstall(context);
  await enter(page);
  await page.waitForTimeout(500);
  await saveNote(page, 'Install prompt fixture');
  await page.getByRole('button', { name: 'Install', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { installPrompts: number }).installPrompts),
    )
    .toBe(1);
  await expect(page.getByText(OFFER)).toHaveCount(0);
});

test.describe('in iPhone Safari', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  });
  const TIP =
    'On iPhone, add AnyRecall to your Home Screen first (Share › Add to Home Screen). Safari can clear website data after 7 days without use; the Home Screen app keeps it.';

  test('the search download card suggests the Home Screen before downloading', async ({ page }) => {
    await enter(page);
    await page.goto('/#/search');
    const card = page.locator('.setup-card');
    const tip = card.getByText(TIP);
    await expect(tip).toBeVisible();
    const download = card.getByRole('button', { name: /^Download search/ });
    await expect(download).toBeEnabled();
    expect((await tip.boundingBox())!.y).toBeLessThan((await download.boundingBox())!.y);
  });

  test('the Home Screen app does not show the tip', async ({ page, context }) => {
    await context.addInitScript(() =>
      Object.defineProperty(navigator, 'standalone', { configurable: true, value: true }),
    );
    await enter(page);
    await page.goto('/#/search');
    await expect(page.locator('.setup-card')).toBeVisible();
    await expect(page.getByText(/add AnyRecall to your Home Screen/)).toHaveCount(0);
  });
});

test('Android Chrome does not show the iPhone tip', async ({ page }) => {
  await enter(page);
  await page.goto('/#/search');
  await expect(page.locator('.setup-card')).toBeVisible();
  await expect(page.getByText(/add AnyRecall to your Home Screen/)).toHaveCount(0);
});

/** Waits until the service worker controls the page, as it does in the installed app. */
async function controlled(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}
/** Submits a share the way Android's share sheet does: a multipart POST to the share target. */
async function share(
  page: Page,
  fields: Record<string, string>,
  files: { name: string; type: string; bytes: number[] }[] = [],
) {
  await page.evaluate(
    ({ fields, files }) => {
      const form = document.createElement('form');
      form.method = 'post';
      form.enctype = 'multipart/form-data';
      form.action = './share-target';
      for (const [name, value] of Object.entries(fields)) {
        const input = document.createElement('input');
        input.name = name;
        input.value = value;
        form.append(input);
      }
      const input = document.createElement('input');
      input.type = 'file';
      input.name = 'files';
      input.multiple = true;
      const transfer = new DataTransfer();
      for (const file of files)
        transfer.items.add(new File([new Uint8Array(file.bytes)], file.name, { type: file.type }));
      input.files = transfer.files;
      form.append(input);
      document.body.append(form);
      form.submit();
    },
    { fields, files },
  );
}
const sharedCopies = (page: Page) =>
  page.evaluate(async () => {
    let count = 0;
    for (const name of await caches.keys())
      if (/share/i.test(name)) count += (await (await caches.open(name)).keys()).length;
    return count;
  });

test('a photo shared from another app arrives on Add, offline, and saves locally', async ({
  page,
  context,
}) => {
  await enter(page);
  await controlled(page);
  const outside: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:4174/')) outside.push(request.url());
  });
  await context.setOffline(true);
  await share(page, { title: '', text: '', url: '' }, [
    { name: 'timetable.png', type: 'image/png', bytes: [...png(90)] },
  ]);
  await expect(page).toHaveURL(/#\/add$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Add to your library' })).toBeVisible();
  await expect(page.getByText('1 file selected')).toBeVisible();
  await expect(page.locator('.selected-files')).toContainText('timetable.png');
  await expect.poll(() => sharedCopies(page)).toBe(0);
  await page.getByRole('button', { name: 'Save locally' }).click();
  await expect(page.locator('.toast')).toContainText('Saved locally');
  await expect(page).toHaveURL(/#\/library$/);
  await expect(page.locator('.item-title', { hasText: 'timetable' })).toBeVisible();
  await context.setOffline(false);
  expect(outside).toEqual([]);
});

test('shared text becomes a note, and a shared link fills the webpage form', async ({ page }) => {
  await enter(page);
  await controlled(page);
  await share(page, { title: 'Mess timings', text: 'Dinner is served from 7:30 pm.', url: '' });
  await expect(page).toHaveURL(/#\/add$/);
  await expect(page.getByRole('tab', { name: 'Note', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('textbox', { name: 'Note', exact: true })).toHaveValue(
    'Dinner is served from 7:30 pm.',
  );
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue('Mess timings');
  await expect.poll(() => sharedCopies(page)).toBe(0);
  await page.getByRole('button', { name: 'Save locally' }).click();
  await expect(page.locator('.toast')).toContainText('Saved locally');
  await expect(page.locator('.item-title', { hasText: 'Mess timings' })).toBeVisible();

  await share(page, {
    title: 'Library notice',
    text: 'Extended hours this week',
    url: 'https://example.org/notice',
  });
  await expect(page).toHaveURL(/#\/add$/);
  await expect(page.getByRole('tab', { name: 'Webpage', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByPlaceholder('https://…')).toHaveValue('https://example.org/notice');
  await expect(page.getByRole('textbox', { name: 'Saved page text' })).toHaveValue(
    'Extended hours this week',
  );
});
