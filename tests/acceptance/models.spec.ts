import { test, expect } from '@playwright/test';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { mirrorSetupAsset } from './helpers';
test.use({ trace: 'off' });
test('pinned local text and vision pipeline loads, embeds, searches and rejects unrelated query', async ({
  page,
  context,
}) => {
  test.setTimeout(600000);
  const manifest = JSON.parse(await readFile('public/asset-manifest.json', 'utf8'));
  for (const a of manifest.assets.filter((a: any) => a.url.startsWith('https:')))
    try {
      await access(path.resolve('.models', a.sha256));
    } catch {
      throw Error('Acceptance assets missing. Run npm run models:download first.');
    }
  await context.route(/^https:\/\//, async (route) => {
    const a = manifest.assets.find((a: any) => a.url === route.request().url());
    if (!a) throw Error(`Unexpected external request: ${route.request().url()}`);
    await mirrorSetupAsset(route, a.sha256, page);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'log') console.log('BROWSER:', msg.text());
  });
  page.on('pageerror', (error) => console.log('PAGE:', error.message));
  await page.goto('http://127.0.0.1:4173/tests/harness.html');
  await page.waitForFunction(
    () => !!(window as any).harness && !!navigator.serviceWorker.controller,
  );
  const value = await page.evaluate(async () => {
    const h = (window as any).harness;
    await h.setupAssets(await h.getManifest(), (event: any) => {
      if (event.loadedBytes === event.totalBytes) console.log('ASSETS VERIFIED');
    });
    const repository = new h.DexieLibraryRepository(new h.CampusRecallDatabase('acceptance-text'));
    await repository.database.delete();
    await repository.open();
    const engine = new h.LocalEngine(repository);
    engine.subscribeProgress((event: any) => console.log(event.stage, event.message));
    await engine.initialize();
    const item = await repository.save({
      kind: 'note',
      title: 'Synthetic CS437 project guide',
      text: 'CS437 project groups may contain a maximum of three students. Submit the project report by 5 November at 6 PM.',
    });
    await engine.indexItem(item.id);
    await h.waitForItem(repository, item.id);
    const stored = await repository.getItem(item.id);
    if (stored.status !== 'ready') throw Error(JSON.stringify(stored));
    const positive = await engine.search(
      'How many people can work together on the course project?',
    );
    const negative = await engine.search('Which intercontinental airlines serve Reykjavik?');
    const segments = await repository.listSearchableSegments(h.INDEX_VERSION);
    const report = {
      positive,
      negative,
      dimensions: segments[0]?.vector.length,
      device: engine.models.device,
    };
    await engine.dispose();
    return report;
  });
  console.log('ACTUAL MODEL REPORT', JSON.stringify(value));
  expect(value.dimensions).toBe(768);
  expect(value.positive).toHaveLength(1);
  expect(value.negative).toEqual([]);
});
