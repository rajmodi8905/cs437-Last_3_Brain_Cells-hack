import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApiClient } from '../client/api';
import { MemoryLocalLibrary, MemoryRemoteIndexStore, MemorySyncStateStore } from '../client/memory';
import { SyncEngine } from '../client/sync';
import { PILOT_INDEX_VERSIONS } from '../contract';
import { deviceFetch, idToken, startPilotServer } from './helpers';

let pilot: Awaited<ReturnType<typeof startPilotServer>>;
beforeEach(async () => {
  pilot = await startPilotServer();
});
afterEach(() => pilot.close());

const version = PILOT_INDEX_VERSIONS[0];
const pdf = new TextEncoder().encode(
  '%PDF-1.4\n' + 'Guests need a pass from the warden. '.repeat(300),
);
const unit = (axis: number) => Float32Array.from({ length: 768 }, (_, i) => (i === axis ? 1 : 0));
const segments = (axis: number) => [
  {
    modality: 'text' as const,
    location: { kind: 'page' as const, page: 2 },
    text: 'Guests need a pass from the warden.',
    vector: unit(axis),
  },
  { modality: 'visual' as const, location: { kind: 'whole' as const }, vector: unit(axis + 1) },
];

async function device() {
  const net = deviceFetch();
  const api = createApiClient({ base: pilot.base, fetch: net.fetchImpl });
  const library = new MemoryLocalLibrary();
  const remoteIndex = new MemoryRemoteIndexStore();
  const engine = new SyncEngine({
    api,
    library,
    state: new MemorySyncStateStore(),
    remoteIndex,
    libraryId: 'library',
  });
  const session = await api.signIn(idToken());
  await engine.include(session.vault.epoch);
  return { net, api, library, engine };
}

describe('P05 embeddings move between devices', () => {
  it('publishes a processed item’s segments and lets another device search them', async () => {
    const phone = await device();
    const id = phone.library.add(
      { kind: 'pdf', title: 'Hostel mess rules', mimeType: 'application/pdf' },
      pdf,
    );
    phone.library.setIndex(id, version, segments(3));
    expect(await phone.engine.runOnce()).toMatchObject({ uploaded: 1, indexed: 1, failed: 0 });
    expect((await phone.engine.runOnce()).indexed).toBe(0);

    const laptop = await device();
    await laptop.engine.runOnce();
    const cloud = await laptop.engine.cloudSegments();
    const globalId = (await laptop.engine.catalogue())[0].globalId;
    expect(cloud).toHaveLength(2);
    expect(cloud[0]).toMatchObject({
      itemId: `cloud:${globalId}`,
      itemKind: 'pdf',
      modality: 'text',
      location: { kind: 'page', page: 2 },
      text: 'Guests need a pass from the warden.',
      indexVersion: version,
    });
    expect(cloud[0].vector).toBeInstanceOf(Float32Array);
    expect(Array.from(cloud[0].vector)).toEqual(Array.from(unit(3)));
  });

  it('does not publish an item that is still processing', async () => {
    const phone = await device();
    const id = phone.library.add(
      { kind: 'pdf', title: 'Hostel mess rules', mimeType: 'application/pdf' },
      pdf,
    );
    phone.library.setStatus(id, 'processing');
    expect(await phone.engine.runOnce()).toMatchObject({ uploaded: 1, indexed: 0 });
    phone.library.setIndex(id, version, segments(3));
    expect((await phone.engine.runOnce()).indexed).toBe(1);
  });

  it('drops a stale cloud index after a rename until the new one is published', async () => {
    const phone = await device();
    const id = phone.library.add(
      { kind: 'pdf', title: 'Hostel mess rules', mimeType: 'application/pdf' },
      pdf,
    );
    phone.library.setIndex(id, version, segments(3));
    await phone.engine.runOnce();
    const laptop = await device();
    await laptop.engine.runOnce();
    expect(await laptop.engine.cloudSegments()).toHaveLength(2);

    // The app re-processes after a rename; until then the item is not ready.
    phone.library.setTitle(id, 'Mess rules 2026');
    phone.library.setStatus(id, 'processing');
    expect(await phone.engine.runOnce()).toMatchObject({ renamed: 1, indexed: 0 });
    await laptop.engine.runOnce();
    expect(await laptop.engine.cloudSegments()).toEqual([]);

    phone.library.setIndex(id, version, segments(9));
    expect((await phone.engine.runOnce()).indexed).toBe(1);
    await laptop.engine.runOnce();
    const cloud = await laptop.engine.cloudSegments();
    expect(cloud).toHaveLength(2);
    expect(Array.from(cloud[0].vector)).toEqual(Array.from(unit(9)));
  });

  it('ignores an index built by another model version', async () => {
    const phone = await device();
    const id = phone.library.add(
      { kind: 'pdf', title: 'Hostel mess rules', mimeType: 'application/pdf' },
      pdf,
    );
    phone.library.setIndex(id, 'older-model-v7', segments(3));
    expect(await phone.engine.runOnce()).toMatchObject({ uploaded: 1, indexed: 0 });
    const laptop = await device();
    await laptop.engine.runOnce();
    expect(await laptop.engine.cloudSegments()).toEqual([]);
  });

  it('removes cloud segments when the item is deleted', async () => {
    const phone = await device();
    const id = phone.library.add(
      { kind: 'pdf', title: 'Hostel mess rules', mimeType: 'application/pdf' },
      pdf,
    );
    phone.library.setIndex(id, version, segments(3));
    await phone.engine.runOnce();
    const laptop = await device();
    await laptop.engine.runOnce();
    phone.library.remove(id);
    await phone.engine.runOnce();
    await laptop.engine.runOnce();
    expect(await laptop.engine.cloudSegments()).toEqual([]);
  });
});
