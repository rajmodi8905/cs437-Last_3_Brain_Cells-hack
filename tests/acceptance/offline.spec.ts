import { test, expect } from '@playwright/test';
import { prepare } from './helpers';
test.use({ trace: 'off' });
test('production processing, semantic search and source viewing remain local offline', async ({
  page,
  context,
}) => {
  test.setTimeout(900000);
  const { external } = await prepare(page, context);
  await page.evaluate(async () => {
    const files = [
      'sample-01.jpg',
      'sample-03.pdf',
      'sample-10.m4a',
      'sample-11.mp4',
      'sample-12.mp4',
    ];
    (window as any).uploads = [];
    for (const name of files) {
      const blob = await (await fetch(`/tests/fixtures/${name}`)).blob();
      (window as any).uploads.push({ name, blob });
    }
  });
  await context.setOffline(true);
  const report = await page.evaluate(async () => {
    const h = (window as any).harness;
    const repository = new h.DexieLibraryRepository(new h.CampusRecallDatabase());
    await repository.open();
    await repository.database.settings.put({ key: 'intro-seen', value: true });
    const engine = new h.LocalEngine(repository);
    await engine.initialize();
    const ids = [];
    const failures = [];
    const mime: Record<string, string> = {
      jpg: 'image/jpeg',
      pdf: 'application/pdf',
      m4a: 'audio/mp4',
      mp4: 'video/mp4',
    };
    for (const upload of (window as any).uploads) {
      const item = await repository.save({
        kind: 'file',
        file: new File([upload.blob], upload.name, { type: mime[upload.name.split('.').at(-1)] }),
      });
      ids.push(item.id);
      await engine.indexItem(item.id);
      await h.waitForItem(repository, item.id);
      const current = await repository.getItem(item.id);
      if (current.status !== 'ready') failures.push(current.error);
    }
    for (const input of [
      {
        kind: 'note',
        title: 'Private note',
        text: 'Private sentinel CR_LOCAL_ONLY_437. Save the seminar seating plan beside the noticeboard.',
      },
      {
        kind: 'webpage',
        title: 'Private snapshot',
        url: 'https://example.test/never-request-this',
        text: 'Private sentinel CR_SNAPSHOT_437. A saved text snapshot needs no website request.',
      },
    ]) {
      const item = await repository.save(input);
      ids.push(item.id);
      await engine.indexItem(item.id);
      await h.waitForItem(repository, item.id);
    }
    const matches = await engine.search('Find the badminton team registration announcement');
    await engine.dispose();
    return { failures, ids, matches };
  });
  expect(external).toEqual([]);
  expect(report.failures).toEqual([]);
  expect(report.matches.some((m: any) => m.itemId === report.ids[0])).toBe(true);
  await page.goto('http://127.0.0.1:4173/#/library');
  await expect(page.getByText('sample-01', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /sample-01 Images/ }).click();
  await expect(page.locator('.original-image')).toBeVisible();
  await page.getByRole('button', { name: 'Close original' }).click();
  const search = page.getByRole('textbox', { name: 'Search saved information' });
  await search.fill('How many classmates can work together for CS437?');
  await search.press('Enter');
  await page.getByRole('button', { name: /^sample-03/ }).click();
  await expect(page.getByRole('spinbutton', { name: 'PDF page' })).toHaveValue('2');
  await page.getByRole('button', { name: 'Close original' }).click();
  await search.fill('Where was the recording about collecting the lab access card?');
  await search.press('Enter');
  await page.getByRole('button', { name: /^sample-10/ }).click();
  await expect(page.locator('audio')).toBeVisible();
  await expect
    .poll(() => page.locator('audio').evaluate((a: HTMLAudioElement) => a.currentTime))
    .toBeGreaterThan(1);
  await page.getByRole('button', { name: 'Close original' }).click();
  await page.goto('http://127.0.0.1:4173/#/privacy');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Privacy Policy', exact: true })).toBeVisible();
  // Evicted model assets must not trigger automatic remote repair during private use.
  await page.evaluate(async () => {
    const cache = await caches.open('campus-recall-assets-v1');
    const key = (await cache.keys()).find((k) => k.url.endsWith('/onnx/model_q4.onnx_data'));
    if (key) await cache.delete(key);
  });
  await page.goto('http://127.0.0.1:4173/#/settings');
  await page.reload();
  await expect(page.getByText('Setup needed', { exact: true })).toBeVisible();
  expect(external).toEqual([]);
});
