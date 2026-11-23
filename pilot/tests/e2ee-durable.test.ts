/// <reference types="node" />
// E1, E2, E4 and E5 of docs/pilot/SPEC.md end to end, on the memory stores and, with
// `npm run test:pilot:storage`, on the hosted storage: PostgreSQL and Azure Blob (Azurite).
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { createApiClient } from '../client/api';
import {
  MemoryLocalLibrary,
  MemoryOfflineStore,
  MemoryRemoteIndexStore,
  MemorySyncStateStore,
  MemoryVaultSecretStore,
} from '../client/memory';
import { SyncEngine } from '../client/sync';
import { PILOT_INDEX_VERSIONS } from '../contract';
import { AzureBlobObjectStore } from '../server/blob';
import { PostgresPilotStore } from '../server/postgres';
import type { SealedStoredItem } from '../server/store';
import { deviceFetch, idToken, startPilotServer } from './helpers';

const DATABASE = process.env.PILOT_TEST_DATABASE_URL;
const BLOB = process.env.PILOT_TEST_BLOB_CONNECTION;
const OWNER = 'google:subject-a';
const MARKER = 'zebra-quokka-7731';
const LATER = 'okapi-narwhal-5520';
const version = PILOT_INDEX_VERSIONS[0];
const text = (value: string) => new TextEncoder().encode(value);
const unit = (axis: number) => Float32Array.from({ length: 768 }, (_, i) => (i === axis ? 1 : 0));
const segments = (axis: number, marker: string) => [
  {
    modality: 'text' as const,
    location: { kind: 'page' as const, page: 1 },
    text: `The locker code is ${marker}.`,
    vector: unit(axis),
  },
  { modality: 'visual' as const, location: { kind: 'whole' as const }, vector: unit(axis + 1) },
];

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** Memory stores: what a backup would hold is the change feed and the item rows. */
async function inMemory() {
  const server = await startPilotServer();
  cleanups.push(server.close);
  const rows = async () => {
    const { changes } = await server.store.changesAfter(OWNER, 0);
    const out = changes.map((change) => `changes ${JSON.stringify(change)}`);
    for (const { item } of changes)
      out.push(`items ${JSON.stringify(await server.store.getAnyItem(OWNER, item.globalId))}`);
    return out;
  };
  return { ...server, rows };
}

/** PostgreSQL and Azure Blob: every exported row, which is what a backup holds. */
async function hosted() {
  const schema = `test_${randomUUID().replaceAll('-', '')}`;
  const store = await PostgresPilotStore.open({ connectionString: DATABASE!, schema });
  const objects = await AzureBlobObjectStore.open({
    connectionString: BLOB!,
    container: `test-${randomUUID()}`,
  });
  const server = await startPilotServer(5_000_000, { store, objects });
  cleanups.push(async () => {
    await server.close();
    await store.dropSchemaForTests();
    await store.close();
    await objects.deleteContainerForTests();
  });
  const rows = async () => {
    const out: string[] = [];
    await store.exportRows((table, row) => out.push(`${table} ${JSON.stringify(row)}`));
    return out;
  };
  return { ...server, store, objects, rows };
}
type Hosted = Awaited<ReturnType<typeof inMemory>>;

const backends: [string, () => Promise<Hosted>][] = [
  ['memory', inMemory],
  ...(DATABASE && BLOB
    ? [['PostgreSQL and Azure Blob', hosted] as [string, () => Promise<Hosted>]]
    : []),
];

async function device(pilot: Hosted) {
  const net = deviceFetch();
  const api = createApiClient({ base: pilot.base, fetch: net.fetchImpl });
  const library = new MemoryLocalLibrary();
  const engine = new SyncEngine({
    api,
    library,
    state: new MemorySyncStateStore(),
    remoteIndex: new MemoryRemoteIndexStore(),
    offline: new MemoryOfflineStore(),
    vaultSecret: new MemoryVaultSecretStore(),
    libraryId: 'library',
  });
  const session = await api.signIn(idToken());
  await engine.include(session.vault.epoch);
  return { library, engine };
}

