// S16 with a real model: a student adds their own model (a pinned public model served from the
// local mirror, as Hugging Face would serve it), the app pins and verifies its files, calibrates
// it on this device, switches to it, and indexes the frozen corpus offline with only its vectors.
// A custom model makes no S9 promise, so retrieval ranks are recorded, not asserted.
import { test, expect } from '@playwright/test';
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { mirrorSetupAsset } from './helpers';
test.use({ trace: 'off' });

test("[S16] a student's own model is pinned, verified, calibrated and used offline with only its vectors", async ({
  page,
  context,
}) => {
  test.setTimeout(900000);
  const manifest = JSON.parse(await readFile('public/asset-manifest.json', 'utf8'));
  const byo = JSON.parse(await readFile('tests/fixtures/byo-model.json', 'utf8'));
  const source = JSON.parse(await readFile('tests/fixtures/corpus.json', 'utf8'));
  for (const file of [
    ...manifest.assets.filter((a: any) => a.url.startsWith('https:')),
    ...byo.files,
  ])
    try {
      await access(path.resolve('.models', file.sha256));
    } catch {
      throw Error('Acceptance assets missing. Run npm run models:download first.');
    }
  let online = true;
  const fetched: string[] = [];
  const external: string[] = [];
  const listing = `https://huggingface.co/api/models/${byo.repo}/revision/main?blobs=true`;
  await context.route(/^https:\/\//, async (route) => {
    const url = route.request().url();
    const pinned =
      byo.files.find((file: any) => file.url === url) ??
      manifest.assets.find((asset: any) => asset.url === url);
    if (online && url === listing) {
      fetched.push(url);
      await route.fulfill({ json: byo.listing, headers: { 'access-control-allow-origin': '*' } });
    } else if (online && pinned) {
      fetched.push(url);
      await mirrorSetupAsset(route, pinned.sha256, page);
    } else {
      external.push(url);
      await route.abort();
    }
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('BROWSER:', msg.text());
  });
  await page.goto('http://127.0.0.1:4173/tests/harness.html');
  await page.waitForFunction(
    () => !!(window as any).harness && !!navigator.serviceWorker.controller,
  );
  // Online: the student adds their model; it is pinned, downloaded, verified and calibrated.
  const added = await page.evaluate(async (repo) => {
    localStorage.clear();
    const h = (window as any).harness;
    const repository = new h.DexieLibraryRepository(
      new h.CampusRecallDatabase(`s16-${crypto.randomUUID()}`),
    );
    await repository.open();
    const engine = new h.LocalEngine(repository);
    await engine.initialize();
    const model = await engine.addCustomModel(repo, {
      pooling: 'mean',
      queryPrefix: 'Represent this sentence for searching relevant passages: ',
      documentPrefix: '',
    });
    const before = engine.searchModel.indexVersion;
    await engine.setSearchModel(model);
    (window as any).s16 = { repository, engine };
    return { model, before, after: engine.searchModel.indexVersion, ready: engine.ready };
  }, byo.repo);
  online = false;

  // Offline: index the frozen corpus with the student's model and search it.
  const report = await page.evaluate(
    async (corpus) => {
      const { repository, engine } = (window as any).s16;
      const h = (window as any).harness;
      const mime: Record<string, string> = {
        png: 'image/png',
        jpg: 'image/jpeg',
        pdf: 'application/pdf',
        mp3: 'audio/mpeg',
        m4a: 'audio/mp4',
        mp4: 'video/mp4',
      };
      const ids: Record<string, string> = {};
      const outcome: Record<string, { status: string; error?: string }> = {};
      for (const [index, record] of corpus.records.entries()) {
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
        const id = record.id ?? `D${index}`;
        ids[id] = item.id;
        await engine.indexItem(item.id);
        await h.waitForItem(repository, item.id);
        const stored = await repository.getItem(item.id);
        outcome[id] = { status: stored.status, error: stored.error?.message };
      }
      const searches = [];
      for (const record of corpus.targets) {
        const results = await engine.search(record.query);
        searches.push({
          id: record.id,
          rank: results.findIndex((r: any) => r.itemId === ids[record.id]) + 1,
          count: results.length,
        });
      }
      const negatives = [];
      for (const query of corpus.negatives) negatives.push((await engine.search(query)).length);
      const own = await repository.listSearchableSegments(engine.searchModel.indexVersion);
      const gemma = await repository.listSearchableSegments(h.INDEX_VERSION);
      const result = {
        outcome,
        searches,
        negatives,
        dimensions: [...new Set(own.map((s: any) => s.vector.length))],
        modalities: [...new Set(own.map((s: any) => s.modality))],
        gemmaSegments: gemma.length,
      };
      await engine.dispose();
      return result;
    },
    {
      targets: source.targets,
      records: [...source.targets, ...source.distractors],
      negatives: source.negatives,
    },
  );
  await writeFile('test-results/byo-model-S16.json', JSON.stringify({ added, report }, null, 2));
  console.log(
    'S16 BYO',
    JSON.stringify({
      calibration: added.model.custom.calibration,
      threshold: added.model.custom.threshold,
      ranks: report.searches,
      negatives: report.negatives,
    }),
  );

  // Pinned at the exact revision, with every file's SHA-256, and only those files fetched.
  expect(added.model.custom.revision).toBe(byo.revision);
  expect(
    added.model.custom.files.map((f: any) => ({ name: f.name, sha256: f.sha256, bytes: f.bytes })),
  ).toEqual(byo.files.map((f: any) => ({ name: f.name, sha256: f.sha256, bytes: f.bytes })));
  const gemmaFiles = manifest.assets
    .filter((asset: any) => asset.group === 'embeddings')
    .map((asset: any) => asset.url);
  expect(fetched.filter((url) => gemmaFiles.includes(url))).toEqual([]);
  for (const file of byo.files) expect(fetched).toContain(file.url);
  expect(external).toEqual([]);
  // Calibrated on this device with the shared grid rule, and only then switched to.
  expect(added.model.custom.calibration.total).toBe(8);
  expect(added.model.custom.calibration.correct).toBeGreaterThanOrEqual(6);
  expect(added.model.custom.calibration.unrelatedTotal).toBe(8);
  expect(added.model.custom.calibration.unrelatedMatched).toBeLessThanOrEqual(4);
  expect(added.model.experimental).toBe(true);
  expect(added.after).toBe(added.model.indexVersion);
  expect(added.after).not.toBe(added.before);
  expect(added.ready).toBe(true);
  // Text items are indexed with the student's model only; pictures without text are explained.
  for (const id of ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R9', 'R10', 'R11'])
    expect(report.outcome[id]!.status, id).toBe('ready');
  for (const [id, entry] of Object.entries(report.outcome))
    if (entry.status === 'failed')
      expect(entry.error, id).toMatch(/cannot search what is in a picture or video/);
  expect(report.dimensions).toEqual([added.model.dimension]);
  expect(report.modalities).toEqual(['text']);
  expect(report.gemmaSegments).toBe(0);
});
