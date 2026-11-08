/// <reference types="node" />
import {
  createHash,
  createSign,
  generateKeyPairSync,
  randomUUID,
  type KeyObject,
} from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPilotHandler } from '../server/app';
import { MemoryObjectStore, MemoryPilotStore } from '../server/memory';
import { staticKeySource } from '../server/tokens';

const clientId = '1234-pilot.apps.googleusercontent.com';
const origin = 'https://recall.example.test';
const signing = generateKeyPairSync('rsa', { modulusLength: 2048 });
const stranger = generateKeyPairSync('rsa', { modulusLength: 2048 });
let clock = 1_762_300_000;

const b64url = (value: Buffer | string) => Buffer.from(value).toString('base64url');
function idToken(
  over: Record<string, unknown> = {},
  key: KeyObject = signing.privateKey,
  kid = 'test-key',
) {
  const header = b64url(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({
      iss: 'https://accounts.google.com',
      aud: clientId,
      sub: 'subject-a',
      iat: clock - 10,
      exp: clock + 3000,
      email: 'student.a@iitgn.ac.in',
      email_verified: true,
      hd: 'iitgn.ac.in',
      ...over,
    }),
  );
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${signer.sign(key).toString('base64url')}`;
}

let server: Server;
let base = '';
let store: MemoryPilotStore;
beforeEach(async () => {
  store = new MemoryPilotStore();
  const handler = createPilotHandler({
    clientId,
    allowedEmailDomain: 'iitgn.ac.in',
    origin,
    keys: staticKeySource({ 'test-key': signing.publicKey }),
    store,
    objects: new MemoryObjectStore(),
    nowSeconds: () => clock,
    quotaBytes: 1_000_000,
    chunkBytes: 64 * 1024,
  });
  server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
});
afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())));

interface Session {
  cookie: string;
  csrf: string;
  epoch: number;
}
async function signIn(token = idToken()): Promise<Session> {
  const res = await fetch(`${base}/session`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ idToken: token }),
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0];
  return { cookie, csrf: body.csrf, epoch: body.vault.epoch };
}
const call = (s: Session | undefined, path: string, init: RequestInit = {}) =>
  fetch(`${base}${path}`, {
    ...init,
    headers: {
      origin,
      ...(s ? { cookie: s.cookie, 'x-recall-csrf': s.csrf } : {}),
      ...(init.body && !(init.body instanceof Uint8Array)
        ? { 'content-type': 'application/json' }
        : {}),
      ...((init.headers as Record<string, string>) ?? {}),
    },
  });
const json = (s: Session, path: string, method: string, body: unknown) =>
  call(s, path, { method, body: JSON.stringify(body) });

const pdf = new TextEncoder().encode('%PDF-1.4\n' + 'Guests need a pass. '.repeat(5000));
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const describeItem = (bytes: Uint8Array, over: Record<string, unknown> = {}) => ({
  kind: 'pdf',
  title: 'Hostel mess rules',
  mimeType: 'application/pdf',
  byteLength: bytes.length,
  contentSha256: sha(bytes),
  createdAt: 1_762_000_000_000,
  ...over,
});
async function upload(s: Session, bytes: Uint8Array, globalId = randomUUID(), over = {}) {
  const begin = await json(s, `/items/${globalId}/upload`, 'POST', {
    opId: randomUUID(),
    epoch: s.epoch,
    item: describeItem(bytes, over),
  });
  expect(begin.status).toBe(200);
  const { uploadId, chunkBytes } = await begin.json();
  for (let n = 0, at = 0; at < bytes.length; n++, at += chunkBytes) {
    const res = await call(s, `/uploads/${uploadId}/chunks/${n}`, {
      method: 'PUT',
      body: bytes.slice(at, at + chunkBytes),
      headers: { 'content-type': 'application/octet-stream' },
    });
    expect(res.status).toBe(204);
  }
  const completeOp = randomUUID();
  const done = await json(s, `/uploads/${uploadId}/complete`, 'POST', {
    opId: completeOp,
    epoch: s.epoch,
  });
  return { globalId, uploadId, completeOp, done };
}
const changes = async (s: Session, after = 0) =>
  (await call(s, `/changes?epoch=${s.epoch}&after=${after}`)).json();

describe('P03/P12 sessions from Google sign-in', () => {
  it('opens a session for a verified IITGN Google account', async () => {
    const res = await fetch(`${base}/session`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ idToken: idToken() }),
    });
    expect(res.status).toBe(200);
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/^recall_session=[A-Za-z0-9_-]{40,};/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body).toMatchObject({ vault: { epoch: 1 }, email: 'student.a@iitgn.ac.in' });
    expect(body.csrf).toMatch(/^[A-Za-z0-9_-]{20,}$/);
  });

  it('returns a stable opaque account ID that differs between accounts', async () => {
    const accountOf = async (token: string) =>
      (
        await (
          await fetch(`${base}/session`, {
            method: 'POST',
            headers: { origin, 'content-type': 'application/json' },
            body: JSON.stringify({ idToken: token }),
          })
        ).json()
      ).account;
    const first = await accountOf(idToken());
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(await accountOf(idToken())).toBe(first);
    expect(await accountOf(idToken({ sub: 'subject-b', email: 'student.b@iitgn.ac.in' }))).not.toBe(
      first,
    );
    expect(first).not.toContain('subject-a');
  });

  it.each([
    ['a non-IITGN account', idToken({ email: 'someone@gmail.com' }), 403, 'NOT_ELIGIBLE'],
    ['a token signed by another key', idToken({}, stranger.privateKey), 401, 'UNAUTHENTICATED'],
    ['an unknown key ID', idToken({}, signing.privateKey, 'other-kid'), 401, 'UNAUTHENTICATED'],
    ['a malformed token', 'not-a-token', 401, 'UNAUTHENTICATED'],
  ])('refuses %s', async (_name, token, status, code) => {
    const res = await fetch(`${base}/session`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ idToken: token }),
    });
    expect(res.status).toBe(status);
    expect((await res.json()).error.code).toBe(code);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('refuses a sign-in from another origin', async () => {
    const res = await fetch(`${base}/session`, {
      method: 'POST',
      headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
      body: JSON.stringify({ idToken: idToken() }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('FORBIDDEN');
  });

  it('requires a session, and the CSRF header for writes', async () => {
    expect((await call(undefined, '/changes?epoch=1&after=0')).status).toBe(401);
    const a = await signIn();
    const res = await call({ ...a, csrf: 'wrong' }, `/items/${randomUUID()}/upload`, {
      method: 'POST',
      body: JSON.stringify({ opId: randomUUID(), epoch: 1, item: describeItem(pdf) }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('FORBIDDEN');
  });

  it('ends the session on sign-out', async () => {
    const a = await signIn();
    expect((await call(a, '/session', { method: 'DELETE' })).status).toBe(204);
    expect((await call(a, '/changes?epoch=1&after=0')).status).toBe(401);
  });

  it('expires sessions', async () => {
    const a = await signIn();
    clock += 13 * 3600;
    expect((await call(a, '/changes?epoch=1&after=0')).status).toBe(401);
  });
});

describe('P04 exact original sync', () => {
  it('returns the uploaded original byte for byte with its metadata', async () => {
    const a = await signIn();
    const { globalId, done } = await upload(a, pdf, randomUUID(), {
      sourceUrl: 'https://iitgn.ac.in/hostel',
    });
    expect(done.status).toBe(200);
    expect((await done.json()).item).toMatchObject({ globalId, revision: 1, deleted: false });

    const laptop = await signIn();
    const feed = await changes(laptop);
    expect(feed.changes).toHaveLength(1);
    expect(feed.changes[0].item).toMatchObject({
      ...describeItem(pdf, { sourceUrl: 'https://iitgn.ac.in/hostel' }),
      globalId,
      revision: 1,
      deleted: false,
    });
    const original = await call(laptop, `/items/${globalId}/original`);
    expect(original.status).toBe(200);
    expect(original.headers.get('content-type')).toBe('application/pdf');
    expect(original.headers.get('cache-control')).toBe('no-store');
    const bytes = new Uint8Array(await original.arrayBuffer());
    expect(bytes.length).toBe(pdf.length);
    expect(sha(bytes)).toBe(sha(pdf));
  });

  it('rejects a completed upload whose bytes do not match the declared hash', async () => {
    const a = await signIn();
    const { done, globalId } = await upload(a, pdf, randomUUID(), {
      contentSha256: 'f'.repeat(64),
    });
    expect(done.status).toBe(422);
    expect((await done.json()).error.code).toBe('HASH_MISMATCH');
    expect((await changes(a)).changes).toHaveLength(0);
    expect((await call(a, `/items/${globalId}/original`)).status).toBe(404);
  });
});

describe('P03 owner isolation', () => {
  it("never shows or changes another account's items", async () => {
    const a = await signIn();
    const { globalId } = await upload(a, pdf);
    const b = await signIn(idToken({ sub: 'subject-b', email: 'student.b@iitgn.ac.in' }));
    expect((await changes(b)).changes).toHaveLength(0);
    expect((await call(b, `/items/${globalId}/original`)).status).toBe(404);
    const rename = await json(b, `/items/${globalId}`, 'PATCH', {
      opId: randomUUID(),
      epoch: b.epoch,
      expectedRevision: 1,
      title: 'Taken over',
    });
    expect(rename.status).toBe(404);
    const del = await json(b, `/items/${globalId}`, 'DELETE', {
      opId: randomUUID(),
      epoch: b.epoch,
      expectedRevision: 1,
    });
    expect(del.status).toBe(404);
    expect((await changes(a)).changes[0].item).toMatchObject({ title: 'Hostel mess rules' });
  });

  it('ignores an ownership field supplied by the client', async () => {
    const b = await signIn(idToken({ sub: 'subject-b', email: 'student.b@iitgn.ac.in' }));
    const globalId = randomUUID();
    const res = await json(b, `/items/${globalId}/upload`, 'POST', {
      opId: randomUUID(),
      epoch: b.epoch,
      ownerKey: 'google:subject-a',
      item: describeItem(pdf),
    });
    expect(res.status).toBe(200);
    const a = await signIn();
    expect(store.uploadOwner((await res.json()).uploadId)).toBe('google:subject-b');
    expect((await changes(a)).changes).toHaveLength(0);
  });
});

describe('P08 idempotent and resumable uploads', () => {
  it('returns the same upload for a repeated begin request', async () => {
    const a = await signIn();
    const globalId = randomUUID();
    const body = { opId: randomUUID(), epoch: a.epoch, item: describeItem(pdf) };
    const first = await (await json(a, `/items/${globalId}/upload`, 'POST', body)).json();
    const again = await (await json(a, `/items/${globalId}/upload`, 'POST', body)).json();
    expect(again.uploadId).toBe(first.uploadId);
  });

  it('does not duplicate an item when completion is retried after a lost response', async () => {
    const a = await signIn();
    const { uploadId, completeOp, globalId } = await upload(a, pdf);
    const retry = await json(a, `/uploads/${uploadId}/complete`, 'POST', {
      opId: completeOp,
      epoch: a.epoch,
    });
    expect(retry.status).toBe(200);
    expect((await retry.json()).item).toMatchObject({ globalId, revision: 1 });
    expect((await changes(a)).changes).toHaveLength(1);
  });

  it('accepts a chunk sent twice and still stores the exact bytes', async () => {
    const a = await signIn();
    const globalId = randomUUID();
    const begin = await json(a, `/items/${globalId}/upload`, 'POST', {
      opId: randomUUID(),
      epoch: a.epoch,
      item: describeItem(pdf),
    });
    const { uploadId, chunkBytes } = await begin.json();
    const put = (n: number) =>
      call(a, `/uploads/${uploadId}/chunks/${n}`, {
        method: 'PUT',
        body: pdf.slice(n * chunkBytes, (n + 1) * chunkBytes),
        headers: { 'content-type': 'application/octet-stream' },
      });
    const count = Math.ceil(pdf.length / chunkBytes);
    for (let n = 0; n < count; n++) await put(n);
    await put(0);
    const done = await json(a, `/uploads/${uploadId}/complete`, 'POST', {
      opId: randomUUID(),
      epoch: a.epoch,
    });
    expect(done.status).toBe(200);
    const bytes = new Uint8Array(
      await (await call(a, `/items/${globalId}/original`)).arrayBuffer(),
    );
    expect(sha(bytes)).toBe(sha(pdf));
  });

  it('refuses an upload that would exceed the account quota', async () => {
    const a = await signIn();
    const res = await json(a, `/items/${randomUUID()}/upload`, 'POST', {
      opId: randomUUID(),
      epoch: a.epoch,
      item: describeItem(pdf, { byteLength: 1_500_000 }),
    });
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe('QUOTA_EXCEEDED');
  });

  it('rejects writes that carry an old vault epoch', async () => {
    const a = await signIn();
    const res = await json(a, `/items/${randomUUID()}/upload`, 'POST', {
      opId: randomUUID(),
      epoch: 7,
      item: describeItem(pdf),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('VAULT_RESET');
  });
});

describe('P09 revisions, conflicts and tombstones', () => {
  it('reports a conflict for a rename from an old revision', async () => {
    const a = await signIn();
    const { globalId } = await upload(a, pdf);
    const first = await json(a, `/items/${globalId}`, 'PATCH', {
      opId: randomUUID(),
      epoch: a.epoch,
      expectedRevision: 1,
      title: 'Mess rules 2026',
    });
    expect(first.status).toBe(200);
    expect((await first.json()).item).toMatchObject({ revision: 2, title: 'Mess rules 2026' });
    const stale = await json(a, `/items/${globalId}`, 'PATCH', {
      opId: randomUUID(),
      epoch: a.epoch,
      expectedRevision: 1,
      title: 'Older rename',
    });
    expect(stale.status).toBe(409);
    const body = await stale.json();
    expect(body.error.code).toBe('REVISION_CONFLICT');
    expect(body.current).toMatchObject({ revision: 2, title: 'Mess rules 2026' });
  });

  it('lets a delete from an old revision win and keeps the item deleted', async () => {
    const a = await signIn();
    const { globalId } = await upload(a, pdf);
    await json(a, `/items/${globalId}`, 'PATCH', {
      opId: randomUUID(),
      epoch: a.epoch,
      expectedRevision: 1,
      title: 'Renamed',
    });
    const del = await json(a, `/items/${globalId}`, 'DELETE', {
      opId: randomUUID(),
      epoch: a.epoch,
      expectedRevision: 1,
    });
    expect(del.status).toBe(200);
    expect((await del.json()).item).toMatchObject({ revision: 3, deleted: true });

    const rename = await json(a, `/items/${globalId}`, 'PATCH', {
      opId: randomUUID(),
      epoch: a.epoch,
      expectedRevision: 3,
      title: 'Back again',
    });
    expect(rename.status).toBe(410);
    expect((await rename.json()).error.code).toBe('ITEM_DELETED');
    const reupload = await json(a, `/items/${globalId}/upload`, 'POST', {
      opId: randomUUID(),
      epoch: a.epoch,
      item: describeItem(pdf),
    });
    expect(reupload.status).toBe(410);
    expect((await call(a, `/items/${globalId}/original`)).status).toBe(404);

    const feed = await changes(a);
    const last = feed.changes.at(-1).item;
    expect(last).toMatchObject({ globalId, revision: 3, deleted: true });
    expect(last).not.toHaveProperty('title');
  });

  it('returns changes after a cursor in commit order', async () => {
    const a = await signIn();
    const one = await upload(a, pdf);
    const all = await changes(a);
    const two = await upload(a, pdf.slice(0, 1000));
    const later = await changes(a, all.cursor);
    expect(later.changes.map((c: { item: { globalId: string } }) => c.item.globalId)).toEqual([
      two.globalId,
    ]);
    expect(later.cursor).toBeGreaterThan(all.cursor);
    expect(all.changes[0].item.globalId).toBe(one.globalId);
  });

  it('asks a client with an old epoch to resynchronise', async () => {
    const a = await signIn();
    const res = await call(a, '/changes?epoch=2&after=0');
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('RESYNC_REQUIRED');
  });
});
