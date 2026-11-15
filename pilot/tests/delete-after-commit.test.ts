/// <reference types="node" />
// Follow-up to #44 (listed in #71): an item's blobs are removed only after the delete has
// committed. In PostgreSQL the whole request runs in one transaction, so a blob delete that
// fails inside it rolls the tombstone back after the original is already gone.
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { MemoryObjectStore, MemoryPilotStore } from '../server/memory';
import { idToken, origin, sha256, startPilotServer } from './helpers';

let pilot: Awaited<ReturnType<typeof startPilotServer>> | undefined;
afterEach(async () => {
  await pilot?.close();
  pilot = undefined;
});

/** Remembers whether an owner lock is held, as the store's transaction is while a route runs. */
class LockWatchingStore extends MemoryPilotStore {
  held = 0;
  override async withOwnerLock<T>(ownerKey: string, run: () => Promise<T>): Promise<T> {
    return super.withOwnerLock(ownerKey, async () => {
      this.held++;
      try {
        return await run();
      } finally {
        this.held--;
      }
    });
  }
}

class WatchedObjects extends MemoryObjectStore {
  failDeletes = false;
  heldWhenDeleted: boolean[] = [];
  constructor(private store: LockWatchingStore) {
    super();
  }
  override async delete(key: string) {
    this.heldWhenDeleted.push(this.store.held > 0);
    if (this.failDeletes) throw new Error('object storage unavailable');
    return super.delete(key);
  }
}

interface Session {
  cookie: string;
  csrf: string;
  epoch: number;
}
async function signIn(): Promise<Session> {
  const res = await fetch(`${pilot!.base}/session`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ idToken: idToken() }),
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  return {
    cookie: (res.headers.get('set-cookie') ?? '').split(';')[0],
    csrf: body.csrf,
    epoch: body.vault.epoch,
  };
}
const call = (s: Session, path: string, method = 'GET', body?: unknown) =>
  fetch(`${pilot!.base}${path}`, {
    method,
    headers: {
      origin,
      cookie: s.cookie,
      'x-recall-csrf': s.csrf,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const pdf = new TextEncoder().encode('%PDF-1.4\n' + 'Guests need a pass. '.repeat(100));
async function upload(s: Session) {
  const globalId = randomUUID();
  const started = await call(s, `/items/${globalId}/upload`, 'POST', {
    opId: randomUUID(),
    epoch: s.epoch,
    item: {
      kind: 'pdf',
      title: 'Hostel mess rules',
      mimeType: 'application/pdf',
      byteLength: pdf.length,
      contentSha256: sha256(pdf),
      createdAt: 1_762_000_000_000,
    },
  });
  expect(started.status).toBe(200);
  const { uploadId } = (await started.json()) as { uploadId: string };
  const chunk = await fetch(`${pilot!.base}/uploads/${uploadId}/chunks/0`, {
    method: 'PUT',
    headers: {
      origin,
      cookie: s.cookie,
      'x-recall-csrf': s.csrf,
      'content-type': 'application/octet-stream',
    },
    body: pdf,
  });
  expect(chunk.status).toBe(204);
  const done = await call(s, `/uploads/${uploadId}/complete`, 'POST', {
    opId: randomUUID(),
    epoch: s.epoch,
  });
  expect(done.status).toBe(200);
  return globalId;
}
const remove = (s: Session, globalId: string) =>
  call(s, `/items/${globalId}`, 'DELETE', {
    opId: randomUUID(),
    epoch: s.epoch,
    expectedRevision: 1,
  });

async function start() {
  const store = new LockWatchingStore();
  const objects = new WatchedObjects(store);
  pilot = await startPilotServer(5_000_000, { store, objects });
  const session = await signIn();
  const globalId = await upload(session);
  objects.heldWhenDeleted = [];
  return { objects, session, globalId };
}

it("removes an item's blobs only after the owner lock is released", async () => {
  const { objects, session, globalId } = await start();
  expect((await remove(session, globalId)).status).toBe(200);
  expect(objects.heldWhenDeleted.length).toBeGreaterThan(0);
  expect(objects.heldWhenDeleted.every((held) => !held)).toBe(true);
  expect((await call(session, `/items/${globalId}/original`)).status).toBe(404);
});

it('still reports the item deleted when removing its blob fails after the commit', async () => {
  const { objects, session, globalId } = await start();
  objects.failDeletes = true;
  const res = await remove(session, globalId);
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ item: { globalId, deleted: true } });
  expect((await call(session, `/items/${globalId}/original`)).status).toBe(404);
});

it("removes the cloud library's blobs only after the owner lock is released", async () => {
  const { objects, session } = await start();
  const res = await call(session, '/vault', 'DELETE', {
    epoch: session.epoch,
    confirm: 'remove-cloud-library',
  });
  expect(res.status).toBe(200);
  expect(objects.heldWhenDeleted.length).toBeGreaterThan(0);
  expect(objects.heldWhenDeleted.every((held) => !held)).toBe(true);
});
