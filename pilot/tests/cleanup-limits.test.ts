/// <reference types="node" />
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { createApiClient } from '../client/api';
import { MemoryLocalLibrary, MemorySyncStateStore } from '../client/memory';
import { SyncEngine } from '../client/sync';
import { clock, deviceFetch, idToken, origin, sha256, startPilotServer } from './helpers';

let pilot: Awaited<ReturnType<typeof startPilotServer>> | undefined;
const startedAt = clock.now;
afterEach(async () => {
  clock.now = startedAt;
  await pilot?.close();
  pilot = undefined;
});

const DAY = 24 * 3600;
const pdf = new TextEncoder().encode('%PDF-1.4\n' + 'Guests need a pass. '.repeat(4000));
const describePdf = () => ({
  kind: 'pdf' as const,
  title: 'Hostel rules',
  mimeType: 'application/pdf',
  byteLength: pdf.length,
  contentSha256: sha256(pdf),
  createdAt: 1,
});

async function signedIn(token = idToken()) {
  const net = deviceFetch();
  const api = createApiClient({ base: pilot!.base, fetch: net.fetchImpl });
  const { vault } = await api.signIn(token);
  return { net, api, epoch: vault.epoch };
}

describe('Clean-up of abandoned and expired data', () => {
  it('expires an upload left unfinished for a day and frees its quota and staged chunks', async () => {
    pilot = await startPilotServer();
    const { api, epoch } = await signedIn();
    const begun = await api.beginUpload(randomUUID(), {
      opId: randomUUID(),
      epoch,
      item: describePdf(),
    });
    await api.putChunk(begun.uploadId, 0, pdf.slice(0, begun.chunkBytes));
    expect(await pilot.store.committedBytes('google:subject-a')).toBe(pdf.length);

    clock.now += DAY + 1;
    await api.signIn(idToken());
    // Refused even before the sweep runs.
    await expect(
      api.putChunk(begun.uploadId, 1, pdf.slice(begun.chunkBytes, 2 * begun.chunkBytes)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await pilot.cleanUp();
    expect(await pilot.store.getUpload(begun.uploadId)).toBeUndefined();
    expect(await pilot.objects.get(`staging/${begun.uploadId}/0`)).toBeUndefined();
    expect(await pilot.store.committedBytes('google:subject-a')).toBe(0);
  });

  it('removes expired sessions, so the cookie no longer works', async () => {
    pilot = await startPilotServer();
    const { api } = await signedIn();
    clock.now += 13 * 3600;
    await pilot.cleanUp();
    expect(await api.restoreSession()).toBeUndefined();
  });

  it('a device restarts an upload that expired on the server and the item arrives once', async () => {
    pilot = await startPilotServer();
    const { net, api, epoch } = await signedIn();
    const library = new MemoryLocalLibrary();
    const engine = new SyncEngine({
      api,
      library,
      state: new MemorySyncStateStore(),
      libraryId: 'l',
    });
    await engine.include(epoch);
    library.add({ kind: 'pdf', title: 'Hostel rules', mimeType: 'application/pdf' }, pdf);
    // The upload starts, then the network drops before any chunk is sent.
    net.controls.loseResponse = /^PUT \/uploads\//;
    await engine.runOnce();
    net.controls.down = true;
    await engine.runOnce();
    net.controls.down = false;

    clock.now += DAY + 1;
    await pilot.cleanUp();
    // Sessions last 12 hours; the device signs in again.
    await api.signIn(idToken());
    expect((await engine.runOnce()).uploaded).toBe(1);
    const [item] = await engine.catalogue();
    expect(sha256(await engine.download(item.globalId))).toBe(sha256(pdf));
    expect((await api.changes(epoch, 0)).changes).toHaveLength(1);
  });

  it('keeps finished uploads and saved results long enough to answer retries', async () => {
    pilot = await startPilotServer();
    const { api, epoch } = await signedIn();
    const begun = await api.beginUpload(randomUUID(), {
      opId: randomUUID(),
      epoch,
      item: describePdf(),
    });
    for (let n = 0; n * begun.chunkBytes < pdf.length; n++)
      await api.putChunk(
        begun.uploadId,
        n,
        pdf.slice(n * begun.chunkBytes, (n + 1) * begun.chunkBytes),
      );
    const first = await api.completeUpload(begun.uploadId, { opId: randomUUID(), epoch });
    clock.now += 2 * DAY;
    await pilot.cleanUp();
    await api.signIn(idToken());
    expect(await api.completeUpload(begun.uploadId, { opId: randomUUID(), epoch })).toEqual(first);
  });
});

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${pilot!.base}${path}`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

describe('Rate limits', () => {
  it('limits sign-in attempts per address and lets them through again later', async () => {
    pilot = await startPilotServer(5_000_000, { limits: { signInBurst: 3, signInPerMinute: 3 } });
    for (let i = 0; i < 3; i++)
      expect((await post('/session', { idToken: idToken() })).status).toBe(200);
    const limited = await post('/session', { idToken: idToken() });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toMatch(/^\d+$/);
    expect(await limited.json()).toMatchObject({
      error: { code: 'RATE_LIMITED', retryable: true },
    });
    clock.now += 60;
    expect((await post('/session', { idToken: idToken() })).status).toBe(200);
  });

  it('limits each account separately', async () => {
    pilot = await startPilotServer(5_000_000, {
      limits: { accountBurst: 5, accountPerSecond: 1, signInBurst: 10, signInPerMinute: 10 },
    });
    const a = await signedIn();
    const b = await signedIn(idToken({ sub: 'subject-b', email: 'b@iitgn.ac.in' }));
    for (let i = 0; i < 5; i++) await a.api.changes(a.epoch, 0);
    await expect(a.api.changes(a.epoch, 0)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
    });
    await expect(b.api.changes(b.epoch, 0)).resolves.toBeDefined();
    clock.now += 2;
    await expect(a.api.changes(a.epoch, 0)).resolves.toBeDefined();
  });

  it('believes a forwarded client address only behind a configured proxy', async () => {
    const limits = { signInBurst: 1, signInPerMinute: 1 };
    pilot = await startPilotServer(5_000_000, { limits });
    expect(
      (await post('/session', { idToken: idToken() }, { 'x-forwarded-for': '10.0.0.1' })).status,
    ).toBe(200);
    // Without a trusted proxy, a made-up header does not buy another attempt.
    expect(
      (await post('/session', { idToken: idToken() }, { 'x-forwarded-for': '10.0.0.2' })).status,
    ).toBe(429);
    await pilot.close();

    pilot = await startPilotServer(5_000_000, { limits, trustProxy: true });
    expect(
      (await post('/session', { idToken: idToken() }, { 'x-forwarded-for': '10.0.0.1' })).status,
    ).toBe(200);
    expect(
      (await post('/session', { idToken: idToken() }, { 'x-forwarded-for': '10.0.0.2' })).status,
    ).toBe(200);
    expect(
      (await post('/session', { idToken: idToken() }, { 'x-forwarded-for': '10.0.0.2' })).status,
    ).toBe(429);
    // The proxy appends the real address last; a client cannot hide behind an earlier entry.
    expect(
      (await post('/session', { idToken: idToken() }, { 'x-forwarded-for': '10.0.0.9, 10.0.0.2' }))
        .status,
    ).toBe(429);
  });

  it('a device treats a rate limit as "later", not as a failed item', async () => {
    pilot = await startPilotServer(5_000_000, {
      limits: { accountBurst: 4, accountPerSecond: 1, signInBurst: 10, signInPerMinute: 10 },
    });
    const { api, epoch } = await signedIn();
    const library = new MemoryLocalLibrary();
    const state = new MemorySyncStateStore();
    const engine = new SyncEngine({ api, library, state, libraryId: 'l' });
    await engine.include(epoch);
    library.add({ kind: 'pdf', title: 'Hostel rules', mimeType: 'application/pdf' }, pdf);
    const first = await engine.runOnce();
    expect(first.uploaded).toBe(0);
    expect(first.failed).toBeGreaterThan(0);
    expect((await state.load()).mappings[0].state).toBe('pending');

    for (let pass = 0; pass < 20 && (await engine.catalogue()).length === 0; pass++) {
      clock.now += 10;
      await engine.runOnce();
    }
    const [item] = await engine.catalogue();
    expect(sha256(await engine.download(item.globalId))).toBe(sha256(pdf));
  });
});
