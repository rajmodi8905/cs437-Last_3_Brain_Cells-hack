/// <reference types="node" />
// Fixes from the CS437 code review (issue #44): delete order, sign-in routes, plain-text types,
// upload ownership, index storage and hashed session cookies.
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PILOT_INDEX_VERSIONS,
  searchMetadataDigest,
  validateCloudItem,
  type CloudItem,
} from '../contract';
import { MemoryPilotStore } from '../server/memory';
import type { StoredItem } from '../server/store';
import { devSigner, idToken, origin, sha256, startPilotServer } from './helpers';

let pilot: Awaited<ReturnType<typeof startPilotServer>> | undefined;
afterEach(async () => {
  await pilot?.close();
  pilot = undefined;
});

/** Fails the next tombstone write once, as a database outage during a delete would. */
class FailingDeleteStore extends MemoryPilotStore {
  failNextDelete = false;
  override async publish(ownerKey: string, item: StoredItem, epoch: number) {
    if (this.failNextDelete && item.deleted) {
      this.failNextDelete = false;
      throw new Error('database unavailable');
    }
    return super.publish(ownerKey, item, epoch);
  }
}

interface Session {
  cookie: string;
  csrf: string;
  epoch: number;
}
async function signIn(token = idToken()): Promise<Session> {
  const res = await fetch(`${pilot!.base}/session`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ idToken: token }),
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0];
  return { cookie, csrf: body.csrf, epoch: body.vault.epoch };
}
const call = (s: Session, path: string, init: RequestInit = {}) =>
  fetch(`${pilot!.base}${path}`, {
    ...init,
    headers: {
      origin,
      cookie: s.cookie,
      'x-recall-csrf': s.csrf,
      ...(typeof init.body === 'string' ? { 'content-type': 'application/json' } : {}),
      ...((init.headers as Record<string, string>) ?? {}),
    },
  });
const json = (s: Session, path: string, method: string, body: unknown) =>
  call(s, path, { method, body: JSON.stringify(body) });

const pdf = new TextEncoder().encode('%PDF-1.4\n' + 'Guests need a pass. '.repeat(500));
const describeItem = (bytes: Uint8Array, over: Record<string, unknown> = {}) => ({
  kind: 'pdf' as const,
  title: 'Hostel mess rules',
  mimeType: 'application/pdf',
  byteLength: bytes.length,
  contentSha256: sha256(bytes),
  createdAt: 1_762_000_000_000,
  ...over,
});
async function begin(s: Session, bytes = pdf, over: Record<string, unknown> = {}) {
  const globalId = randomUUID();
  const res = await json(s, `/items/${globalId}/upload`, 'POST', {
    opId: randomUUID(),
    epoch: s.epoch,
    item: describeItem(bytes, over),
  });
  expect(res.status).toBe(200);
  const { uploadId, chunkBytes } = (await res.json()) as { uploadId: string; chunkBytes: number };
  return { globalId, uploadId, chunkBytes };
}
const putChunks = async (
  s: Session,
  started: { uploadId: string; chunkBytes: number },
  bytes = pdf,
) => {
  for (let n = 0, at = 0; at < bytes.length; n++, at += started.chunkBytes)
    expect(
      (
        await call(s, `/uploads/${started.uploadId}/chunks/${n}`, {
          method: 'PUT',
          body: bytes.slice(at, at + started.chunkBytes),
          headers: { 'content-type': 'application/octet-stream' },
        })
      ).status,
    ).toBe(204);
};
const complete = (s: Session, uploadId: string) =>
  json(s, `/uploads/${uploadId}/complete`, 'POST', { opId: randomUUID(), epoch: s.epoch });
async function uploaded(s: Session, bytes = pdf, over: Record<string, unknown> = {}) {
  const started = await begin(s, bytes, over);
  await putChunks(s, started, bytes);
  const done = await complete(s, started.uploadId);
  expect(done.status).toBe(200);
  return { ...started, item: ((await done.json()) as { item: CloudItem }).item };
}

describe('#44 deleting an item publishes the tombstone before removing blobs', () => {
  it('keeps the original readable when the tombstone cannot be written, and a retry finishes', async () => {
    const store = new FailingDeleteStore();
    pilot = await startPilotServer(5_000_000, { store });
    const a = await signIn();
    const { globalId } = await uploaded(a);
    const opId = randomUUID();
    store.failNextDelete = true;
    const failed = await json(a, `/items/${globalId}`, 'DELETE', {
      opId,
      epoch: a.epoch,
      expectedRevision: 1,
    });
    expect(failed.status).toBe(500);

    const original = await call(a, `/items/${globalId}/original`);
    expect(original.status).toBe(200);
    expect(sha256(new Uint8Array(await original.arrayBuffer()))).toBe(sha256(pdf));

    const retried = await json(a, `/items/${globalId}`, 'DELETE', {
      opId,
      epoch: a.epoch,
      expectedRevision: 1,
    });
    expect(retried.status).toBe(200);
    expect((await call(a, `/items/${globalId}/original`)).status).toBe(404);
    expect(await pilot.objects.list(`google:subject-a/`)).toEqual([]);
  });
});

