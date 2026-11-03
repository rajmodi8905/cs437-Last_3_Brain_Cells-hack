// Real-browser IndexedDB coverage for cross-tab storage, transfer and recovery (S1, S3, S6, S12).
// The production app (baseURL) drives restore through its interface; the test-only harness build
// exposes the same repository for claim, publication and fault-injection steps that the UI cannot
// time deterministically. Every check reads IndexedDB directly instead of trusting the repository.
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

const HARNESS = 'http://127.0.0.1:4173/tests/harness.html';
const APP_DB = 'campus-recall';

type ArchiveFiles = Record<string, Uint8Array>;
/** Re-zips an exported archive after editing its files and manifest in place. */
function rebuild(bytes: Buffer, edit: (files: ArchiveFiles, manifest: any) => void): Buffer {
  const files = unzipSync(new Uint8Array(bytes));
  const manifest = JSON.parse(strFromU8(files['manifest.json']!));
  edit(files, manifest);
  files['manifest.json'] = strToU8(JSON.stringify(manifest));
  return Buffer.from(zipSync(files));
}
/** Appends a valid, new note entry; a non-atomic import would leave it behind. */
function addNote(files: ArchiveFiles, manifest: any, title: string) {
  const id = randomUUID();
  const data = strToU8(`Synthetic restore entry: ${title}.`);
  files[`originals/${id}`] = data;
  manifest.items.push({
    id,
    kind: 'note',
    title,
    mimeType: 'text/plain;charset=utf-8',
    byteLength: data.length,
    contentSha256: createHash('sha256').update(data).digest('hex'),
    createdAt: Date.now(),
    originalPath: `originals/${id}`,
  });
  return id;
}
const zipFile = (buffer: Buffer, name = 'campus-recall-backup.zip') => ({
  name,
  mimeType: 'application/zip',
  buffer,
});

interface Snapshot {
  items: any[];
  originals: { id: string; itemId: string; mimeType: string; sha256: string; byteLength: number }[];
  segments: { id: string; itemId: string; indexVersion: string }[];
  jobs: any[];
  previews: { id: string; itemId: string }[];
}

