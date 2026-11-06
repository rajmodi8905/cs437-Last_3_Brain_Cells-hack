/// <reference types="node" />
// The same guarantees from every PilotStore and ObjectStore implementation. The durable ones
// run when `npm run test:pilot:storage` provides PostgreSQL and Azurite; otherwise they are
// reported as skipped, never as passed.
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { AzureBlobObjectStore, managedIdentityCredential } from '../server/blob';
import { MemoryObjectStore, MemoryPilotStore } from '../server/memory';
import { PostgresPilotStore } from '../server/postgres';
import {
  VaultResetError,
  type ObjectStore,
  type PilotStore,
  type StoredItem,
} from '../server/store';

const DATABASE = process.env.PILOT_TEST_DATABASE_URL;
const BLOB = process.env.PILOT_TEST_BLOB_CONNECTION;
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** Each store gets its own PostgreSQL schema or Blob container, removed after the test. */
async function postgresStore(schema = `test_${randomUUID().replaceAll('-', '')}`) {
  const store = await PostgresPilotStore.open({ connectionString: DATABASE!, schema });
  cleanups.push(async () => {
    await store.dropSchemaForTests();
    await store.close();
  });
  return { store, schema };
}
async function blobStore(container = `test-${randomUUID()}`) {
  const objects = await AzureBlobObjectStore.open({ connectionString: BLOB!, container });
  cleanups.push(() => objects.deleteContainerForTests());
  return objects;
}

const item = (globalId: string, over: Partial<StoredItem> = {}): StoredItem => ({
  globalId,
  kind: 'pdf',
  title: 'Hostel rules',
  mimeType: 'application/pdf',
  byteLength: 1000,
  contentSha256: 'a'.repeat(64),
  createdAt: 1,
  revision: 1,
  deleted: false,
  objectKey: `owner/1/${globalId}/original`,
  ...over,
});

const stores: [string, boolean, () => Promise<PilotStore>][] = [
  ['memory', true, async () => new MemoryPilotStore()],
  ['PostgreSQL', !!DATABASE, async () => (await postgresStore()).store],
];

