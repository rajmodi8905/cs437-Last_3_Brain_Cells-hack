import { crc32, deflateSync } from 'node:zlib';
import { test, expect, type Page } from '@playwright/test';
// Production build: files picked twice add up and can be removed, a file that cannot be saved
// is explained as soon as it is picked and skipped while the others save, pasting an image or
// text on Add fills the form, an empty search says what to type, Escape closes only a dialog
// over the viewer, and Settings uses plain words with a switch for recent searches.

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
const selected = (page: Page) => page.getByRole('list', { name: 'Selected files' });

test('files picked twice add up, can be removed, and a file that cannot be saved is explained before saving', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await enter(page);
  await page.goto('/#/add');
  const picker = page.getByLabel('Choose files to save');
  await picker.setInputFiles({ name: 'poster.png', mimeType: 'image/png', buffer: png(120) });
  await picker.setInputFiles([
    { name: 'timetable.png', mimeType: 'image/png', buffer: png(140) },
    { name: 'lecture.mov', mimeType: 'video/quicktime', buffer: Buffer.from('not a video') },
  ]);
  await expect(page.getByText('3 files selected')).toBeVisible();
  await expect(selected(page).locator('.file-name')).toHaveText([
    'poster.png',
    'timetable.png',
    'lecture.mov',
  ]);
  await expect(selected(page)).toContainText(
    '“lecture.mov” is a MOV video. Convert it to MP4 to save it.',
  );
  const remove = page.getByRole('button', { name: 'Remove timetable.png' });
  const box = (await remove.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  await remove.click();
  await expect(selected(page).locator('.file-name')).toHaveText(['poster.png', 'lecture.mov']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Save locally' }).click();
  await expect(page.locator('.toast')).toContainText('Saved locally');
  await expect(page.getByRole('alert')).toContainText('“lecture.mov” is a MOV video.');
  await expect(page.locator('.item-title', { hasText: 'poster' })).toBeVisible();
  await expect(page.locator('.item-row')).toHaveCount(1);
});

test('pasting an image or text on Add fills the form, but never a paste into a field', async ({
  page,
}) => {
  await enter(page);
  await page.goto('/#/add');
  const paste = (data: { text?: string; image?: number[] }) =>
    page.evaluate(({ text, image }) => {
      const transfer = new DataTransfer();
      if (image)
        transfer.items.add(new File([new Uint8Array(image)], 'image.png', { type: 'image/png' }));
      if (text) transfer.setData('text/plain', text);
      const target = document.activeElement ?? document.body;
      target.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
    }, data);
  await page.locator('h1').click();
  await paste({ image: [...png(60)] });
  await expect(selected(page).locator('.file-name')).toHaveText(['image.png']);
  await page.getByRole('textbox', { name: 'Title' }).focus();
  await paste({ text: 'Lab 4 is due on Friday.' });
  await expect(page.getByRole('tab', { name: 'Files' })).toHaveAttribute('aria-selected', 'true');
  await page.locator('h1').click();
  await paste({ text: 'Lab 4 is due on Friday.' });
  await expect(page.getByRole('tab', { name: 'Note' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('textbox', { name: 'Note', exact: true })).toHaveValue(
    'Lab 4 is due on Friday.',
  );
  await page.getByRole('button', { name: 'Save locally' }).click();
  await expect(page.locator('.toast')).toContainText('Saved locally');
});

test('an empty search says what to type and keeps focus in the box', async ({ page }) => {
  await enter(page);
  const search = page.getByRole('textbox', { name: 'Search saved information' });
  await search.focus();
  await search.press('Enter');
  await expect(page.getByText('Type what you remember, then search.')).toBeVisible();
  await expect(search).toBeFocused();
  await expect(page).toHaveURL(/#\/library$/);
  await search.fill('mess');
  await expect(page.getByText('Type what you remember, then search.')).toHaveCount(0);
});

test('Escape closes a dialog over the viewer and leaves the viewer open', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await enter(page);
  await page.goto('/#/add');
  await page.getByRole('tab', { name: 'Note', exact: true }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill('Mess timings');
  await page.getByRole('textbox', { name: 'Note', exact: true }).fill('Dinner is at 7:30 pm.');
  await page.getByRole('button', { name: 'Save locally' }).click();
  await expect(page.locator('.toast')).toContainText('Saved locally');
  await page.getByRole('button', { name: /^Mess timings Notes/ }).click();
  const viewer = page.locator('.preview-panel');
  await expect(viewer).toBeVisible();
  for (const name of ['Rename', 'Delete']) {
    await page.getByRole('button', { name: 'Actions for Mess timings' }).click();
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(viewer).toBeVisible();
  }
  await page.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);
});

test('Settings uses plain words and has a switch for recent searches', async ({ page }) => {
  await enter(page);
  await page.goto('/#/add');
  await page.getByRole('tab', { name: 'Note', exact: true }).click();
  await page.getByRole('textbox', { name: 'Note', exact: true }).fill('One saved note.');
  await page.getByRole('button', { name: 'Save locally' }).click();
  await expect(page.locator('.toast')).toContainText('Saved locally');
  await page.goto('/#/settings');
  await expect(page.getByText(/of saved originals · 1 item$/)).toBeVisible();
  await expect(page.getByText(/^This browser is using .+ it allows for this site/)).toBeVisible();
  const main = page.locator('main');
  await expect(main).not.toContainText('quota');
  await expect(main).not.toContainText('HTTPS or localhost');
  const remember = page.getByRole('switch', { name: 'Remember recent searches' });
  await expect(remember).toBeChecked();
  await remember.click();
  await expect(remember).not.toBeChecked();
  await expect(page.locator('.toast')).toContainText(
    'Recent searches are off and cleared from this device.',
  );
  await page.reload();
  await expect(page.getByRole('switch', { name: 'Remember recent searches' })).not.toBeChecked();
  await page.goto('/');
  await expect(page.locator('body')).not.toContainText('HTTPS or localhost');
});