/** Reads every store with the native IndexedDB API and hashes original bytes in the page. */
function snapshot(page: Page, database: string): Promise<Snapshot> {
  return page.evaluate(async (name) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const all = (store: string) =>
      new Promise<any[]>((resolve, reject) => {
        const request = db.transaction(store).objectStore(store).getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    const hex = async (data: ArrayBuffer) =>
      Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join('');
    const [items, originals, segments, jobs, previews] = await Promise.all(
      ['items', 'originals', 'segments', 'jobs', 'previews'].map(all),
    );
    const result = {
      items: items.sort((a, b) => a.title.localeCompare(b.title) || a.createdAt - b.createdAt),
      originals: await Promise.all(
        originals.map(async (o) => {
          const data = o.data instanceof Blob ? await o.data.arrayBuffer() : o.data;
          return {
            id: o.id,
            itemId: o.itemId,
            mimeType: o.mimeType,
            sha256: await hex(data),
            byteLength: data.byteLength,
          };
        }),
      ),
      segments: segments.map((s) => ({ id: s.id, itemId: s.itemId, indexVersion: s.indexVersion })),
      jobs,
      previews: previews.map((p) => ({ id: p.id, itemId: p.itemId })),
    };
    db.close();
    return result;
  }, database);
}

/** Every item owns exactly one original with matching hash/length, and nothing is orphaned. */
function expectConsistent(state: Snapshot) {
  const ids = new Set(state.items.map((item) => item.id));
  expect(state.originals).toHaveLength(state.items.length);
  for (const item of state.items) {
    const original = state.originals.find((o) => o.id === item.originalBlobId);
    expect(original, `original for ${item.title}`).toBeDefined();
    expect(original!.itemId).toBe(item.id);
    expect(original!.sha256).toBe(item.contentSha256);
    expect(original!.byteLength).toBe(item.byteLength);
  }
  for (const record of [...state.originals, ...state.segments, ...state.jobs, ...state.previews])
    expect(ids.has(record.itemId), `orphan record for ${record.itemId}`).toBe(true);
}

/** Opens the test-only harness and binds a repository to a named database in this tab. */
async function harnessTab(context: BrowserContext, database: string) {
  const page = await context.newPage();
  await page.goto(HARNESS);
  await page.waitForFunction(() => !!(window as any).harness);
  await page.evaluate(async (name) => {
    const h = (window as any).harness;
    const repository = new h.DexieLibraryRepository(new h.CampusRecallDatabase(name));
    await repository.open();
    (window as any).repository = repository;
  }, database);
  return page;
}

/** A valid 768-dimension unit-vector segment for the given item. */
const segmentFor = (page: Page, itemId: string) =>
  page.evaluate(
    (itemId) => ({
      id: crypto.randomUUID(),
      itemId,
      modality: 'text',
      text: 'Synthetic indexed text',
      location: { kind: 'whole' },
      indexVersion: (window as any).harness.INDEX_VERSION,
      vector: Array.from({ length: 768 }, () => 1 / Math.sqrt(768)),
    }),
    itemId,
  );

/** Publishes from inside a tab, converting the serializable vector back to Float32Array. */
const publish = (page: Page, claim: any, segment: any) =>
  page.evaluate(
    ({ claim, segment }) =>
      (window as any).repository.publishSegments(claim, [
        { ...segment, vector: new Float32Array(segment.vector) },
      ]),
    { claim, segment },
  );

async function enterApp(page: Page) {
  await page.goto('/#/library');
  await page.getByRole('button', { name: 'Open my library' }).click();
}

/** Builds a mixed six-kind library (with a same-bytes pair) in the harness and exports it. */
async function mixedArchive(context: BrowserContext) {
  const page = await harnessTab(context, `source-${crypto.randomUUID()}`);
  const exported = await page.evaluate(async () => {
    const repository = (window as any).repository;
    const fixture = async (name: string, type: string) =>
      new File([await (await fetch(`/tests/fixtures/${name}`)).arrayBuffer()], name, { type });
    const banner = await fixture('sample-01.jpg', 'image/jpeg');
    const inputs = [
      { kind: 'note', text: 'Synthetic transfer note: lab moves to room 204.', title: 'Lab note' },
      {
        kind: 'webpage',
        url: 'https://example.test/notices/transfer',
        text: 'Synthetic captured notice text.',
        title: 'Captured notice',
      },
      { kind: 'file', file: banner, title: 'Banner (club group)' },
      { kind: 'file', file: banner, title: 'Banner (hostel group)' },
      { kind: 'file', file: await fixture('sample-03.pdf', 'application/pdf') },
      { kind: 'file', file: await fixture('sample-09.mp3', 'audio/mpeg') },
      { kind: 'file', file: await fixture('sample-11.mp4', 'video/mp4') },
    ];
    const items = [];
    for (const input of inputs) items.push(await repository.save(input));
    const blob = await repository.exportItems(items.map((item: any) => item.id));
    return { items, bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) };
  });
  await page.close();
  const bytes = Buffer.from(exported.bytes);
  // Passed as an in-memory file: a just-written ZIP on disk can be locked by antivirus scanning.
  const file = { name: 'campus-recall-backup.zip', mimeType: 'application/zip', buffer: bytes };
  return { file, items: exported.items as any[], bytes };
}

const metadata = (item: any) => ({
  kind: item.kind,
  title: item.title,
  createdAt: item.createdAt,
  sourceUrl: item.sourceUrl,
  originalName: item.originalName,
  mimeType: item.mimeType,
  byteLength: item.byteLength,
  contentSha256: item.contentSha256,
});

