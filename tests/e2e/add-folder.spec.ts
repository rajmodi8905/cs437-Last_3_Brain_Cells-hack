// Adding a whole folder (issue #51): picking or dropping a folder of mixed files saves every
// supported file and lists the skipped ones with the reason.
import { test, expect, type Page } from '@playwright/test';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jJXQAAAAASUVORK5CYII=',
  'base64',
);
async function enter(page: Page) {
  await page.goto('/#/library');
  await page.getByRole('button', { name: 'Open my library' }).click();
}

test('[S1] choosing a folder saves its supported files and lists the skipped ones', async ({
  page,
}, testInfo) => {
  const root = testInfo.outputPath('Sem5');
  await mkdir(join(root, 'CS437'), { recursive: true });
  await writeFile(join(root, 'board.png'), PNG);
  await writeFile(join(root, 'CS437', 'slide.png'), PNG);
  await copyFile('tests/fixtures/sample-03.pdf', join(root, 'CS437', 'notes.pdf'));
  await writeFile(join(root, 'report.docx'), 'not really a document');
  await writeFile(join(root, '.DS_Store'), 'finder data');
  await enter(page);
  await page.goto('/#/add');
  await page.getByLabel('Choose a folder to save').setInputFiles(root);
  const summary = page.locator('.folder-summary');
  await expect(summary).toContainText('From “Sem5”: 3 files ready to save, 2 skipped.');
  await summary.getByText('Show skipped').click();
  const skipped = page.getByRole('list', { name: 'Skipped files' });
  await expect(skipped).toContainText('“report.docx” is a DOCX file.');
  await expect(skipped).toContainText('“.DS_Store” is a hidden or system file.');
  await expect(
    page.getByRole('list', { name: 'Selected files' }).getByRole('listitem'),
  ).toHaveCount(3);
  await page.getByRole('button', { name: 'Save locally' }).click();
  await expect(page.getByRole('status').first()).toContainText('3 items saved locally');
  await expect(page.getByRole('alert')).toContainText('2 file(s) from the folder were skipped.');
  for (const title of ['board', 'slide', 'notes'])
    await expect(page.getByText(title, { exact: true })).toBeVisible();
});

test('[S1] dropping a folder adds the supported files inside it', async ({ page }) => {
  await enter(page);
  await page.goto('/#/add');
  const dropzone = page.getByRole('button', { name: /Choose files or drop them here/ });
  // A real folder cannot be dragged in from the test, so the drop carries the same directory
  // entries the browser would: a folder whose reader returns its contents in two batches.
  await dropzone.evaluate((target, png) => {
    const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
    const fileEntry = (file: File) => ({
      name: file.name,
      isFile: true,
      isDirectory: false,
      file: (done: (f: File) => void) => done(file),
    });
    const folder = (name: string, batches: unknown[][]) => ({
      name,
      isFile: false,
      isDirectory: true,
      createReader: () => {
        const pending = [...batches];
        return { readEntries: (done: (e: unknown[]) => void) => done(pending.shift() ?? []) };
      },
    });
    const tree = folder('Screenshots', [
      [fileEntry(new File([bytes], 'week1.png', { type: 'image/png' }))],
      [
        folder('Later', [[fileEntry(new File([bytes], 'week9.png', { type: 'image/png' }))]]),
        fileEntry(new File(['x'], 'Thumbs.db')),
      ],
    ]);
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', {
      value: { files: [], items: [{ webkitGetAsEntry: () => tree }] },
    });
    target.dispatchEvent(drop);
  }, PNG.toString('base64'));
  await expect(page.locator('.folder-summary')).toContainText(
    'From “Screenshots”: 2 files ready to save, 1 skipped.',
  );
  await expect(page.getByRole('list', { name: 'Selected files' }).getByRole('listitem')).toHaveText(
    [/week1\.png/, /week9\.png/],
  );
});
