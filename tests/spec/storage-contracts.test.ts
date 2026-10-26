import { afterEach, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CampusRecallDatabase, DexieLibraryRepository } from '../../src/storage';
import type { IndexedSegment, ItemStatus, LibraryItem, SaveInput } from '../../src/shared';
const databases: CampusRecallDatabase[] = [];
function fresh(name = 'spec') {
  const database = new CampusRecallDatabase(`${name}-${crypto.randomUUID()}`);
  databases.push(database);
  return new DexieLibraryRepository(database);
}
afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.delete()));
});
const segment = (item: LibraryItem): IndexedSegment => ({
  id: crypto.randomUUID(),
  itemId: item.id,
  modality: 'text',
  text: 'Original source',
  location: { kind: 'whole' },
  vector: new Float32Array(768).fill(1 / Math.sqrt(768)),
  indexVersion: 'controlled-storage-vector',
});
const supported = [
  ['image', 'sample-01.jpg', 'image/jpeg'],
  ['pdf', 'sample-03.pdf', 'application/pdf'],
  ['audio', 'sample-10.m4a', 'audio/mp4'],
  ['video', 'sample-11.mp4', 'video/mp4'],
] as const;
it('[S1] all six supported item kinds retain exact originals and recent records across reopening', async () => {
  const repository = fresh();
  const inputs: SaveInput[] = supported.map(([, file, type]) => ({
    kind: 'file',
    file: new File([readFileSync(`tests/fixtures/${file}`)], file, { type }),
  }));
  inputs.push(
    { kind: 'note', text: 'Original unicode note: café.' },
    { kind: 'webpage', url: 'https://example.test/saved', text: 'Original captured text.' },
  );
  const saved = [];
  for (const input of inputs) {
    const item = await repository.save(input);
    saved.push({
      item,
      bytes: new Uint8Array(await (await repository.getOriginal(item.id))!.arrayBuffer()),
    });
  }
  const name = repository.database.name;
  repository.database.close();
  const reopenedDb = new CampusRecallDatabase(name);
  databases.push(reopenedDb);
  const reopened = new DexieLibraryRepository(reopenedDb);
  await reopened.open();
  expect((await reopened.listItems()).map((i) => i.id)).toEqual(
    saved
      .map((s) => s.item)
      .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
      .map((i) => i.id),
  );
  expect(new Set((await reopened.listItems()).map((i) => i.kind)).size).toBe(6);
  for (const { item, bytes } of saved) {
    expect(await reopened.getItem(item.id)).toEqual(item);
    expect(new Uint8Array(await (await reopened.getOriginal(item.id))!.arrayBuffer())).toEqual(
      bytes,
    );
  }
  reopenedDb.close();
});
it('[S2] combined kind/status filters, stable ordering and rename preserve source identity', async () => {
  const r = fresh();
  const a = await r.save({ kind: 'note', title: 'Same title', text: 'First source' });
  const b = await r.save({ kind: 'note', title: 'Same title', text: 'Second source' });
  const web = await r.save({ kind: 'webpage', url: 'https://example.test', text: 'Snapshot' });
  await r.database.items.update(a.id, { createdAt: 100 });
  await r.database.items.update(b.id, { createdAt: 200 });
  await r.database.items.update(web.id, { createdAt: 300 });
  const claim = (await r.claimNextJob())!;
  await r.failJob(claim, {
    code: 'EXTRACTION_FAILED',
    message: 'Controlled failure',
    retryable: true,
  });
  expect((await r.listItems()).map((i) => i.id)).toEqual([web.id, b.id, a.id]);
  const failed = (await r.listItems({ kind: claim.item.kind, status: 'failed' })).map((i) => i.id);
  expect(failed).toEqual([claim.item.id]);
  expect(await r.listItems({ kind: 'pdf', status: 'ready' })).toEqual([]);
  const before = await r.getItem(b.id);
  const original = await (await r.getOriginal(b.id))!.text();
  const renamed = await r.renameItem(b.id, 'New title');
  expect(renamed).toMatchObject({
    id: b.id,
    createdAt: before!.createdAt,
    contentSha256: before!.contentSha256,
  });
  expect(await (await r.getOriginal(b.id))!.text()).toBe(original);
});
it.each<ItemStatus>(['queued', 'processing', 'ready'])(
  '[S3] deleting a %s item removes every related record and rejects late publication',
  async (status) => {
    const r = fresh();
    const item = await r.save({ kind: 'note', text: 'Original source' });
    const claim = status === 'queued' ? undefined : (await r.claimNextJob())!;
    if (status === 'ready') expect(await r.publishSegments(claim!, [segment(item)])).toBe(true);
    await r.database.previews.put({
      id: crypto.randomUUID(),
      itemId: item.id,
      blob: new Blob(['preview']),
    });
    await r.deleteItem(item.id);
    await r.deleteItem(item.id);
    if (claim) expect(await r.publishSegments(claim, [segment(item)])).toBe(false);
    for (const table of [
      r.database.items,
      r.database.originals,
      r.database.jobs,
      r.database.previews,
      r.database.segments,
    ])
      expect(await table.count()).toBe(0);
  },
);
it('[S6] mixed-library archive round trip preserves exact bytes and metadata with fresh queued IDs', async () => {
  const source = fresh('export');
  const inputs: SaveInput[] = supported.map(([, file, type]) => ({
    kind: 'file',
    title: 'Duplicate display title',
    file: new File([readFileSync(`tests/fixtures/${file}`)], file, { type }),
  }));
  inputs.push(
    { kind: 'note', title: 'Duplicate display title', text: 'Transfer note' },
    {
      kind: 'webpage',
      url: 'https://example.test/source',
      title: 'Duplicate display title',
      text: 'Transfer snapshot',
    },
  );
  const originals = [];
  for (const input of inputs) originals.push(await source.save(input));
  const archive = await source.exportItems(originals.map((i) => i.id));
  const target = fresh('restore');
  const imported = await target.importArchive(archive);
  expect(imported.importedIds).toHaveLength(6);
  for (const original of originals) {
    const restored = (await target.listItems()).find(
      (i) => i.contentSha256 === original.contentSha256,
    )!;
    expect(restored.id).not.toBe(original.id);
    expect(restored).toMatchObject({
      status: 'queued',
      title: original.title,
      createdAt: original.createdAt,
      sourceUrl: original.sourceUrl,
      originalName: original.originalName,
    });
    expect(new Uint8Array(await (await target.getOriginal(restored.id))!.arrayBuffer())).toEqual(
      new Uint8Array(await (await source.getOriginal(original.id))!.arrayBuffer()),
    );
  }
  expect(await target.database.segments.count()).toBe(0);
  expect(await target.database.jobs.count()).toBe(6);
  const second = await target.importArchive(archive);
  expect(second.importedIds).toEqual([]);
  expect(second.skippedDuplicateIds).toHaveLength(6);
});