test('[S6] two tabs in one profile restoring the same archive create each item once with exact bytes and metadata', async ({
  context,
  browser,
}) => {
  const archive = await mixedArchive(context);
  const profile = await browser.newContext();
  try {
    const [first, second] = [await profile.newPage(), await profile.newPage()];
    await enterApp(first);
    await second.goto('/#/settings');
    await first.goto('/#/settings');
    await Promise.all([
      first.getByLabel('Choose backup ZIP').setInputFiles(archive.file),
      second.getByLabel('Choose backup ZIP').setInputFiles(archive.file),
    ]);
    const reports = [];
    for (const tab of [first, second]) {
      await expect(tab.getByRole('status')).toContainText('Restored');
      const [, imported, skipped] = (await tab.getByRole('status').textContent())!.match(
        /Restored (\d+) items\. Skipped (\d+) duplicates\./,
      )!;
      reports.push([Number(imported), Number(skipped)]);
    }
    // IndexedDB serializes the two whole-archive transactions: one tab restores everything and
    // the other reports every entry as a duplicate of that tab's items.
    expect(reports.sort()).toEqual([
      [0, 7],
      [7, 0],
    ]);
    const state = await snapshot(first, APP_DB);
    expectConsistent(state);
    expect(state.items.map(metadata)).toEqual(
      [...archive.items]
        .sort((a, b) => a.title.localeCompare(b.title) || a.createdAt - b.createdAt)
        .map(metadata),
    );
    const sourceIds = new Set(archive.items.map((item) => item.id));
    for (const item of state.items) {
      expect(sourceIds.has(item.id)).toBe(false);
      expect(item.status).toBe('queued');
      expect(item.processingGeneration).toBe(0);
    }
    expect(state.jobs.map((job) => job.itemId).sort()).toEqual(
      state.items.map((item) => item.id).sort(),
    );
    expect(state.jobs.every((job) => job.generation === 0 && !job.claimId)).toBe(true);
    expect(state.segments).toEqual([]);
    await second.reload();
    await second.goto('/#/library');
    await expect(second.locator('.item-row')).toHaveCount(7);
  } finally {
    await profile.close();
  }
});

test('[S6] imports started at the same instant in two tabs still restore each archive entry once', async ({
  context,
}) => {
  const archive = await mixedArchive(context);
  const database = `simultaneous-${crypto.randomUUID()}`;
  const tabs = [await harnessTab(context, database), await harnessTab(context, database)];
  for (const tab of tabs)
    await tab.evaluate((bytes) => {
      (window as any).archive = new Blob([new Uint8Array(bytes)], { type: 'application/zip' });
    }, Array.from(archive.bytes));
  // Both tabs hash and validate in parallel, so their duplicate checks overlap in time.
  const start = Date.now() + 1000;
  const reports = await Promise.all(
    tabs.map((tab) =>
      tab.evaluate(async (start) => {
        await new Promise((resolve) => setTimeout(resolve, start - Date.now()));
        const report = await (window as any).repository.importArchive((window as any).archive);
        return [report.importedIds.length, report.skippedDuplicateIds.length];
      }, start),
    ),
  );
  expect(reports.sort()).toEqual([
    [0, 7],
    [7, 0],
  ]);
  const state = await snapshot(tabs[0], database);
  expectConsistent(state);
  expect(state.items.map(metadata)).toEqual(
    [...archive.items]
      .sort((a, b) => a.title.localeCompare(b.title) || a.createdAt - b.createdAt)
      .map(metadata),
  );
  expect(state.jobs).toHaveLength(7);
});

test('[S3] deleting in one tab while another tab holds a processing claim rejects the late publication', async ({
  context,
}) => {
  const database = `delete-claim-${crypto.randomUUID()}`;
  const holder = await harnessTab(context, database);
  const deleter = await harnessTab(context, database);
  const { victim, bystander, claim } = await holder.evaluate(async () => {
    const repository = (window as any).repository;
    const victim = await repository.save({ kind: 'note', text: 'Synthetic note to delete.' });
    const bystander = await repository.save({ kind: 'note', text: 'Synthetic note to keep.' });
    const claim = await repository.claimNextJob();
    return { victim, bystander, claim };
  });
  expect(claim.item.id).toBe(victim.id);
  expect((await snapshot(deleter, database)).items.find((i) => i.id === victim.id)?.status).toBe(
    'processing',
  );
  await deleter.evaluate((id) => (window as any).repository.deleteItem(id), victim.id);
  // The user saves the same text again before the old run finishes: a new item with new IDs.
  const resaved = await deleter.evaluate(() =>
    (window as any).repository.save({ kind: 'note', text: 'Synthetic note to delete.' }),
  );
  expect(resaved.id).not.toBe(victim.id);
  expect(await publish(holder, claim, await segmentFor(holder, victim.id))).toBe(false);
  expect(
    await holder.evaluate(
      (claim) =>
        (window as any).repository.failJob(claim, {
          code: 'EXTRACTION_FAILED',
          message: 'Late failure',
          retryable: true,
        }),
      claim,
    ),
  ).toBe(false);
  await holder.evaluate((id) => (window as any).repository.enqueueItem(id), victim.id);
  for (const page of [holder, deleter]) await page.close();
  const reopened = await harnessTab(context, database);
  const state = await snapshot(reopened, database);
  expectConsistent(state);
  const touchesVictim = (record: { itemId?: string; id?: string }) =>
    record.itemId === victim.id || record.id === victim.id;
  for (const store of [state.items, state.originals, state.segments, state.jobs, state.previews])
    expect(store.filter(touchesVictim)).toEqual([]);
  expect(state.originals.some((o) => o.id === victim.originalBlobId)).toBe(false);
  expect(state.items.map((item) => [item.id, item.status]).sort()).toEqual(
    [
      [bystander.id, 'queued'],
      [resaved.id, 'queued'],
    ].sort(),
  );
  expect(state.segments).toEqual([]);
  expect(state.jobs.map((job) => job.itemId).sort()).toEqual([bystander.id, resaved.id].sort());
});