describe.each(stores)('PilotStore: %s', (name, available, open) => {
  if (!available) {
    it.skip(`needs PILOT_TEST_DATABASE_URL (run npm run test:pilot:storage) for ${name}`);
    return;
  }

  it('starts each account at epoch 1 and keeps sessions and one-use sign-in attempts', async () => {
    const store = await open();
    expect(await store.vault('google:a')).toEqual({ epoch: 1 });
    const session = {
      id: 's1',
      csrf: 'c',
      ownerKey: 'google:a',
      email: 'a@iitgn.ac.in',
      expiresAt: 99,
    };
    await store.createSession(session);
    expect(await store.getSession('s1')).toEqual(session);
    await store.deleteSession('s1');
    expect(await store.getSession('s1')).toBeUndefined();

    const attempt = { id: 'l1', state: 's', nonce: 'n', codeVerifier: 'v', expiresAt: 50 };
    await store.createLoginAttempt(attempt);
    expect(await store.takeLoginAttempt('l1')).toEqual(attempt);
    expect(await store.takeLoginAttempt('l1')).toBeUndefined();
  });

  it('allocates change cursors in commit order and keeps accounts apart', async () => {
    const store = await open();
    const first = await store.publish('google:a', item('i1'), 1);
    const second = await store.publish('google:a', item('i2'), 1);
    await store.publish('google:b', item('i9'), 1);
    expect([first.cursor, second.cursor]).toEqual([1, 2]);
    expect(await store.getItem('google:a', 'i2')).toEqual(item('i2'));
    expect(await store.getItem('google:b', 'i2')).toBeUndefined();
    const page = await store.changesAfter('google:a', 1);
    expect(page.cursor).toBe(2);
    expect(page.changes.map((change) => change.item.globalId)).toEqual(['i2']);
    // Tombstones keep only identity and revision.
    await store.publish(
      'google:a',
      item('i1', { deleted: true, revision: 2, objectKey: undefined }),
      1,
    );
    expect((await store.changesAfter('google:a', 2)).changes[0].item).toEqual({
      globalId: 'i1',
      revision: 2,
      deleted: true,
    });
  });

  it('refuses to publish into an epoch that has moved on', async () => {
    const store = await open();
    await store.resetVault('google:a');
    await expect(store.publish('google:a', item('i1'), 1)).rejects.toBeInstanceOf(VaultResetError);
    expect(await store.getItem('google:a', 'i1')).toBeUndefined();
    expect((await store.changesAfter('google:a', 0)).changes).toEqual([]);
  });

  it('saves operation results per account', async () => {
    const store = await open();
    await store.saveResponse('google:a', 'op-1', { status: 200, body: { ok: 1 } });
    expect(await store.savedResponse('google:a', 'op-1')).toEqual({ status: 200, body: { ok: 1 } });
    expect(await store.savedResponse('google:b', 'op-1')).toBeUndefined();
  });

  it('tracks uploads, received chunks and committed bytes', async () => {
    const store = await open();
    const upload = {
      uploadId: 'u1',
      ownerKey: 'google:a',
      epoch: 1,
      globalId: 'i1',
      createdAt: 10,
      item: {
        kind: 'pdf' as const,
        title: 'T',
        mimeType: 'application/pdf',
        byteLength: 300,
        contentSha256: 'b'.repeat(64),
        createdAt: 1,
      },
    };
    await store.createUpload(upload);
    expect(await store.getUpload('u1')).toEqual(upload);
    await store.recordChunk('u1', 2);
    await store.recordChunk('u1', 0);
    await store.recordChunk('u1', 2);
    expect(await store.receivedChunks('u1')).toEqual([0, 2]);

    await store.publish('google:a', item('i0', { byteLength: 1000 }), 1);
    await store.publish('google:a', item('gone', { deleted: true, byteLength: 5000 }), 1);
    expect(await store.committedBytes('google:a')).toBe(1300);
    const result = { ...item('i1'), byteLength: 300 };
    const { objectKey: _key, ...visible } = result;
    await store.finishUpload('u1', visible);
    expect((await store.getUpload('u1'))?.result).toEqual(visible);
    expect(await store.committedBytes('google:a')).toBe(1000);
    expect(await store.committedBytes('google:b')).toBe(0);
  });

  it('resets one account: new epoch, nothing left, unfinished uploads handed back', async () => {
    const store = await open();
    await store.publish('google:a', item('i1'), 1);
    await store.publish('google:b', item('i2'), 1);
    await store.saveResponse('google:a', 'op-1', { status: 200, body: {} });
    await store.createUpload({
      uploadId: 'u1',
      ownerKey: 'google:a',
      epoch: 1,
      globalId: 'i3',
      createdAt: 10,
      item: {
        kind: 'pdf',
        title: 'T',
        mimeType: 'application/pdf',
        byteLength: 10,
        contentSha256: 'c'.repeat(64),
        createdAt: 1,
      },
    });
    await store.recordChunk('u1', 0);

    const reset = await store.resetVault('google:a');
    expect(reset.epoch).toBe(2);
    expect(reset.removed.map((removed) => removed.globalId)).toEqual(['i1']);
    expect(reset.abandoned).toEqual([{ uploadId: 'u1', chunks: [0] }]);
    expect(await store.vault('google:a')).toEqual({ epoch: 2 });
    expect(await store.getItem('google:a', 'i1')).toBeUndefined();
    expect(await store.changesAfter('google:a', 0)).toEqual({ cursor: 0, changes: [] });
    expect(await store.savedResponse('google:a', 'op-1')).toBeUndefined();
    expect(await store.getUpload('u1')).toBeUndefined();
    expect(await store.committedBytes('google:a')).toBe(0);
    expect(await store.getItem('google:b', 'i2')).toEqual(item('i2'));
    // The feed restarts in the new epoch.
    expect((await store.publish('google:a', item('i4'), 2)).cursor).toBe(1);
  });
});

