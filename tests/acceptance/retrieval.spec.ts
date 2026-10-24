import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { prepare } from './helpers';
test.use({ trace: 'off' });
for (const scenario of [
  { id: 'S9', targets: ['R1', 'R2', 'R3', 'R4', 'R5', 'R6'] },
  { id: 'S10', targets: ['R7', 'R8', 'R12'] },
  { id: 'S11', targets: ['R9', 'R10', 'R11'] },
]) {
  test(`${scenario.id}: fresh 30-item corpus retrieves its required originals`, async ({
    page,
    context,
  }) => {
    test.setTimeout(900000);
    const source = JSON.parse(await readFile('tests/fixtures/corpus.json', 'utf8'));
    const corpus = {
      ...source,
      targets: source.targets.filter((record: any) => scenario.targets.includes(record.id)),
      records: [...source.targets, ...source.distractors],
    };
    for (const entry of corpus.records)
      if (entry.file)
        expect(
          createHash('sha256')
            .update(await readFile(`tests/fixtures/${entry.file}`))
            .digest('hex'),
        ).toBe(entry.sha256);
    const { external } = await prepare(page, context);
    const report = await page.evaluate(async (corpus) => {
      const h = (window as any).harness;
      const repository = new h.DexieLibraryRepository(
        new h.CampusRecallDatabase(`heldout-${crypto.randomUUID()}`),
      );
      await repository.open();
      const engine = new h.LocalEngine(repository);
      await engine.initialize();
      const ids: Record<string, string> = {};
      const timings: Record<string, number> = {};
      const failures: any[] = [];
      const mime: Record<string, string> = {
        png: 'image/png',
        jpg: 'image/jpeg',
        pdf: 'application/pdf',
        mp3: 'audio/mpeg',
        m4a: 'audio/mp4',
        mp4: 'video/mp4',
      };
      for (const record of corpus.records) {
        let input;
        if (record.file) {
          const blob = await (await fetch(`/tests/fixtures/${record.file}`)).blob();
          input = {
            kind: 'file',
            file: new File([blob], record.file, { type: mime[record.file.split('.').at(-1)] }),
          };
        } else
          input =
            record.kind === 'webpage'
              ? { kind: 'webpage', url: record.url, text: record.text }
              : { kind: 'note', text: record.text };
        const item = await repository.save(input);
        ids[record.id] = item.id;
        const start = performance.now();
        await engine.indexItem(item.id);
        await h.waitForItem(repository, item.id);
        timings[record.id] = Math.round(performance.now() - start);
        const stored = await repository.getItem(item.id);
        if (stored.status !== 'ready') failures.push({ id: record.id, error: stored.error });
        console.log('INDEXED', record.id, stored.status, timings[record.id]);
      }
      const positives = [];
      for (const record of corpus.targets) {
        const start = performance.now();
        const results = await engine.search(record.query);
        positives.push({
          id: record.id,
          query: record.query,
          expectedItemId: ids[record.id],
          results,
          elapsedMs: Math.round(performance.now() - start),
        });
      }
      const negatives = [];
      for (const query of corpus.negatives)
        negatives.push({ query, results: await engine.search(query) });
      const segments = await repository.listSearchableSegments(h.INDEX_VERSION);
      const result = {
        count: (await repository.listItems()).length,
        ids,
        timings,
        failures,
        positives,
        negatives,
        device: engine.models.device,
        indexVersion: h.INDEX_VERSION,
        dimensions: [...new Set(segments.map((s: any) => s.vector.length))],
      };
      await engine.dispose();
      return result;
    }, corpus);
    await writeFile(`test-results/retrieval-${scenario.id}.json`, JSON.stringify(report, null, 2));
    console.log(
      'RETRIEVAL SUMMARY',
      JSON.stringify({
        count: report.count,
        failures: report.failures,
        ranks: report.positives.map((p) => ({
          id: p.id,
          rank: p.results.findIndex((r: any) => r.itemId === p.expectedItemId) + 1,
        })),
        negatives: report.negatives.map((n) => n.results.length),
      }),
    );
    expect(external).toEqual([]);
    expect(report.count).toBe(30);
    expect(report.failures).toEqual([]);
    expect(report.dimensions).toEqual([768]);
    for (const result of report.positives) {
      const expected = corpus.targets.find((r: any) => r.id === result.id);
      const match = result.results.slice(0, 3).find((r: any) => r.itemId === result.expectedItemId);
      expect(match, `${result.id}: expected original in top three`).toBeDefined();
      if (!match) continue;
      if (expected.page) expect(match.location).toEqual({ kind: 'page', page: expected.page });
      if (expected.visual) expect(match.matchKind).toBe('visual');
      if (expected.interval) {
        expect(match.location.kind).toBe('time');
        if (match.location.kind === 'time') {
          expect(match.location.startMs).toBeGreaterThanOrEqual(expected.interval[0] * 1000 - 2000);
          expect(match.location.startMs).toBeLessThanOrEqual(expected.interval[1] * 1000 + 2000);
        }
      }
      expect(new Set(result.results.map((r: any) => r.itemId)).size).toBe(result.results.length);
      expect(result.results.length).toBeLessThanOrEqual(5);
    }
    for (const result of report.negatives)
      expect(result.results, `negative: ${result.query}`).toEqual([]);
  });
}
