import { test, expect } from '@playwright/test';
import { CAMPUS_PACK_NOTES } from '../../src/app/campusPack';
import { prepare } from './helpers';
// S17 with the real pinned models: the campus pack notes are indexed offline like any note,
// and everyday campus questions find their note among the top three results.
test.use({ trace: 'off' });
const QUESTIONS = [
  { key: 'exams', query: 'which hall is my exam in' },
  { key: 'health', query: 'number to call for a medical emergency' },
  { key: 'hostels', query: 'where is the hostel office' },
  { key: 'calendar', query: 'when do classes start next semester' },
  { key: 'mess', query: 'what is on the mess menu' },
  { key: 'library', query: 'what time does the library close' },
];
test('[S17] campus questions find their pack notes with the real search model', async ({
  page,
  context,
}) => {
  test.setTimeout(600000);
  const { external } = await prepare(page, context);
  const report = await page.evaluate(
    async ({ notes, questions }) => {
      const h = (window as any).harness;
      const repository = new h.DexieLibraryRepository(
        new h.CampusRecallDatabase(`campus-pack-${crypto.randomUUID()}`),
      );
      await repository.open();
      const engine = new h.LocalEngine(repository);
      await engine.initialize();
      const ids: Record<string, string> = {};
      for (const note of notes) {
        const item = await repository.save({ kind: 'note', title: note.title, text: note.text });
        ids[note.key] = item.id;
        await engine.indexItem(item.id);
        const settled = await h.waitForItem(repository, item.id);
        if (settled?.status !== 'ready') throw Error(`${note.key} did not become Ready.`);
      }
      const found: Record<string, string[]> = {};
      for (const { key, query } of questions)
        found[key] = (await engine.search(query)).map((r: any) => r.itemId);
      await engine.dispose();
      return { ids, found };
    },
    { notes: CAMPUS_PACK_NOTES, questions: QUESTIONS },
  );
  console.log('S17 CAMPUS PACK', JSON.stringify(report));
  for (const { key, query } of QUESTIONS)
    expect(report.found[key].slice(0, 3), `${query} -> ${key}`).toContain(report.ids[key]);
  expect(external).toEqual([]);
});