const cleanupStores = stores;
describe.each(cleanupStores)('PilotStore clean-up: %s', (name, available, open) => {
  if (!available) {
    it.skip(`needs PILOT_TEST_DATABASE_URL (run npm run test:pilot:storage) for ${name}`);
    return;
  }
  const upload = (uploadId: string, createdAt: number) => ({
    uploadId,
    ownerKey: 'google:a',
    epoch: 1,
    globalId: `item-${uploadId}`,
    createdAt,
    item: {
      kind: 'pdf' as const,
      title: 'T',
      mimeType: 'application/pdf',
      byteLength: 100,
      contentSha256: 'd'.repeat(64),
      createdAt: 1,
    },
  });

  it('removes expired sessions and attempts, abandoned uploads and old results only', async () => {
    const store = await open();
    for (const [id, expiresAt] of [
      ['old', 100],
      ['new', 300],
    ] as const) {
      await store.createSession({
        id,
        csrf: 'c',
        ownerKey: 'google:a',
        email: 'a@iitgn.ac.in',
        expiresAt,
      });
      await store.createLoginAttempt({ id, state: 's', nonce: 'n', codeVerifier: 'v', expiresAt });
    }
    await store.createUpload(upload('stale', 10));
    await store.recordChunk('stale', 1);
    await store.recordChunk('stale', 0);
    await store.createUpload(upload('fresh', 250));
    await store.createUpload(upload('done-old', 10));
    await store.createUpload(upload('done-new', 250));
    for (const id of ['done-old', 'done-new'])
      await store.finishUpload(id, { ...item(`item-${id}`), byteLength: 100 });
    await store.saveResponse('google:a', 'op-old', { status: 200, body: {} }, 10);
    await store.saveResponse('google:a', 'op-new', { status: 200, body: {} }, 250);
    expect(await store.committedBytes('google:a')).toBe(200);

    const cleaned = await store.cleanUp({
      now: 200,
      abandonedBefore: 100,
      finishedBefore: 100,
      responsesBefore: 100,
    });
    expect(cleaned.abandoned).toEqual([{ uploadId: 'stale', chunks: [0, 1] }]);
    expect(await store.getSession('old')).toBeUndefined();
    expect(await store.getSession('new')).toBeDefined();
    expect(await store.takeLoginAttempt('old')).toBeUndefined();
    expect(await store.takeLoginAttempt('new')).toBeDefined();
    expect(await store.getUpload('stale')).toBeUndefined();
    expect(await store.getUpload('done-old')).toBeUndefined();
    expect(await store.getUpload('fresh')).toBeDefined();
    expect(await store.getUpload('done-new')).toBeDefined();
    expect(await store.receivedChunks('stale')).toEqual([]);
    expect(await store.savedResponse('google:a', 'op-old')).toBeUndefined();
    expect(await store.savedResponse('google:a', 'op-new')).toBeDefined();
    expect(await store.committedBytes('google:a')).toBe(100);
  });
});

describe('PilotStore: PostgreSQL survives a restart', () => {
  it.skipIf(!DATABASE)('a second connection to the same schema sees everything', async () => {
    const { store, schema } = await postgresStore();
    await store.publish('google:a', item('i1'), 1);
    await store.createSession({
      id: 's1',
      csrf: 'c',
      ownerKey: 'google:a',
      email: 'a@iitgn.ac.in',
      expiresAt: 99,
    });
    const again = await PostgresPilotStore.open({ connectionString: DATABASE!, schema });
    try {
      expect(await again.getItem('google:a', 'i1')).toEqual(item('i1'));
      expect((await again.getSession('s1'))?.email).toBe('a@iitgn.ac.in');
      expect((await again.changesAfter('google:a', 0)).cursor).toBe(1);
    } finally {
      await again.close();
    }
  });
});

const objectStores: [string, boolean, () => Promise<ObjectStore>][] = [
  ['memory', true, async () => new MemoryObjectStore()],
  ['Azure Blob (Azurite)', !!BLOB, () => blobStore()],
];