test('[S12] reopening during processing recovers the claim under the processing lock and rejects the stale run', async ({
  context,
}) => {
  const database = `reopen-${crypto.randomUUID()}`;
  const worker = await harnessTab(context, database);
  const observer = await harnessTab(context, database);
  // The worker tab takes the engine's cross-tab lock and claims the job, like LocalEngine.drain.
  const { item, claim } = await worker.evaluate(async () => {
    const repository = (window as any).repository;
    const item = await repository.save({ kind: 'note', text: 'Synthetic interrupted note.' });
    return new Promise<any>((resolve) => {
      void navigator.locks.request('campus-recall-processor', async () => {
        resolve({ item, claim: await repository.claimNextJob() });
        await new Promise(() => {});
      });
    });
  });
  // While that tab is alive, another tab can neither take the lock nor reset the active claim.
  expect(
    await observer.evaluate(() =>
      navigator.locks.request('campus-recall-processor', { ifAvailable: true }, async (lock) => {
        if (!lock) return 'busy';
        await (window as any).repository.recoverInterruptedJobs();
        return 'recovered';
      }),
    ),
  ).toBe('busy');
  const during = await snapshot(observer, database);
  expect(during.items[0].status).toBe('processing');
  expect(during.jobs[0].claimId).toBe(claim.claimId);
  // Reload the worker tab mid-processing: the browser releases its lock and its in-memory run.
  await worker.reload();
  await worker.waitForFunction(() => !!(window as any).harness);
  const recovered = await observer.evaluate(() =>
    navigator.locks.request('campus-recall-processor', { ifAvailable: true }, async (lock) => {
      if (!lock) return undefined;
      const repository = (window as any).repository;
      await repository.recoverInterruptedJobs();
      return repository.claimNextJob();
    }),
  );
  expect(recovered.item.id).toBe(item.id);
  expect(recovered.generation).toBe(claim.generation);
  expect(recovered.claimId).not.toBe(claim.claimId);
  // A late response from the interrupted run is rejected before and after the retry publishes.
  expect(await publish(observer, claim, await segmentFor(observer, item.id))).toBe(false);
  const fresh = await segmentFor(observer, item.id);
  expect(await publish(observer, recovered, fresh)).toBe(true);
  expect(await publish(observer, claim, await segmentFor(observer, item.id))).toBe(false);
  const state = await snapshot(observer, database);
  expectConsistent(state);
  expect(state.items.map((i) => [i.id, i.status, i.processingGeneration])).toEqual([
    [item.id, 'ready', claim.generation],
  ]);
  expect(state.segments.map((s) => s.id)).toEqual([fresh.id]);
  expect(state.jobs).toEqual([]);
});

