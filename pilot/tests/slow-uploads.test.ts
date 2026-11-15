/// <reference types="node" />
// A slow upload must not hold the account's lock or a database connection while its body
// arrives, or a few of them stall every other request (#66).
import { createHash, randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryPilotStore } from '../server/memory';
import { PostgresPilotStore } from '../server/postgres';
import type { PilotStore } from '../server/store';
import { idToken, origin, startPilotServer } from './helpers';

const DATABASE = process.env.PILOT_TEST_DATABASE_URL;
const CHUNK = 32 * 1024;
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});

interface Session {
  cookie: string;
  csrf: string;
}

async function signIn(base: string, sub: string, email: string): Promise<Session> {
  const res = await fetch(`${base}/session`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ idToken: idToken({ sub, email }) }),
  });
  expect(res.status).toBe(200);
  const { csrf } = (await res.json()) as { csrf: string };
  return { cookie: res.headers.get('set-cookie')!.split(';')[0], csrf };
}

const headers = (session: Session) => ({
  origin,
  cookie: session.cookie,
  'x-recall-csrf': session.csrf,
  'content-type': 'application/json',
});

/** Begins the upload of a two-chunk PDF and returns its upload ID. */
async function beginUpload(base: string, session: Session) {
  const bytes = new Uint8Array(CHUNK * 2).fill(7);
  const res = await fetch(`${base}/items/${randomUUID()}/upload`, {
    method: 'POST',
    headers: headers(session),
    body: JSON.stringify({
      opId: randomUUID(),
      epoch: 1,
      item: {
        kind: 'pdf',
        title: 'Hostel mess rules',
        mimeType: 'application/pdf',
        byteLength: bytes.length,
        contentSha256: createHash('sha256').update(bytes).digest('hex'),
        createdAt: 1_762_000_000_000,
      },
    }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { uploadId: string }).uploadId;
}

/**
 * Starts sending chunk 0 of an upload: declares the whole chunk, sends only its first 1,000
 * bytes and stalls, as a phone on a bad connection does.
 */
function stalledChunk(base: string, session: Session, uploadId: string) {
  const url = new URL(`${base}/uploads/${uploadId}/chunks/0`);
  const req = httpRequest({
    host: url.hostname,
    port: url.port,
    path: url.pathname,
    method: 'PUT',
    headers: {
      origin,
      cookie: session.cookie,
      'x-recall-csrf': session.csrf,
      'content-type': 'application/octet-stream',
      'content-length': String(CHUNK),
    },
  });
  req.on('error', () => undefined);
  const status = new Promise<number>((resolve) =>
    req.on('response', (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode!));
    }),
  );
  req.write(new Uint8Array(1000).fill(7));
  return {
    status,
    finish: () => {
      req.end(new Uint8Array(CHUNK - 1000).fill(7));
    },
    abort: () => {
      req.destroy();
    },
  };
}

/** Resolves with the value, or with 'timed out' after `ms`. */
const within = <T>(work: Promise<T>, ms: number) =>
  Promise.race([
    work,
    new Promise<'timed out'>((resolve) => setTimeout(() => resolve('timed out'), ms)),
  ]);

async function server(store: PilotStore) {
  const started = await startPilotServer(50_000_000, {
    store,
    chunkBytes: CHUNK,
    limits: { accountBurst: 1000 },
  });
  cleanups.push(started.close);
  return started;
}

describe('slow uploads', () => {
  it('a chunk still arriving holds no account lock, so the same account’s other writes answer', async () => {
    const store = new MemoryPilotStore();
    let locked = 0;
    const withOwnerLock = store.withOwnerLock.bind(store);
    store.withOwnerLock = async (ownerKey, run) =>
      withOwnerLock(ownerKey, async () => {
        locked++;
        try {
          return await run();
        } finally {
          locked--;
        }
      });
    const { base } = await server(store);
    const a = await signIn(base, 'subject-a', 'student.a@iitgn.ac.in');
    const slow = stalledChunk(base, a, await beginUpload(base, a));
    cleanups.push(async () => slow.abort());
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(locked).toBe(0);
    // Under the old order this waited for the stalled chunk, which holds the account's lock.
    expect(typeof (await within(beginUpload(base, a), 1000))).toBe('string');
    slow.finish();
    expect(await slow.status).toBe(204);
  });

  it.skipIf(!DATABASE)(
    'ten stalled chunk bodies on PostgreSQL leave another account’s GET /changes answering within a second',
    async () => {
      const schema = `slow_${randomUUID().replaceAll('-', '')}`;
      // The production pool size.
      const store = await PostgresPilotStore.open({ connectionString: DATABASE!, schema, max: 10 });
      cleanups.push(async () => {
        await store.dropSchemaForTests();
        await store.close();
      });
      const { base } = await server(store);
      const a = await signIn(base, 'subject-a', 'student.a@iitgn.ac.in');
      const b = await signIn(base, 'subject-b', 'student.b@iitgn.ac.in');
      const uploads = [];
      for (let i = 0; i < 10; i++) uploads.push(await beginUpload(base, a));
      const slow = uploads.map((uploadId) => stalledChunk(base, a, uploadId));
      cleanups.push(async () => slow.forEach((each) => each.abort()));
      await new Promise((resolve) => setTimeout(resolve, 200));

      const read = fetch(`${base}/changes?epoch=1&after=0`, { headers: { cookie: b.cookie } });
      const answered = await within(read, 1000);
      expect(answered).not.toBe('timed out');
      expect((answered as Response).status).toBe(200);

      for (const each of slow) each.finish();
      expect(await Promise.all(slow.map((each) => each.status))).toEqual(Array(10).fill(204));
    },
  );
});