describe.each(objectStores)('ObjectStore: %s', (name, available, open) => {
  if (!available) {
    it.skip(`needs PILOT_TEST_BLOB_CONNECTION (run npm run test:pilot:storage) for ${name}`);
    return;
  }
  const bytes = (length: number, seed = 1) =>
    Uint8Array.from({ length }, (_, i) => (i * 31 + seed) % 251);

  it('stores, reads whole and in ranges, overwrites and deletes', async () => {
    const objects = await open();
    expect(await objects.get('missing')).toBeUndefined();
    await objects.put('a/b', bytes(1000));
    expect(await objects.get('a/b')).toEqual(bytes(1000));
    expect(await objects.get('a/b', { start: 10, end: 19 })).toEqual(bytes(1000).slice(10, 20));
    await objects.put('a/b', bytes(5, 7));
    expect(await objects.get('a/b')).toEqual(bytes(5, 7));
    await objects.delete('a/b');
    expect(await objects.get('a/b')).toBeUndefined();
    await objects.delete('a/b');
  });

  it('joins parts into one object in order', async () => {
    const objects = await open();
    const parts = [bytes(300, 1), bytes(300, 2), bytes(17, 3)];
    for (const [n, part] of parts.entries()) await objects.put(`staging/u/${n}`, part);
    await objects.compose('final', ['staging/u/0', 'staging/u/1', 'staging/u/2']);
    const joined = new Uint8Array([...parts[0], ...parts[1], ...parts[2]]);
    expect(await objects.get('final')).toEqual(joined);
    expect(await objects.get('final', { start: 295, end: 305 })).toEqual(joined.slice(295, 306));
  });
});

describe('ObjectStore: Azure Blob survives a restart', () => {
  it.skipIf(!BLOB)('a second client for the same container reads the object', async () => {
    const container = `test-${randomUUID()}`;
    const objects = await blobStore(container);
    await objects.put('k', new Uint8Array([1, 2, 3]));
    const again = await AzureBlobObjectStore.open({ connectionString: BLOB!, container });
    expect(await again.get('k')).toEqual(new Uint8Array([1, 2, 3]));
  });
});

describe('Managed identity token for Blob Storage', () => {
  it('asks the VM metadata service for a storage token and reuses it until near expiry', async () => {
    const requests: { url: URL; metadata: string | null }[] = [];
    let clock = 1_000_000_000_000;
    const fetchImpl = (async (input: URL, init?: RequestInit) => {
      requests.push({
        url: new URL(String(input)),
        metadata: new Headers(init?.headers).get('Metadata'),
      });
      return new Response(
        JSON.stringify({
          access_token: `token-${requests.length}`,
          expires_on: String(clock / 1000 + 3600),
        }),
      );
    }) as typeof fetch;
    const credential = managedIdentityCredential({
      clientId: 'mi-client',
      fetch: fetchImpl,
      now: () => clock,
    });
    expect((await credential.getToken('https://storage.azure.com/.default'))?.token).toBe(
      'token-1',
    );
    expect((await credential.getToken('https://storage.azure.com/.default'))?.token).toBe(
      'token-1',
    );
    expect(requests).toHaveLength(1);
    expect(`${requests[0].url.origin}${requests[0].url.pathname}`).toBe(
      'http://169.254.169.254/metadata/identity/oauth2/token',
    );
    expect(Object.fromEntries(requests[0].url.searchParams)).toEqual({
      'api-version': '2018-02-01',
      resource: 'https://storage.azure.com/',
      client_id: 'mi-client',
    });
    expect(requests[0].metadata).toBe('true');
    clock += 56 * 60_000;
    expect((await credential.getToken('https://storage.azure.com/.default'))?.token).toBe(
      'token-2',
    );
  });

  it('fails clearly when the VM has no identity', async () => {
    const credential = managedIdentityCredential({
      fetch: (async () => new Response('', { status: 400 })) as typeof fetch,
    });
    await expect(credential.getToken('x')).rejects.toThrow(/HTTP 400/);
  });
});