test('[S6] invalid archives restored through Settings change nothing in an existing library', async ({
  context,
  browser,
}) => {
  const archive = await mixedArchive(context);
  const cases: [string, Buffer][] = [
    [
      'hash mismatch in the last entry',
      rebuild(archive.bytes, (files, manifest) => {
        addNote(files, manifest, 'Valid entry before a corrupt one');
        const id = addNote(files, manifest, 'Corrupt entry');
        files[`originals/${id}`]![0]! ^= 1;
      }),
    ],
    [
      'missing original file',
      rebuild(archive.bytes, (files, manifest) => {
        addNote(files, manifest, 'Valid entry before a missing one');
        delete files[`originals/${addNote(files, manifest, 'Missing entry')}`];
      }),
    ],
    [
      'unsupported manifest version',
      rebuild(archive.bytes, (files, manifest) => {
        addNote(files, manifest, 'Valid entry in a future version');
        manifest.version = 2;
      }),
    ],
    [
      'file outside the originals namespace',
      rebuild(archive.bytes, (files, manifest) => {
        addNote(files, manifest, 'Valid entry beside an unexpected file');
        files['scripts/run.js'] = strToU8('alert(1)');
      }),
    ],
    [
      'repeated manifest ID',
      rebuild(archive.bytes, (files, manifest) => {
        addNote(files, manifest, 'Valid entry with a repeated ID');
        manifest.items.push({ ...manifest.items.at(-1) });
      }),
    ],
    [
      'unsafe source URL',
      rebuild(archive.bytes, (files, manifest) => {
        addNote(files, manifest, 'Valid entry before an unsafe URL');
        const webpage = manifest.items.find((item: any) => item.kind === 'webpage');
        webpage.sourceUrl = 'javascript:alert(1)';
      }),
    ],
    ['truncated ZIP', archive.bytes.subarray(0, Math.floor(archive.bytes.length / 2))],
  ];
  const profile = await browser.newContext();
  try {
    const page = await profile.newPage();
    await enterApp(page);
    await page.goto('/#/settings');
    await page.getByLabel('Choose backup ZIP').setInputFiles(archive.file);
    await expect(page.getByRole('status')).toContainText('Restored 7 items');
    const before = await snapshot(page, APP_DB);
    expectConsistent(before);
    for (const [label, bytes] of cases) {
      await page.getByLabel('Choose backup ZIP').setInputFiles(zipFile(bytes, `${label}.zip`));
      await expect(page.getByRole('alert'), label).toContainText('Archive');
      expect(await snapshot(page, APP_DB), label).toEqual(before);
      await page.getByRole('button', { name: 'Dismiss error' }).click();
      await expect(page.getByRole('alert')).toHaveCount(0);
    }
    await page.reload();
    expect(await snapshot(page, APP_DB)).toEqual(before);
  } finally {
    await profile.close();
  }
});

test('[S6] a storage failure part-way through a restore writes nothing and keeps existing items', async ({
  context,
}) => {
  const archive = await mixedArchive(context);
  const database = `forced-failure-${crypto.randomUUID()}`;
  const tab = await harnessTab(context, database);
  await tab.evaluate(() =>
    (window as any).repository.save({ kind: 'note', text: 'Existing synthetic note.' }),
  );
  const before = await snapshot(tab, database);
  // Test-only fault injection: the third original write inside the import transaction throws.
  const outcome = await tab.evaluate(async (bytes) => {
    const repository = (window as any).repository;
    let writes = 0;
    const failThird = () => {
      if (++writes === 3) throw Error('Simulated storage write failure');
    };
    repository.database.originals.hook('creating', failThird);
    try {
      await repository.importArchive(new Blob([new Uint8Array(bytes)]));
      return { rejected: false, writes };
    } catch (cause: any) {
      return { rejected: true, writes, message: String(cause?.message ?? cause) };
    } finally {
      repository.database.originals.hook('creating').unsubscribe(failThird);
    }
  }, Array.from(archive.bytes));
  expect(outcome).toMatchObject({ rejected: true, writes: 3 });
  expect(await snapshot(tab, database)).toEqual(before);
  await tab.close();
  const reopened = await harnessTab(context, database);
  expect(await snapshot(reopened, database)).toEqual(before);
  const report = await reopened.evaluate(
    (bytes) => (window as any).repository.importArchive(new Blob([new Uint8Array(bytes)])),
    Array.from(archive.bytes),
  );
  expect(report.importedIds).toHaveLength(7);
  const after = await snapshot(reopened, database);
  expectConsistent(after);
  expect(after.items).toHaveLength(8);
  expect(after.items.filter((item) => before.items.some((b) => b.id === item.id))).toEqual(
    before.items,
  );
});

