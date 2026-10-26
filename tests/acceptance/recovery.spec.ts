import { test, expect } from '@playwright/test';
import { prepare } from './helpers';
test.use({ trace: 'off' });
test('[S12] interrupt real indexing, retain the source and retry one current generation offline', async ({
  page,
  context,
}) => {
  test.setTimeout(240000);
  const { external } = await prepare(page, context);
  await context.setOffline(true);
  const report = await page.evaluate(async () => {
    const h = (window as any).harness;
    const repository = new h.DexieLibraryRepository(
      new h.CampusRecallDatabase(`retry-${crypto.randomUUID()}`),
    );
    await repository.open();
    const source =
      'Synthetic source: the chemistry laboratory orientation starts on Thursday morning.';
    const item = await repository.save({ kind: 'note', text: source });
    const first = new h.LocalEngine(repository);
    let started: () => void = () => {};
    const indexing = new Promise<void>((resolve) => {
      started = resolve;
    });
    first.subscribeProgress((event: any) => {
      if (event.itemId === item.id && event.stage === 'embedding') started();
    });
    await first.initialize();
    await first.indexItem(item.id);
    await indexing;
    await first.dispose();
    const stopped = await h.waitForItem(repository, item.id);
    const retained = await (await repository.getOriginal(item.id)).text();
    const beforeRetry = await repository.database.segments.where('itemId').equals(item.id).count();
    const next = new h.LocalEngine(repository);
    await next.initialize();
    await next.indexItem(item.id);
    const completed = await h.waitForItem(repository, item.id);
    const segments = await repository.listSearchableSegments(h.INDEX_VERSION);
    const result = {
      stopped: stopped.status,
      retained,
      source,
      beforeRetry,
      ready: completed.status,
      ids: segments.map((s: any) => s.id),
      parents: segments.map((s: any) => s.itemId),
      expectedId: item.id,
      generation: completed.processingGeneration,
      jobs: await repository.database.jobs.count(),
    };
    await next.dispose();
    return result;
  });
  expect(report.stopped).toBe('failed');
  expect(report.retained).toBe(report.source);
  expect(report.beforeRetry).toBe(0);
  expect(report.ready).toBe('ready');
  expect(report.ids).toHaveLength(1);
  expect(report.parents).toEqual([report.expectedId]);
  expect(report.jobs).toBe(0);
  expect(external).toEqual([]);
});