describe('#44 POST /session with a raw ID token', () => {
  it('is not offered when Google sign-in is on', async () => {
    pilot = await startPilotServer(5_000_000, {
      google: { clientSecret: 'client-secret', fetch: () => Promise.reject(new Error('unused')) },
    });
    expect(await (await fetch(`${pilot.base}/config`)).json()).toEqual({ signIn: 'google' });
    const res = await fetch(`${pilot.base}/session`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ idToken: idToken() }),
    });
    expect(res.status).toBe(404);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('still works with the development signer', async () => {
    pilot = await startPilotServer(5_000_000, { devSigner });
    await signIn(devSigner('student@iitgn.ac.in'));
  });
});

describe('#44 plain-text MIME types', () => {
  const note = (mimeType: string) =>
    validateCloudItem({
      globalId: randomUUID(),
      kind: 'note',
      title: 'Lab notes',
      mimeType,
      byteLength: 10,
      contentSha256: sha256(new Uint8Array([1])),
      createdAt: 1_762_000_000_000,
    });

  it('accepts text/plain, optionally declared as UTF-8', () => {
    for (const type of [
      'text/plain',
      'text/plain;charset=utf-8',
      'text/plain; charset=utf-8',
      'Text/Plain; Charset=UTF-8',
      'text/plain; charset="utf-8"',
    ])
      expect(note(type), type).toEqual({ ok: true, value: true });
  });

  it('rejects anything that only starts with text/plain', () => {
    for (const type of [
      'text/plain,text/html',
      'text/plainx',
      'text/plain; charset=iso-8859-1',
      'text/plain; charset=utf-8; x=y',
      'text/plain; charset=utf-8, text/html',
      ' text/plain',
    ])
      expect(note(type), type).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
  });

  it('refuses such a type at upload', async () => {
    pilot = await startPilotServer();
    const a = await signIn();
    const text = new TextEncoder().encode('<script>alert(1)</script>');
    const res = await json(a, `/items/${randomUUID()}/upload`, 'POST', {
      opId: randomUUID(),
      epoch: a.epoch,
      item: describeItem(text, { kind: 'note', mimeType: 'text/plain,text/html' }),
    });
    expect(res.status).toBe(400);
  });

  it('serves originals as sandboxed attachments, whole or in part', async () => {
    pilot = await startPilotServer();
    const a = await signIn();
    const text = new TextEncoder().encode('Mess menu: paneer on Friday.');
    const { globalId } = await uploaded(a, text, {
      kind: 'note',
      mimeType: 'text/plain;charset=utf-8',
    });
    for (const headers of [{}, { range: 'bytes=0-3' }] as Record<string, string>[]) {
      const res = await call(a, `/items/${globalId}/original`, { headers });
      expect([200, 206]).toContain(res.status);
      expect(res.headers.get('content-type')).toBe('text/plain;charset=utf-8');
      expect(res.headers.get('content-disposition')).toBe('attachment');
      expect(res.headers.get('content-security-policy')).toBe("sandbox; default-src 'none'");
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    }
  });
});

describe('#44 upload ownership and write origin', () => {
  it("does not let another account send chunks to someone else's upload", async () => {
    pilot = await startPilotServer();
    const a = await signIn();
    const b = await signIn(idToken({ sub: 'subject-b', email: 'student.b@iitgn.ac.in' }));
    const started = await begin(a);
    const chunk = await call(b, `/uploads/${started.uploadId}/chunks/0`, {
      method: 'PUT',
      body: pdf.slice(0, started.chunkBytes),
      headers: { 'content-type': 'application/octet-stream' },
    });
    expect(chunk.status).toBe(404);
    expect((await chunk.json()).error.code).toBe('NOT_FOUND');
    expect(await pilot.store.receivedChunks(started.uploadId)).toEqual([]);
  });

  it("does not let another account complete someone else's upload", async () => {
    pilot = await startPilotServer();
    const a = await signIn();
    const b = await signIn(idToken({ sub: 'subject-b', email: 'student.b@iitgn.ac.in' }));
    const started = await begin(a);
    await putChunks(a, started);
    const stolen = await complete(b, started.uploadId);
    expect(stolen.status).toBe(404);
    expect((await stolen.json()).error.code).toBe('NOT_FOUND');
    const feedB = await (await call(b, `/changes?epoch=${b.epoch}&after=0`)).json();
    expect(feedB.changes).toEqual([]);
    // A's upload is untouched and still completes.
    expect((await complete(a, started.uploadId)).status).toBe(200);
  });

  it('refuses a write with a valid CSRF token from another origin', async () => {
    pilot = await startPilotServer();
    const a = await signIn();
    const { globalId } = await uploaded(a);
    const body = JSON.stringify({ opId: randomUUID(), epoch: a.epoch, title: 'Renamed' });
    const foreign = await call(a, `/items/${globalId}`, {
      method: 'PATCH',
      body,
      headers: { origin: 'https://evil.example' },
    });
    expect(foreign.status).toBe(403);
    expect((await foreign.json()).error.code).toBe('FORBIDDEN');
    expect((await pilot.store.getItem('google:subject-a', globalId))?.title).toBe(
      'Hostel mess rules',
    );
  });
});

