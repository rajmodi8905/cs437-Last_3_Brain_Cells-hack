/// <reference types="node" />
// P13: the pilot API on PostgreSQL and Azure Blob (Azurite) keeps everything across restarts.
// Runs with `npm run test:pilot:storage`; skipped (and reported as skipped) without it.
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { createApiClient } from '../client/api';
import { MemoryLocalLibrary, MemorySyncStateStore } from '../client/memory';
import { SyncEngine } from '../client/sync';
import { AzureBlobObjectStore } from '../server/blob';
import { PostgresPilotStore } from '../server/postgres';
import { deviceFetch, idToken, sha256, startPilotServer } from './helpers';

const DATABASE = process.env.PILOT_TEST_DATABASE_URL;
const BLOB = process.env.PILOT_TEST_BLOB_CONNECTION;

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** One "deployment": a schema and a container that outlive any single server process. */
function deployment() {
  const schema = `test_${randomUUID().replaceAll('-', '')}`;
  const container = `test-${randomUUID()}`;
  let first = true;
  return async function boot() {
    const store = await PostgresPilotStore.open({ connectionString: DATABASE!, schema });
    const objects = await AzureBlobObjectStore.open({ connectionString: BLOB!, container });
    const server = await startPilotServer(5_000_000, { store, objects });
    if (first) {
      first = false;
      cleanups.push(async () => {
        const last = await PostgresPilotStore.open({ connectionString: DATABASE!, schema });
        await last.dropSchemaForTests();
        await last.close();
        await objects.deleteContainerForTests();
      });
    }
    return {
      ...server,
      objects,
      store,
      /** Stops the process: the server and its database connections. */
      stop: async () => {
        await server.close();
        await store.close();
      },
    };
  };
}

const pdf = new TextEncoder().encode(
  '%PDF-1.4\n' + 'Guests need a pass from the warden. '.repeat(3000),
);

describe.skipIf(!DATABASE || !BLOB)('P13 durable storage across restarts', () => {
  it('keeps the catalogue, originals, renames and sessions after the server restarts', async () => {
    const boot = deployment();
    let server = await boot();
    const net = deviceFetch();
    let api = createApiClient({ base: server.base, fetch: net.fetchImpl });
    const session = await api.signIn(idToken());
    const library = new MemoryLocalLibrary();
    const state = new MemorySyncStateStore();
    const engine = () => new SyncEngine({ api, library, state, libraryId: 'library' });
    await engine().include(session.vault.epoch);
    const id = library.add(
      { kind: 'pdf', title: 'Hostel rules', mimeType: 'application/pdf' },
      pdf,
    );
    expect((await engine().runOnce()).uploaded).toBe(1);
    await server.stop();

    server = await boot();
    cleanups.push(() => server.stop());
    api = createApiClient({ base: server.base, fetch: net.fetchImpl });
    // The same device is still signed in: its session lives in the database.
    expect((await api.restoreSession())?.email).toBe('student.a@iitgn.ac.in');
    library.setTitle(id, 'Hostel rules 2026');
    expect((await engine().runOnce()).renamed).toBe(1);

    const laptopApi = createApiClient({ base: server.base, fetch: deviceFetch().fetchImpl });
    const laptop = new SyncEngine({
      api: laptopApi,
      library: new MemoryLocalLibrary(),
      state: new MemorySyncStateStore(),
      libraryId: 'laptop',
      downloadRangeBytes: 32 * 1024,
    });
    await laptop.include((await laptopApi.signIn(idToken())).vault.epoch);
    await laptop.runOnce();
    const [entry] = await laptop.catalogue();
    expect(entry).toMatchObject({ title: 'Hostel rules 2026', revision: 2 });
    expect(sha256(await laptop.download(entry.globalId))).toBe(sha256(pdf));
  });

  it('finishes an upload that a restart interrupted, without the server holding it in memory', async () => {
    const boot = deployment();
    let server = await boot();
    const net = deviceFetch();
    let api = createApiClient({ base: server.base, fetch: net.fetchImpl });
    const { vault } = await api.signIn(idToken());
    const globalId = randomUUID();
    const begun = await api.beginUpload(globalId, {
      opId: randomUUID(),
      epoch: vault.epoch,
      item: {
        kind: 'pdf',
        title: 'Hostel rules',
        mimeType: 'application/pdf',
        byteLength: pdf.length,
        contentSha256: sha256(pdf),
        createdAt: 1,
      },
    });
    const size = begun.chunkBytes;
    await api.putChunk(begun.uploadId, 0, pdf.slice(0, size));
    await server.stop();

    server = await boot();
    cleanups.push(() => server.stop());
    api = createApiClient({ base: server.base, fetch: net.fetchImpl });
    await api.restoreSession();
    for (let n = 1; n * size < pdf.length; n++)
      await api.putChunk(begun.uploadId, n, pdf.slice(n * size, (n + 1) * size));
    const { item } = await api.completeUpload(begun.uploadId, {
      opId: randomUUID(),
      epoch: vault.epoch,
    });
    expect(item).toMatchObject({ globalId, byteLength: pdf.length, revision: 1 });
    expect(sha256(await api.original(globalId))).toBe(sha256(pdf));
    // Staged parts are removed once the original is assembled.
    expect(await server.objects.get(`staging/${begun.uploadId}/0`)).toBeUndefined();
  });

  it('deletes stored objects, including half-sent uploads, when the cloud library is removed', async () => {
    const boot = deployment();
    const server = await boot();
    cleanups.push(() => server.stop());
    const api = createApiClient({ base: server.base, fetch: deviceFetch().fetchImpl });
    const { vault } = await api.signIn(idToken());
    const library = new MemoryLocalLibrary();
    const engine = new SyncEngine({
      api,
      library,
      state: new MemorySyncStateStore(),
      libraryId: 'l',
    });
    await engine.include(vault.epoch);
    library.add({ kind: 'pdf', title: 'Hostel rules', mimeType: 'application/pdf' }, pdf);
    await engine.runOnce();
    const [entry] = await engine.catalogue();
    const stored = await server.store.getItem('google:subject-a', entry.globalId);
    const half = await api.beginUpload(randomUUID(), {
      opId: randomUUID(),
      epoch: vault.epoch,
      item: {
        kind: 'pdf',
        title: 'Half sent',
        mimeType: 'application/pdf',
        byteLength: pdf.length,
        contentSha256: sha256(pdf),
        createdAt: 1,
      },
    });
    await api.putChunk(half.uploadId, 0, pdf.slice(0, half.chunkBytes));

    await api.removeVault({ epoch: vault.epoch, confirm: 'remove-cloud-library' });
    expect(await server.objects.get(stored!.objectKey!)).toBeUndefined();
    expect(await server.objects.get(`staging/${half.uploadId}/0`)).toBeUndefined();
    expect(await server.store.committedBytes('google:subject-a')).toBe(0);
  });
});
