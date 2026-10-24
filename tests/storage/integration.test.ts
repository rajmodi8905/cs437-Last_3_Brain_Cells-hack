import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
import { CampusRecallDatabase, DexieLibraryRepository } from '../../src/storage';
const repo = () =>
  new DexieLibraryRepository(new CampusRecallDatabase(`integration-${crypto.randomUUID()}`));
const vector = () => new Float32Array(768).fill(1 / Math.sqrt(768));
it('does not requeue ready items after an idempotent index request', async () => {
  const r = repo();
  const item = await r.save({ kind: 'note', text: 'Source' });
  const c = (await r.claimNextJob())!;
  await r.publishSegments(c, [
    {
      id: 'segment',
      itemId: item.id,
      modality: 'text',
      text: 'Source',
      location: { kind: 'whole' },
      indexVersion: 'v1',
      vector: vector(),
    },
  ]);
  await r.enqueueItem(item.id);
  expect(await r.claimNextJob()).toBeUndefined();
});
it('does not publish empty or unnormalized segments', async () => {
  const r = repo();
  const item = await r.save({ kind: 'note', text: 'Source' });
  const c = (await r.claimNextJob())!;
  expect(await r.publishSegments(c, [])).toBe(false);
  expect(
    await r.publishSegments(c, [
      {
        id: 's',
        itemId: item.id,
        modality: 'text',
        location: { kind: 'whole' },
        indexVersion: 'v1',
        vector: new Float32Array(768).fill(1),
      },
    ]),
  ).toBe(false);
});
it('reports malformed JSON manifests consistently without writes', async () => {
  const r = repo();
  for (const manifest of [null, { format: 'campus-recall', version: 1, items: [null] }]) {
    const z = zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)) });
    await expect(r.importArchive(new Blob([z as BlobPart]))).rejects.toMatchObject({
      detail: { code: 'INVALID_ARCHIVE' },
    });
  }
  expect(await r.listItems()).toEqual([]);
});
it('recovers interrupted processing but rejects its previous claim', async () => {
  const r = repo();
  const item = await r.save({ kind: 'note', text: 'Source' });
  const stale = (await r.claimNextJob())!;
  await r.recoverInterruptedJobs();
  const fresh = (await r.claimNextJob())!;
  const segment = {
    id: 's',
    itemId: item.id,
    modality: 'text' as const,
    text: 'Source',
    location: { kind: 'whole' as const },
    indexVersion: 'v1',
    vector: vector(),
  };
  expect(await r.publishSegments(stale, [segment])).toBe(false);
  expect(await r.publishSegments(fresh, [segment])).toBe(true);
});
it('rejects archive entries outside the original-file namespace', async () => {
  const r = repo();
  const z = zipSync({
    'manifest.json': strToU8('{"format":"campus-recall","version":1,"items":[]}'),
    'unexpected.js': strToU8('alert(1)'),
  });
  await expect(r.importArchive(new Blob([z as BlobPart]))).rejects.toMatchObject({
    detail: { code: 'INVALID_ARCHIVE' },
  });
  expect(await r.listItems()).toHaveLength(0);
});
it('rolls back originals and jobs when a save transaction fails', async () => {
  const r = repo();
  r.database.originals.hook('creating', () => {
    throw Error('Simulated storage write failure');
  });
  await expect(r.save({ kind: 'note', text: 'Must not be confirmed' })).rejects.toMatchObject({
    detail: { code: 'STORAGE_FAILED' },
  });
  expect(await r.listItems()).toEqual([]);
  expect(await r.database.originals.count()).toBe(0);
  expect(await r.database.jobs.count()).toBe(0);
});
it('cancel followed by retry cannot publish a stale generation', async () => {
  const r = repo();
  const item = await r.save({ kind: 'note', text: 'Source' });
  const stale = (await r.claimNextJob())!;
  await r.cancelItem(item.id);
  await r.enqueueItem(item.id);
  const fresh = (await r.claimNextJob())!;
  const segment = {
    id: 's',
    itemId: item.id,
    modality: 'text' as const,
    text: 'Source',
    location: { kind: 'whole' as const },
    indexVersion: 'v1',
    vector: vector(),
  };
  expect(await r.publishSegments(stale, [segment])).toBe(false);
  expect(await r.publishSegments(fresh, [segment])).toBe(true);
  expect(await r.database.segments.where('itemId').equals(item.id).count()).toBe(1);
});
it('accepts the common iPhone M4A MIME alias without changing original bytes', async () => {
  const r = repo();
  const file = new File([readFileSync('tests/fixtures/sample-10.m4a')], 'recording.m4a', {
    type: 'audio/x-m4a',
  });
  const item = await r.save({ kind: 'file', file });
  expect(item.kind).toBe('audio');
  expect((await r.getOriginal(item.id))?.size).toBe(file.size);
});
it('rejects a claimed image whose basic container signature is invalid before writing', async () => {
  const r = repo();
  await expect(
    r.save({ kind: 'file', file: new File(['not a PNG'], 'image.png', { type: 'image/png' }) }),
  ).rejects.toMatchObject({ detail: { code: 'UNSUPPORTED_FORMAT' } });
  expect(await r.listItems()).toEqual([]);
});
it('rejects mixed index generations and empty extracted text before publishing', async () => {
  const r = repo();
  const item = await r.save({ kind: 'note', text: 'source' });
  const claim = (await r.claimNextJob())!;
  const segment = {
    id: 'one',
    itemId: item.id,
    modality: 'text' as const,
    text: 'source',
    location: { kind: 'whole' as const },
    indexVersion: 'one',
    vector: vector(),
  };
  expect(
    await r.publishSegments(claim, [segment, { ...segment, id: 'two', indexVersion: 'two' }]),
  ).toBe(false);
  expect(await r.publishSegments(claim, [{ ...segment, text: '' }])).toBe(false);
  expect(
    await r.publishSegments(claim, [{ ...segment, location: { kind: 'page', page: 0 } }]),
  ).toBe(false);
});