test('[S6] closing the tab during a large restore leaves either the whole archive or none of it', async ({
  context,
  browser,
}) => {
  const archive = await mixedArchive(context);
  // The seven entries plus 24 renamed copies (175 entries) so hashing and writing take
  // measurable time. After the small restore, 168 are new and the original seven are duplicates.
  const large = rebuild(archive.bytes, (files, manifest) => {
    const entries = [...manifest.items];
    for (let copy = 1; copy < 25; copy++)
      for (const entry of entries) {
        const id = randomUUID();
        files[`originals/${id}`] = files[entry.originalPath]!;
        manifest.items.push({
          ...entry,
          id,
          title: `${entry.title} copy ${copy}`,
          originalPath: `originals/${id}`,
        });
      }
  });
  /** Restores the small archive, then the large one, closing the tab `closeAfterMs` later. */
  const restoreAndClose = async (closeAfterMs?: number) => {
    const profile = await browser.newContext();
    try {
      const page = await profile.newPage();
      await enterApp(page);
      await page.goto('/#/settings');
      await page.getByLabel('Choose backup ZIP').setInputFiles(archive.file);
      await expect(page.getByRole('status')).toContainText('Restored 7 items');
      const before = await snapshot(page, APP_DB);
      const started = Date.now();
      await page.getByLabel('Choose backup ZIP').setInputFiles(zipFile(large));
      if (closeAfterMs === undefined) {
        await expect(page.getByRole('status')).toContainText(
          'Restored 168 items. Skipped 7 duplicates.',
          {
            timeout: 60000,
          },
        );
      } else {
        await page.waitForTimeout(Math.max(0, closeAfterMs - (Date.now() - started)));
        await page.close();
      }
      const elapsed = Date.now() - started;
      const reopened = await profile.newPage();
      await reopened.goto('/#/library');
      const after = await snapshot(reopened, APP_DB);
      expectConsistent(after);
      expect([7, 175]).toContain(after.items.length);
      expect(after.items.filter((item) => before.items.some((b) => b.id === item.id))).toEqual(
        before.items,
      );
      if (after.items.length > 7) {
        expect(after.items.filter((item) => item.status === 'queued')).toHaveLength(175);
        expect(after.jobs).toHaveLength(175);
      }
      return { elapsed, committed: after.items.length > 7 };
    } finally {
      await profile.close();
    }
  };
  const complete = await restoreAndClose();
  expect(complete.committed).toBe(true);
  const outcomes = [];
  for (const fraction of [0.25, 0.5, 0.75, 0.9]) {
    const { committed } = await restoreAndClose(Math.round(complete.elapsed * fraction));
    outcomes.push(`${fraction}: ${committed ? 'committed' : 'abandoned'}`);
  }
  test.info().annotations.push({
    type: 'outcome',
    description: `full restore ${complete.elapsed} ms; closed at ${outcomes.join(', ')}`,
  });
});

test('[S12] a recoverable failure survives reopening and retry publishes one new generation', async ({
  context,
}) => {
  const database = `retry-${crypto.randomUUID()}`;
  const first = await harnessTab(context, database);
  const { item, claim } = await first.evaluate(async () => {
    const repository = (window as any).repository;
    const item = await repository.save({ kind: 'note', text: 'Synthetic note that fails once.' });
    const claim = await repository.claimNextJob();
    await repository.failJob(claim, {
      code: 'EXTRACTION_FAILED',
      message: 'Simulated recoverable extraction failure.',
      retryable: true,
    });
    return { item, claim };
  });
  await first.close();
  const second = await harnessTab(context, database);
  const failed = await snapshot(second, database);
  expectConsistent(failed);
  expect(failed.items[0]).toMatchObject({ status: 'failed', processingGeneration: 0 });
  expect(failed.items[0].error.message).toBe('Simulated recoverable extraction failure.');
  expect(failed.originals[0]!.sha256).toBe(item.contentSha256);
  expect(failed.jobs).toEqual([]);
  // Retry, as LocalEngine.indexItem does, moves to the next generation.
  const retry = await second.evaluate(async (id) => {
    const repository = (window as any).repository;
    await repository.enqueueItem(id);
    return repository.claimNextJob();
  }, item.id);
  expect(retry.generation).toBe(1);
  expect(await publish(second, claim, await segmentFor(second, item.id))).toBe(false);
  const fresh = await segmentFor(second, item.id);
  expect(await publish(second, retry, fresh)).toBe(true);
  expect(await publish(second, claim, await segmentFor(second, item.id))).toBe(false);
  await second.close();
  const third = await harnessTab(context, database);
  const ready = await snapshot(third, database);
  expectConsistent(ready);
  expect(ready.items.map((i) => [i.status, i.processingGeneration, i.error])).toEqual([
    ['ready', 1, undefined],
  ]);
  expect(ready.segments.map((s) => s.id)).toEqual([fresh.id]);
  expect(ready.jobs).toEqual([]);
});