describe('#44 index bundles are stored as received', () => {
  it('keeps the bundle bytes exactly as sent, whatever the layout of the body', async () => {
    pilot = await startPilotServer();
    const a = await signIn();
    const { globalId } = await uploaded(a);
    const bundle = {
      globalId,
      contentSha256: sha256(pdf),
      searchMetadataDigest: await searchMetadataDigest({ title: 'Hostel mess rules' }),
      indexVersion: PILOT_INDEX_VERSIONS[0],
      dimension: 768,
      segments: [
        {
          modality: 'text',
          location: { kind: 'page', page: 2 },
          text: 'Guests need a pass, "quoted" \\ and {braced} – café.',
          vector: Array.from({ length: 768 }, (_, i) => (i === 3 ? 1.0 : 0)),
        },
      ],
    };
    // Bundle first and pretty-printed, a decoy `bundle` deeper down, and a different layout
    // from what JSON.stringify would produce.
    const sent = JSON.stringify(bundle, null, 2);
    const body = `{ "bundle" : ${sent} ,\n "opId": "${randomUUID()}", "epoch": ${a.epoch}, "extra": {"bundle": "decoy"} }`;
    const res = await call(a, `/items/${globalId}/index`, { method: 'PUT', body });
    expect(res.status).toBe(200);
    const stored = await pilot.store.getItem('google:subject-a', globalId);
    const bytes = await pilot.objects.get(stored!.indexObjectKey!);
    expect(new TextDecoder().decode(bytes)).toBe(sent);
    expect(stored!.indexBytes).toBe(new TextEncoder().encode(sent).length);
    const served = await call(a, `/items/${globalId}/index`);
    expect(await served.json()).toEqual(bundle);
  });

  it('rejects an index body that is not valid UTF-8', async () => {
    pilot = await startPilotServer();
    const a = await signIn();
    const { globalId } = await uploaded(a);
    const prefix = new TextEncoder().encode(`{"opId":"${randomUUID()}","epoch":${a.epoch},"x":"`);
    const body = new Uint8Array([...prefix, 0xff, 0x22, 0x7d]);
    const res = await call(a, `/items/${globalId}/index`, { method: 'PUT', body });
    expect(res.status).toBe(400);
  });
});

describe('#44 session and sign-in cookies are stored only as hashes', () => {
  it('stores the SHA-256 of the session cookie, never the cookie itself', async () => {
    pilot = await startPilotServer();
    const a = await signIn();
    const value = a.cookie.split('=').slice(1).join('=');
    expect(await pilot.store.getSession(value)).toBeUndefined();
    const stored = await pilot.store.getSession(sha256(new TextEncoder().encode(value)));
    expect(stored?.email).toBe('student.a@iitgn.ac.in');
    expect((await call(a, '/session')).status).toBe(200);
    expect((await call(a, '/session', { method: 'DELETE' })).status).toBe(204);
    expect(await pilot.store.getSession(stored!.id)).toBeUndefined();
  });

  it('stores the SHA-256 of the sign-in attempt cookie', async () => {
    pilot = await startPilotServer(5_000_000, {
      google: { clientSecret: 'client-secret', fetch: () => Promise.reject(new Error('unused')) },
    });
    const start = await fetch(`${pilot.base}/auth/google/start`, { redirect: 'manual' });
    expect(start.status).toBe(302);
    const value = /recall_login=([^;]+)/.exec(start.headers.get('set-cookie') ?? '')![1];
    expect(await pilot.store.takeLoginAttempt(value)).toBeUndefined();
    const attempt = await pilot.store.takeLoginAttempt(sha256(new TextEncoder().encode(value)));
    expect(attempt?.state).toBe(new URL(start.headers.get('location')!).searchParams.get('state'));
  });
});
