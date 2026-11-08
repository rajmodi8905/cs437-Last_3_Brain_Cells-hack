/// <reference types="node" />
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../client/api';
import { MemoryPilotStore } from '../server/memory';
import { PostgresPilotStore } from '../server/postgres';
import type { PilotStore, StoredItem } from '../server/store';
import { clock, deviceFetch, idToken, sha256, startPilotServer } from './helpers';

const DATABASE = process.env.PILOT_TEST_DATABASE_URL;
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const item = (globalId = randomUUID()): StoredItem => ({
  globalId,
  kind: 'note',
  title: 'Original title',
  mimeType: 'text/plain',
  byteLength: 60,
  contentSha256: sha256(new Uint8Array(60)),
  createdAt: 1,
  revision: 1,
  deleted: false,
  objectKey: `google:subject-a/1/${globalId}/original`,
});

async function fixture(durable: boolean, quota = 100) {
  let stores: PilotStore[];
  if (durable) {
    const schema = `concurrent_${randomUUID().replaceAll('-', '')}`;
    const a = await PostgresPilotStore.open({ connectionString: DATABASE!, schema });
    const b = await PostgresPilotStore.open({ connectionString: DATABASE!, schema });
    cleanups.push(async () => {
      await a.dropSchemaForTests();
      await Promise.all([a.close(), b.close()]);
    });
    stores = [a, b];
  } else {
    const store = new MemoryPilotStore();
    stores = [store, store];
  }
  const servers = await Promise.all(stores.map((store) => startPilotServer(quota, { store })));
  for (const server of servers) cleanups.push(server.close);
  const devices = deviceFetch();
  const api = createApiClient({ base: servers[0].base, fetch: devices.fetchImpl });
  const session = await api.signIn(idToken());
  // One browser session against two API instances sharing the same backing database.
  const call = (server: number, path: string, method: string, body: unknown) =>
    devices.fetchImpl(`${servers[server].base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-recall-csrf': session.csrf },
      body: JSON.stringify(body),
    });
  return { stores, call };
}

// Delay after reading the old value. Without an owner-wide critical section, the other API
// request can read that same value and commit while this request is waiting.
function slowReads(stores: PilotStore[], method: 'getItem' | 'committedBytes' | 'savedResponse') {
  for (const store of new Set(stores)) {
    const original = store[method].bind(store) as (...args: never[]) => Promise<unknown>;
    Object.assign(store, {
      [method]: async (...args: never[]) => {
        const value = await original(...args);
        await pause(30);
        return value;
      },
    });
  }
}

describe.each([
  ['memory', false],
  ['PostgreSQL, two API instances', true],
] as const)('concurrent writes: %s', (_name, durable) => {
  it.skipIf(durable && !DATABASE)('conflicts two renames from the same base revision', async () => {
    const { stores, call } = await fixture(durable);
    const original = item();
    await stores[0].publish('google:subject-a', original, 1);
    slowReads(stores, 'getItem');
    const results = await Promise.all(
      ['First rename', 'Second rename'].map((title, server) =>
        call(server, `/items/${original.globalId}`, 'PATCH', {
          opId: randomUUID(),
          epoch: 1,
          expectedRevision: 1,
          title,
        }),
      ),
    );
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    expect((await stores[0].getItem('google:subject-a', original.globalId))?.revision).toBe(2);
  });

  it.skipIf(durable && !DATABASE)(
    'keeps a tombstone when deletion overlaps an earlier rename',
    async () => {
      const { stores, call } = await fixture(durable);
      const original = item();
      await stores[0].publish('google:subject-a', original, 1);
      let read!: () => void;
      const readStarted = new Promise<void>((resolve) => {
        read = resolve;
      });
      const getItem = stores[0].getItem.bind(stores[0]);
      let first = true;
      stores[0].getItem = async (...args) => {
        const value = await getItem(...args);
        if (first) {
          first = false;
          read();
          await pause(60);
        }
        return value;
      };
      const rename = call(0, `/items/${original.globalId}`, 'PATCH', {
        opId: randomUUID(),
        epoch: 1,
        expectedRevision: 1,
        title: 'Delayed rename',
      });
      await readStarted;
      const deletion = call(1, `/items/${original.globalId}`, 'DELETE', {
        opId: randomUUID(),
        epoch: 1,
        expectedRevision: 1,
      });
      expect((await rename).status).toBe(200);
      expect((await deletion).status).toBe(200);
      expect(await stores[0].getItem('google:subject-a', original.globalId)).toMatchObject({
        deleted: true,
        revision: 3,
      });
    },
  );

  it.skipIf(durable && !DATABASE)(
    'reserves quota atomically across simultaneous uploads',
    async () => {
      const { stores, call } = await fixture(durable);
      slowReads(stores, 'committedBytes');
      const results = await Promise.all(
        [0, 1].map((server) => {
          const {
            globalId,
            revision: _revision,
            deleted: _deleted,
            objectKey: _key,
            ...description
          } = item();
          return call(server, `/items/${globalId}/upload`, 'POST', {
            opId: randomUUID(),
            epoch: 1,
            item: description,
          });
        }),
      );
      expect(results.map((result) => result.status).sort()).toEqual([200, 413]);
      expect(await stores[0].committedBytes('google:subject-a')).toBe(60);
    },
  );

  it.skipIf(durable && !DATABASE)(
    'returns one reservation for simultaneous retries of the same operation',
    async () => {
      const { stores, call } = await fixture(durable, 1000);
      slowReads(stores, 'savedResponse');
      const original = item();
      const {
        globalId,
        revision: _revision,
        deleted: _deleted,
        objectKey: _key,
        ...description
      } = original;
      const body = { opId: randomUUID(), epoch: 1, item: description };
      const results = await Promise.all(
        [0, 1].map((server) => call(server, `/items/${globalId}/upload`, 'POST', body)),
      );
      expect(results.map((result) => result.status)).toEqual([200, 200]);
      const replies = await Promise.all(results.map((result) => result.json()));
      expect(replies[0].uploadId).toBe(replies[1].uploadId);
      expect(await stores[0].committedBytes('google:subject-a')).toBe(60);
    },
  );
});

it.skipIf(!DATABASE)(
  'rolls back an upload and its reply together when the owner mutation fails',
  async () => {
    const { stores } = await fixture(true);
    const original = item();
    const uploadId = randomUUID();
    await expect(
      stores[0].withOwnerLock('google:subject-a', async () => {
        await stores[0].createUpload({
          uploadId,
          ownerKey: 'google:subject-a',
          epoch: 1,
          globalId: original.globalId,
          item: original,
          createdAt: clock.now,
        });
        await stores[0].saveResponse('google:subject-a', 'failed-operation', {
          status: 200,
          body: { uploadId },
        });
        throw new Error('Simulated failure before commit');
      }),
    ).rejects.toThrow('Simulated failure');
    expect(await stores[1].getUpload(uploadId)).toBeUndefined();
    expect(await stores[1].savedResponse('google:subject-a', 'failed-operation')).toBeUndefined();
    expect(await stores[1].committedBytes('google:subject-a')).toBe(0);
  },
);

it.skipIf(!DATABASE)(
  'does not acknowledge an API mutation whose transaction fails before commit',
  async () => {
    const { stores, call } = await fixture(true);
    const store = stores[0];
    const withOwnerLock = store.withOwnerLock.bind(store);
    store.withOwnerLock = (owner, run) =>
      withOwnerLock(owner, async () => {
        await run();
        throw new Error('Simulated failure after preparing the response');
      });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const original = item();
      const response = await call(0, `/items/${original.globalId}/upload`, 'POST', {
        opId: randomUUID(),
        epoch: 1,
        item: original,
      });
      expect(response.status).toBe(500);
      expect((await response.json()).error.code).toBe('INTERNAL_ERROR');
      expect(await stores[1].committedBytes('google:subject-a')).toBe(0);
    } finally {
      log.mockRestore();
    }
  },
);
