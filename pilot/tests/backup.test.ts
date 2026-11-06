/// <reference types="node" />
// P13: a backup restores into a fresh database and the pilot works from it end to end.
// Runs with `npm run test:pilot:storage`; skipped (and reported as skipped) without it.
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { createApiClient } from '../client/api';
import { MemoryLocalLibrary, MemorySyncStateStore } from '../client/memory';
import { SyncEngine } from '../client/sync';
import {
  backupDatabase,
  listBackups,
  pruneBackups,
  restoreDatabase,
  verifyObjects,
} from '../server/backup';
import { AzureBlobObjectStore } from '../server/blob';
import { MemoryObjectStore } from '../server/memory';
import { PostgresPilotStore } from '../server/postgres';
import { deviceFetch, idToken, sha256, startPilotServer } from './helpers';

const DATABASE = process.env.PILOT_TEST_DATABASE_URL;
const BLOB = process.env.PILOT_TEST_BLOB_CONNECTION;

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const newSchema = () => `test_${randomUUID().replaceAll('-', '')}`;
async function openStore(schema: string) {
  const store = await PostgresPilotStore.open({ connectionString: DATABASE!, schema });
  cleanups.push(async () => {
    await store.dropSchemaForTests().catch(() => undefined);
    await store.close();
  });
  return store;
}
async function openContainer() {
  const objects = await AzureBlobObjectStore.open({
    connectionString: BLOB!,
    container: `test-${randomUUID()}`,
  });
  cleanups.push(() => objects.deleteContainerForTests());
  return objects;
}
const bytes = (text: string) => new TextEncoder().encode('%PDF-1.4\n' + text.repeat(2000));

