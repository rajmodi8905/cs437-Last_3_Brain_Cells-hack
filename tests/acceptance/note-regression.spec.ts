import { test, expect } from '@playwright/test';
import { prepare } from './helpers';
test.use({ trace: 'off' });
test('consumed R4 regression: conversational note retrieval with a derived display title', async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  await prepare(page, context);
  const result = await page.evaluate(async () => {
    const h = (window as any).harness;
    const r = new h.DexieLibraryRepository(new h.CampusRecallDatabase('r4-regression'));
    await r.open();
    const engine = new h.LocalEngine(r);
    await engine.initialize();
    const item = await r.save({
      kind: 'note',
      text: 'Meet the mentor at the north library entrance on Tuesday afternoon.',
    });
    await engine.indexItem(item.id);
    await h.waitForItem(r, item.id);
    const matches = await engine.search('Where is our adviser appointment?');
    const segments = await r.listSearchableSegments(h.INDEX_VERSION);
    const query = await engine.models.query('Where is our adviser appointment?');
    const raw = [h.cosine(query, segments[0].vector)];
    await engine.dispose();
    return { expected: item.id, matches, raw };
  });
  console.log('R4 REGRESSION', JSON.stringify(result));
  expect(result.matches.some((r: any) => r.itemId === result.expected)).toBe(true);
});