/** Every exported row (what a backup holds) and every stored object, as text. */
async function everythingStored(pilot: Hosted) {
  const rows = await pilot.rows();
  const objects: Buffer[] = [];
  for (const key of await pilot.objects.list(''))
    objects.push(Buffer.from((await pilot.objects.get(key))!));
  return { rows, objects };
}
const holds = (stored: Awaited<ReturnType<typeof everythingStored>>, value: string) =>
  stored.rows.some((row) => row.includes(value)) ||
  stored.objects.some((bytes) => bytes.includes(Buffer.from(value)));

describe.each(backends)('E1 to E5 end to end on %s', (_, open) => {
  it('seals old and new items, leaves no plaintext in any row or object, and pairs', async () => {
    const pilot = await open();
    const phone = await device(pilot);
    const old = phone.library.add(
      { kind: 'note', title: `Locker ${MARKER}`, mimeType: 'text/plain' },
      text(`Locker code ${MARKER}`),
    );
    phone.library.setIndex(old, version, segments(3, MARKER));
    expect(await phone.engine.runOnce()).toMatchObject({ uploaded: 1, indexed: 1, failed: 0 });
    expect(holds(await everythingStored(pilot), MARKER)).toBe(true);

    // E4: turning encryption on seals the plain item in place.
    const code = await phone.engine.turnOnEncryption();
    expect(await phone.engine.runOnce()).toMatchObject({ resealed: 1, failed: 0 });
    // E1: an item saved afterwards is sealed from the start.
    const later = phone.library.add(
      { kind: 'note', title: `Bus pass ${LATER}`, mimeType: 'text/plain' },
      text(`Bus pass ${LATER}`),
    );
    phone.library.setIndex(later, version, segments(5, LATER));
    expect(await phone.engine.runOnce()).toMatchObject({ uploaded: 1, failed: 0 });
    expect(await phone.engine.runOnce()).toMatchObject({ failed: 0 });

    const stored = await everythingStored(pilot);
    expect(holds(stored, MARKER)).toBe(false);
    expect(holds(stored, LATER)).toBe(false);
    const [first] = await phone.engine.catalogue();
    const row = (await pilot.store.getAnyItem(OWNER, first.globalId)) as SealedStoredItem;
    expect(row.sealed?.enc).toBe('ar-e2ee-1');
    expect(row.sealedIndex?.metaRevision).toBe(row.sealed?.metaRevision);

    // E2: a second device opens both with the recovery code.
    const laptop = await device(pilot);
    expect(await laptop.engine.runOnce()).toMatchObject({ locked: true });
    await laptop.engine.unlock(code);
    expect(await laptop.engine.runOnce()).toMatchObject({ failed: 0 });
    expect((await laptop.engine.catalogue()).map((item) => item.title)).toEqual([
      `Bus pass ${LATER}`,
      `Locker ${MARKER}`,
    ]);
    expect(await laptop.engine.cloudSegments()).toHaveLength(4);
    for (const item of await laptop.engine.catalogue())
      expect(new TextDecoder().decode(await laptop.engine.download(item.globalId))).toContain(
        item.title!.split(' ').at(-1)!,
      );

    // E5: pairing goes through the PostgreSQL pairing table and leaves nothing behind.
    const tablet = await device(pilot);
    await tablet.engine.runOnce();
    const started = await tablet.engine.startPairing();
    await laptop.engine.claimPairing(started.code);
    const onTablet = await tablet.engine.pairingStep();
    expect(await laptop.engine.pairingStep()).toEqual(onTablet);
    await laptop.engine.confirmPairing();
    expect(await tablet.engine.confirmPairing()).toEqual({ stage: 'done' });
    expect(await tablet.engine.encryption()).toEqual({ on: true, unlocked: true });
    expect((await everythingStored(pilot)).rows.some((row) => row.startsWith('pairings'))).toBe(
      false,
    );
  });
});