describe.skipIf(!DATABASE || !BLOB)('P13 backup and restore', () => {
  it('restores into a fresh database, and every device carries on without starting again', async () => {
    const live = await openStore(newSchema());
    const objects = await openContainer();
    const backups = await openContainer();
    const first = await startPilotServer(5_000_000, { store: live, objects });
    const net = deviceFetch();
    let api = createApiClient({ base: first.base, fetch: net.fetchImpl });
    const { vault } = await api.signIn(idToken());
    const library = new MemoryLocalLibrary();
    const state = new MemorySyncStateStore();
    const engine = () => new SyncEngine({ api, library, state, libraryId: 'phone' });
    await engine().include(vault.epoch);
    const kept = library.add(
      { kind: 'pdf', title: 'Hostel rules', mimeType: 'application/pdf' },
      bytes('Guests need a pass. '),
    );
    const gone = library.add(
      { kind: 'pdf', title: 'Old timetable', mimeType: 'application/pdf' },
      bytes('Monday 9 am. '),
    );
    await engine().runOnce();
    library.setTitle(kept, 'Hostel rules 2026');
    library.remove(gone);
    await engine().runOnce();

    const backup = await backupDatabase({
      store: live,
      target: backups,
      now: () => 1_762_300_000_000,
    });
    expect(backup.key).toBe('database/2025-11-04T23-46-40Z.jsonl.gz');
    expect(backup.counts).toMatchObject({ vaults: 1, items: 2, changes: 4, sessions: 1 });
    await first.close();

    // A fresh database, as after losing the server: restore, check objects, start again.
    const restoredSchema = newSchema();
    const restored = await restoreDatabase({
      source: backups,
      key: backup.key,
      connectionString: DATABASE!,
      schema: restoredSchema,
    });
    cleanups.push(async () => {
      await restored.store.dropSchemaForTests();
      await restored.store.close();
    });
    expect(restored.counts).toEqual(backup.counts);
    expect(await verifyObjects({ store: restored.store, objects })).toEqual({
      checked: 1,
      missing: [],
    });

    const second = await startPilotServer(5_000_000, { store: restored.store, objects });
    cleanups.push(() => second.close());
    api = createApiClient({ base: second.base, fetch: net.fetchImpl });
    // The phone's session, sync position and epoch all survive.
    expect((await api.restoreSession())?.email).toBe('student.a@iitgn.ac.in');
    library.add(
      { kind: 'pdf', title: 'Mess menu', mimeType: 'application/pdf' },
      bytes('Paneer on Friday. '),
    );
    const after = await engine().runOnce();
    expect(after).toMatchObject({ uploaded: 1, failed: 0 });
    expect(after.needsResync).toBeUndefined();

    const laptopApi = createApiClient({ base: second.base, fetch: deviceFetch().fetchImpl });
    const laptop = new SyncEngine({
      api: laptopApi,
      library: new MemoryLocalLibrary(),
      state: new MemorySyncStateStore(),
      libraryId: 'laptop',
    });
    await laptop.include((await laptopApi.signIn(idToken())).vault.epoch);
    await laptop.runOnce();
    const titles = (await laptop.catalogue()).map((item) => item.title);
    expect(titles).toEqual(['Hostel rules 2026', 'Mess menu']);
    const rules = (await laptop.catalogue())[0];
    expect(sha256(await laptop.download(rules.globalId))).toBe(
      sha256(bytes('Guests need a pass. ')),
    );
  });

  it('refuses to restore over a database that already has data', async () => {
    const live = await openStore(newSchema());
    const backups = await openContainer();
    await live.vault('google:a');
    const backup = await backupDatabase({ store: live, target: backups });
    await expect(
      restoreDatabase({
        source: backups,
        key: backup.key,
        connectionString: DATABASE!,
        schema: liveSchemaOf(live),
      }),
    ).rejects.toThrow(/not empty/);
  });

  it('refuses a damaged backup and writes nothing', async () => {
    const live = await openStore(newSchema());
    const backups = await openContainer();
    await live.vault('google:a');
    const backup = await backupDatabase({ store: live, target: backups });
    const data = (await backups.get(backup.key))!;
    data[data.length - 5] ^= 0xff;
    await backups.put(backup.key, data);
    const schema = newSchema();
    await expect(
      restoreDatabase({ source: backups, key: backup.key, connectionString: DATABASE!, schema }),
    ).rejects.toThrow(/does not match/);
    const empty = await openStore(schema);
    expect(await empty.isEmpty()).toBe(true);
  });

  it('refuses a backup from another database version', async () => {
    const live = await openStore(newSchema());
    const backups = await openContainer();
    await live.vault('google:a');
    const backup = await backupDatabase({ store: live, target: backups });
    const manifestKey = backup.key.replace(/\.jsonl\.gz$/, '.json');
    const manifest = JSON.parse(new TextDecoder().decode((await backups.get(manifestKey))!));
    await backups.put(
      manifestKey,
      new TextEncoder().encode(JSON.stringify({ ...manifest, databaseVersion: 99 })),
    );
    await expect(
      restoreDatabase({
        source: backups,
        key: backup.key,
        connectionString: DATABASE!,
        schema: newSchema(),
      }),
    ).rejects.toThrow(/database version 99/);
  });

  it('reports originals that are missing from object storage', async () => {
    const live = await openStore(newSchema());
    const objects = await openContainer();
    const server = await startPilotServer(5_000_000, { store: live, objects });
    cleanups.push(() => server.close());
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
    library.add({ kind: 'pdf', title: 'Hostel rules', mimeType: 'application/pdf' }, bytes('x '));
    await engine.runOnce();
    const [item] = await engine.catalogue();
    const stored = await live.getItem('google:subject-a', item.globalId);
    await objects.delete(stored!.objectKey!);
    expect(await verifyObjects({ store: live, objects })).toEqual({
      checked: 1,
      missing: [stored!.objectKey],
    });
  });
});

/** The schema a store was opened with, for the "not empty" test. */
const liveSchemaOf = (store: PostgresPilotStore) => store.schemaName;

describe('Backup retention', () => {
  it('lists backups newest first and keeps only the newest ones', async () => {
    const target = new MemoryObjectStore();
    for (const stamp of ['2026-11-01T02-00-00Z', '2026-11-03T02-00-00Z', '2026-11-02T02-00-00Z']) {
      await target.put(`database/${stamp}.jsonl.gz`, new Uint8Array([1]));
      await target.put(`database/${stamp}.json`, new Uint8Array([1]));
    }
    // Interrupted before its manifest was written: incomplete, never listed or restored.
    await target.put('database/2026-11-04T02-00-00Z.jsonl.gz', new Uint8Array([1]));
    expect(await listBackups(target)).toEqual([
      'database/2026-11-03T02-00-00Z.jsonl.gz',
      'database/2026-11-02T02-00-00Z.jsonl.gz',
      'database/2026-11-01T02-00-00Z.jsonl.gz',
    ]);
    expect(await pruneBackups(target, 2)).toEqual(['database/2026-11-01T02-00-00Z.jsonl.gz']);
    expect(await target.list('database/')).toEqual([
      'database/2026-11-02T02-00-00Z.json',
      'database/2026-11-02T02-00-00Z.jsonl.gz',
      'database/2026-11-03T02-00-00Z.json',
      'database/2026-11-03T02-00-00Z.jsonl.gz',
      'database/2026-11-04T02-00-00Z.jsonl.gz',
    ]);
  });
});
