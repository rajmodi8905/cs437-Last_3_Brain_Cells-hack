/// <reference types="node" />
// Phase 1 of docs/pilot/e2ee-design.md: the server stores sealed items, vault encryption
// settings and pairing requests, and checks only what it can check on ciphertext.
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApiClient } from '../client/api';
import {
  E2EE_FORMAT,
  cipherChunkRange,
  deriveVaultKeys,
  keyCheck,
  newItemKey,
  newRecoverySecret,
  newVaultSalt,
  openOriginalChunk,
  sealMeta,
  sealOriginal,
  toBase64url,
  wrapItemKey,
  type SealedMeta,
  type VaultKeys,
} from '../contract/e2ee';
import { liveItems } from '../server/chat/search';
import { MemoryObjectStore, MemoryPilotStore } from '../server/memory';
import { PostgresPilotStore } from '../server/postgres';
import type { ObjectStore, PilotStore, SealedStoredItem, StoredItem } from '../server/store';
import { clock, deviceFetch, idToken, sha256, startPilotServer } from './helpers';

const DATABASE = process.env.PILOT_TEST_DATABASE_URL;
const MARKER = 'zebra-quokka-7731';
const CHUNK = 32 * 1024; // startPilotServer's upload chunk size

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function postgresStore() {
  const store = await PostgresPilotStore.open({
    connectionString: DATABASE!,
    schema: `test_${randomUUID().replaceAll('-', '')}`,
  });
  cleanups.push(async () => {
    await store.dropSchemaForTests();
    await store.close();
  });
  return store;
}

const kinds: [string, () => Promise<PilotStore>][] = [
  ['memory', async () => new MemoryPilotStore()],
  ...(DATABASE ? [['PostgreSQL', postgresStore] as [string, () => Promise<PilotStore>]] : []),
];

/** A signed-in device that speaks the raw protocol, including the new sealed fields. */
async function device(base: string, token = idToken()) {
  const net = deviceFetch();
  const api = createApiClient({ base, fetch: net.fetchImpl });
  const session = await api.signIn(token);
  const call = async (
    method: string,
    path: string,
    body?: unknown,
    raw?: Uint8Array,
    headers: Record<string, string> = {},
  ) => {
    const res = await net.fetchImpl(`${base}${path}`, {
      method,
      headers: {
        'x-recall-csrf': session.csrf,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body:
        (raw as Uint8Array<ArrayBuffer> | undefined) ??
        (body !== undefined ? JSON.stringify(body) : undefined),
    });
    const type = res.headers.get('content-type') ?? '';
    const payload = type.includes('json')
      ? await res.json()
      : new Uint8Array(await res.arrayBuffer());
    return { status: res.status, headers: res.headers, body: payload as any };
  };
  return { api, call, epoch: session.vault.epoch };
}
type Device = Awaited<ReturnType<typeof device>>;

async function turnOn(dev: Device) {
  const secret = newRecoverySecret();
  const vaultSalt = newVaultSalt();
  const keys = await deriveVaultKeys(secret, vaultSalt);
  const check = await keyCheck(keys, dev.epoch);
  const res = await dev.call('PUT', '/vault/e2ee', {
    opId: randomUUID(),
    epoch: dev.epoch,
    vaultSalt: toBase64url(vaultSalt),
    keyCheck: check,
  });
  expect(res.status).toBe(200);
  return { keys, vaultSalt: toBase64url(vaultSalt), keyCheck: check };
}

const meta = (over: Partial<SealedMeta> = {}): SealedMeta => ({
  kind: 'note',
  title: `Locker code ${MARKER}`,
  mimeType: 'text/plain',
  byteLength: 0,
  contentSha256: '0'.repeat(64),
  createdAt: 1_763_000_000_000,
  ...over,
});

/** Seals a note of `length` bytes and uploads it; returns everything a test needs to check. */
async function sealedUpload(dev: Device, keys: VaultKeys, length = 1000) {
  const globalId = randomUUID();
  const plain = new TextEncoder().encode(
    `${MARKER} `.repeat(Math.ceil(length / 18)).slice(0, length),
  );
  const dk = await newItemKey();
  const at = { globalId, epoch: dev.epoch };
  const cipher = await sealOriginal(dk, plain, at);
  const sealed = {
    enc: E2EE_FORMAT,
    wrappedKey: await wrapItemKey(keys, dk),
    sealedMeta: await sealMeta(
      dk,
      meta({ byteLength: plain.length, contentSha256: sha256(plain) }),
      { ...at, metaRevision: 1 },
    ),
    metaRevision: 1,
    cipherByteLength: cipher.length,
    cipherSha256: sha256(cipher),
  };
  const begun = await dev.call('POST', `/items/${globalId}/upload`, {
    opId: randomUUID(),
    epoch: dev.epoch,
    sealed,
  });
  expect(begun.status).toBe(200);
  for (let n = 0; n * CHUNK < cipher.length; n++)
    expect(
      (
        await dev.call(
          'PUT',
          `/uploads/${begun.body.uploadId}/chunks/${n}`,
          undefined,
          cipher.subarray(n * CHUNK, (n + 1) * CHUNK),
        )
      ).status,
    ).toBe(204);
  const done = await dev.call('POST', `/uploads/${begun.body.uploadId}/complete`, {
    opId: randomUUID(),
    epoch: dev.epoch,
  });
  expect(done.status).toBe(200);
  return { globalId, plain, cipher, dk, sealed, item: done.body.item };
}

let pilot: Awaited<ReturnType<typeof startPilotServer>>;
beforeEach(async () => {
  pilot = await startPilotServer();
});
afterEach(() => pilot.close());

describe('E1 a vault turns on end-to-end encryption once per epoch', () => {
  it('stores the vault salt and key check and shows them with the session', async () => {
    const dev = await device(pilot.base);
    expect((await dev.call('GET', '/session')).body.e2ee).toBeUndefined();
    const on = await turnOn(dev);
    expect((await dev.call('GET', '/session')).body.e2ee).toEqual({
      vaultSalt: on.vaultSalt,
      keyCheck: on.keyCheck,
    });
  });

  it('refuses to replace the settings, but answers a retry of the same request', async () => {
    const dev = await device(pilot.base);
    const body = {
      opId: randomUUID(),
      epoch: dev.epoch,
      vaultSalt: toBase64url(newVaultSalt()),
      keyCheck: toBase64url(new Uint8Array(32).fill(1)),
    };
    expect((await dev.call('PUT', '/vault/e2ee', body)).status).toBe(200);
    expect((await dev.call('PUT', '/vault/e2ee', body)).status).toBe(200);
    const other = { ...body, opId: randomUUID(), vaultSalt: toBase64url(newVaultSalt()) };
    const refused = await dev.call('PUT', '/vault/e2ee', other);
    expect(refused.status).toBe(400);
    expect(refused.body.error.code).toBe('INVALID_INPUT');
  });

  it.each([
    ['a short salt', { vaultSalt: toBase64url(new Uint8Array(8)) }],
    ['a short key check', { keyCheck: toBase64url(new Uint8Array(16)) }],
    ['a salt that is not base64url', { vaultSalt: '++++++++++++++++++++++' }],
  ])('rejects %s', async (_, change) => {
    const dev = await device(pilot.base);
    const res = await dev.call('PUT', '/vault/e2ee', {
      opId: randomUUID(),
      epoch: dev.epoch,
      vaultSalt: toBase64url(newVaultSalt()),
      keyCheck: toBase64url(new Uint8Array(32)),
      ...change,
    });
    expect(res.body.error.code).toBe('INVALID_INPUT');
  });

  it('forgets the settings when the cloud library is removed', async () => {
    const dev = await device(pilot.base);
    await turnOn(dev);
    const removed = await dev.call('DELETE', '/vault', {
      confirm: 'remove-cloud-library',
      epoch: dev.epoch,
    });
    expect(removed.status).toBe(200);
    expect((await dev.call('GET', '/session')).body.e2ee).toBeUndefined();
  });
});

describe('E1 sealed items: the server stores ciphertext and no plaintext', () => {
  it('publishes a sealed item with only its public fields', async () => {
    const dev = await device(pilot.base);
    const { keys } = await turnOn(dev);
    const { globalId, sealed, item } = await sealedUpload(dev, keys);
    expect(item).toEqual({ globalId, revision: 1, deleted: false, sealed });
    const feed = await dev.call('GET', `/changes?epoch=${dev.epoch}&after=0`);
    expect(feed.body.changes.map((c: any) => c.item)).toEqual([item]);
  });

  it('keeps no plaintext anywhere in the store, the change feed or the objects', async () => {
    const dev = await device(pilot.base);
    const { keys } = await turnOn(dev);
    const { globalId } = await sealedUpload(dev, keys, 70_000);
    const stored = JSON.stringify(await pilot.store.getAnyItem('google:subject-a', globalId));
    const feed = JSON.stringify((await dev.call('GET', `/changes?epoch=1&after=0`)).body);
    expect(stored).not.toContain(MARKER);
    expect(feed).not.toContain(MARKER);
    for (const key of await pilot.objects.list(''))
      expect(Buffer.from((await pilot.objects.get(key))!).includes(Buffer.from(MARKER))).toBe(
        false,
      );
  });

  it('serves the ciphertext, also in ranges a device can open chunk by chunk', async () => {
    const dev = await device(pilot.base);
    const { keys } = await turnOn(dev);
    const { globalId, plain, cipher, dk } = await sealedUpload(dev, keys, 5000);
    const whole = await dev.call('GET', `/items/${globalId}/original`);
    expect(whole.headers.get('content-type')).toBe('application/octet-stream');
    expect(whole.headers.get('etag')).toBe(`"sha256-${sha256(cipher)}"`);
    expect(Buffer.from(whole.body).equals(Buffer.from(cipher))).toBe(true);
    const range = cipherChunkRange(0, cipher.length)!;
    const part = await dev.call('GET', `/items/${globalId}/original`, undefined, undefined, {
      range: `bytes=${range.start}-${range.end}`,
    });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe(
      `bytes ${range.start}-${range.end}/${cipher.length}`,
    );
    const opened = await openOriginalChunk(dk, part.body, { globalId, epoch: dev.epoch }, 0, true);
    expect(Buffer.from(opened).equals(Buffer.from(plain))).toBe(true);
  });

  it('refuses ciphertext that does not match its declared hash', async () => {
    const dev = await device(pilot.base);
    const { keys } = await turnOn(dev);
    const globalId = randomUUID();
    const cipher = new Uint8Array(200).fill(9);
    const begun = await dev.call('POST', `/items/${globalId}/upload`, {
      opId: randomUUID(),
      epoch: dev.epoch,
      sealed: {
        enc: E2EE_FORMAT,
        wrappedKey: await wrapItemKey(keys, await newItemKey()),
        sealedMeta: toBase64url(new Uint8Array(64)),
        metaRevision: 1,
        cipherByteLength: cipher.length,
        cipherSha256: 'f'.repeat(64),
      },
    });
    await dev.call('PUT', `/uploads/${begun.body.uploadId}/chunks/0`, undefined, cipher);
    const done = await dev.call('POST', `/uploads/${begun.body.uploadId}/complete`, {
      opId: randomUUID(),
      epoch: dev.epoch,
    });
    expect(done.body.error.code).toBe('HASH_MISMATCH');
  });

  it('ignores extra fields a client sends next to the sealed ones (#37)', async () => {
    const dev = await device(pilot.base);
    const { keys } = await turnOn(dev);
    const { globalId, sealed } = await sealedUpload(dev, keys);
    const stored = (await pilot.store.getAnyItem('google:subject-a', globalId)) as SealedStoredItem;
    expect(Object.keys(stored.sealed ?? {}).sort()).toEqual(Object.keys(sealed).sort());
    expect(stored).not.toHaveProperty('title');
  });

  it('refuses a plain upload into an encrypted vault and a sealed one into a plain vault', async () => {
    const plain = await device(pilot.base, idToken({ sub: 'plain-owner' }));
    const refusedSealed = await plain.call('POST', `/items/${randomUUID()}/upload`, {
      opId: randomUUID(),
      epoch: plain.epoch,
      sealed: {
        enc: E2EE_FORMAT,
        wrappedKey: toBase64url(new Uint8Array(40)),
        sealedMeta: toBase64url(new Uint8Array(64)),
        metaRevision: 1,
        cipherByteLength: 216,
        cipherSha256: 'a'.repeat(64),
      },
    });
    expect(refusedSealed.body.error.code).toBe('INVALID_INPUT');

    const dev = await device(pilot.base);
    await turnOn(dev);
    const refusedPlain = await dev.call('POST', `/items/${randomUUID()}/upload`, {
      opId: randomUUID(),
      epoch: dev.epoch,
      item: {
        kind: 'note',
        title: 'Plain note',
        mimeType: 'text/plain',
        byteLength: 5,
        contentSha256: sha256(new TextEncoder().encode('hello')),
        createdAt: 1,
      },
    });
    expect(refusedPlain.body.error.code).toBe('INVALID_INPUT');
  });

  it('counts the ciphertext against the quota', async () => {
    await pilot.close();
    pilot = await startPilotServer(60_000);
    const dev = await device(pilot.base);
    const { keys } = await turnOn(dev);
    await sealedUpload(dev, keys, 50_000);
    const globalId = randomUUID();
    const res = await dev.call('POST', `/items/${globalId}/upload`, {
      opId: randomUUID(),
      epoch: dev.epoch,
      sealed: {
        enc: E2EE_FORMAT,
        wrappedKey: toBase64url(new Uint8Array(40)),
        sealedMeta: toBase64url(new Uint8Array(64)),
        metaRevision: 1,
        cipherByteLength: 20_016,
        cipherSha256: 'a'.repeat(64),
      },
    });
    expect(res.body.error.code).toBe('QUOTA_EXCEEDED');
  });
});

describe('E1 sealed renames, indexes and deletes', () => {
  it('renames by sealing the metadata again under a higher metaRevision', async () => {
    const dev = await device(pilot.base);
    const { keys } = await turnOn(dev);
    const { globalId, dk } = await sealedUpload(dev, keys);
    const sealedMeta = await sealMeta(dk, meta({ title: 'Renamed' }), {
      globalId,
      epoch: dev.epoch,
      metaRevision: 2,
    });
    const renamed = await dev.call('PATCH', `/items/${globalId}`, {
      opId: randomUUID(),
      epoch: dev.epoch,
      expectedRevision: 1,
      sealedMeta,
      metaRevision: 2,
    });
    expect(renamed.status).toBe(200);
    expect(renamed.body.item.revision).toBe(2);
    expect(renamed.body.item.sealed).toMatchObject({ sealedMeta, metaRevision: 2 });

    const stale = await dev.call('PATCH', `/items/${globalId}`, {
      opId: randomUUID(),
      epoch: dev.epoch,
      expectedRevision: 1,
      sealedMeta,
      metaRevision: 3,
    });
    expect(stale.body.error.code).toBe('REVISION_CONFLICT');
    const backwards = await dev.call('PATCH', `/items/${globalId}`, {
      opId: randomUUID(),
      epoch: dev.epoch,
      expectedRevision: 2,
      sealedMeta,
      metaRevision: 2,
    });
    expect(backwards.body.error.code).toBe('INVALID_INPUT');
    const plainRename = await dev.call('PATCH', `/items/${globalId}`, {
      opId: randomUUID(),
      epoch: dev.epoch,
      expectedRevision: 2,
      title: 'Plain title',
    });
    expect(plainRename.body.error.code).toBe('INVALID_INPUT');
  });

  it('stores a sealed index for the current metaRevision and serves it as is', async () => {
    const dev = await device(pilot.base);
    const { keys } = await turnOn(dev);
    const { globalId } = await sealedUpload(dev, keys);
    const index = new Uint8Array(300).fill(4);
    const put = await dev.call('PUT', `/items/${globalId}/index`, {
      opId: randomUUID(),
      epoch: dev.epoch,
      sealedIndex: toBase64url(index),
      metaRevision: 1,
    });
    expect(put.status).toBe(200);
    expect(put.body.item.sealedIndex).toEqual({ metaRevision: 1, byteLength: 300 });
    const got = await dev.call('GET', `/items/${globalId}/index`);
    expect(got.headers.get('content-type')).toBe('application/octet-stream');
    expect(Buffer.from(got.body).equals(Buffer.from(index))).toBe(true);

    const wrongRevision = await dev.call('PUT', `/items/${globalId}/index`, {
      opId: randomUUID(),
      epoch: dev.epoch,
      sealedIndex: toBase64url(index),
      metaRevision: 2,
    });
    expect(wrongRevision.body.error.code).toBe('INDEX_INCOMPATIBLE');
    const plainBundle = await dev.call('PUT', `/items/${globalId}/index`, {
      opId: randomUUID(),
      epoch: dev.epoch,
      bundle: { globalId },
    });
    expect(plainBundle.body.error.code).toBe('INVALID_INPUT');
  });

  it('deletes a sealed item to a bare tombstone and removes its objects', async () => {
    const dev = await device(pilot.base);
    const { keys } = await turnOn(dev);
    const { globalId } = await sealedUpload(dev, keys);
    await dev.call('PUT', `/items/${globalId}/index`, {
      opId: randomUUID(),
      epoch: dev.epoch,
      sealedIndex: toBase64url(new Uint8Array(100)),
      metaRevision: 1,
    });
    const deleted = await dev.call('DELETE', `/items/${globalId}`, {
      opId: randomUUID(),
      epoch: dev.epoch,
      expectedRevision: 1,
    });
    expect(deleted.body.item).toEqual({ globalId, revision: 2, deleted: true });
    const stored = await pilot.store.getAnyItem('google:subject-a', globalId);
    expect(stored).not.toHaveProperty('sealed');
    expect(await pilot.objects.list('google:')).toEqual([]);
  });
});

describe('E6 the bot never sees sealed items', () => {
  it('hides sealed items from getItem and the bot search list, but not plain ones', async () => {
    const dev = await device(pilot.base);
    const { keys } = await turnOn(dev);
    const { globalId } = await sealedUpload(dev, keys);
    const owner = 'google:subject-a';
    const botItem: StoredItem = {
      globalId: randomUUID(),
      kind: 'note',
      title: 'Sent through Telegram',
      mimeType: 'text/plain',
      byteLength: 5,
      contentSha256: 'b'.repeat(64),
      createdAt: 1,
      revision: 1,
      deleted: false,
    };
    await pilot.store.publish(owner, botItem, dev.epoch);
    expect(await pilot.store.getItem(owner, globalId)).toBeUndefined();
    expect((await liveItems(pilot.store, owner)).map((item) => item.globalId)).toEqual([
      botItem.globalId,
    ]);
  });
});

describe('E5 pairing gives a new device the encrypted recovery secret', () => {
  const pubKey = (fill: number) => toBase64url(new Uint8Array(65).fill(fill));

  async function twoDevices() {
    const old = await device(pilot.base);
    await turnOn(old);
    const fresh = await device(pilot.base);
    return { old, fresh };
  }

  it('passes the sealed secret from the old device to the new one, once', async () => {
    const { old, fresh } = await twoDevices();
    const started = await fresh.call('POST', '/pairing', { publicKey: pubKey(1) });
    expect(started.status).toBe(200);
    expect(started.body.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(started.body.expiresAt).toBe(clock.now + 600);

    const waiting = await fresh.call('GET', `/pairing/${started.body.pairingId}`);
    expect(waiting.body).toEqual({ status: 'waiting' });

    const claimed = await old.call('POST', '/pairing/claim', {
      code: started.body.code.toLowerCase(),
    });
    expect(claimed.body).toEqual({ pairingId: started.body.pairingId, publicKey: pubKey(1) });

    const sealedSecret = toBase64url(new Uint8Array(44).fill(5));
    const sent = await old.call('PUT', `/pairing/${started.body.pairingId}/secret`, {
      publicKey: pubKey(2),
      sealedSecret,
    });
    expect(sent.status).toBe(204);

    const ready = await fresh.call('GET', `/pairing/${started.body.pairingId}`);
    expect(ready.body).toEqual({ status: 'ready', publicKey: pubKey(2), sealedSecret });
    expect((await fresh.call('GET', `/pairing/${started.body.pairingId}`)).status).toBe(404);
  });

  it('keeps pairing inside one account', async () => {
    const { fresh } = await twoDevices();
    const started = await fresh.call('POST', '/pairing', { publicKey: pubKey(1) });
    const stranger = await device(pilot.base, idToken({ sub: 'someone-else' }));
    await turnOn(stranger);
    const claim = await stranger.call('POST', '/pairing/claim', { code: started.body.code });
    expect(claim.status).toBe(404);
    expect((await stranger.call('GET', `/pairing/${started.body.pairingId}`)).status).toBe(404);
  });

  it('needs encryption to be on, a valid key, and a code that has not expired', async () => {
    const plain = await device(pilot.base, idToken({ sub: 'plain-owner' }));
    expect((await plain.call('POST', '/pairing', { publicKey: pubKey(1) })).status).toBe(400);
    const { old, fresh } = await twoDevices();
    expect((await fresh.call('POST', '/pairing', { publicKey: 'short' })).status).toBe(400);
    const started = await fresh.call('POST', '/pairing', { publicKey: pubKey(1) });
    const at = clock.now;
    try {
      clock.now = at + 601;
      expect((await old.call('POST', '/pairing/claim', { code: started.body.code })).status).toBe(
        404,
      );
    } finally {
      clock.now = at;
    }
  });

  it('limits wrong codes for an account', async () => {
    const { old, fresh } = await twoDevices();
    const started = await fresh.call('POST', '/pairing', { publicKey: pubKey(1) });
    let limited = false;
    for (let i = 0; i < 12 && !limited; i++) {
      const res = await old.call('POST', '/pairing/claim', { code: 'ZZZZZZZZ' });
      limited = res.status === 429;
    }
    expect(limited).toBe(true);
    const right = await old.call('POST', '/pairing/claim', { code: started.body.code });
    expect(right.status).toBe(429);
  });
});

describe.each(kinds)('E1 sealed items and vault settings in the %s store', (_, open) => {
  let store: PilotStore;
  let objects: ObjectStore;
  beforeEach(async () => {
    store = await open();
    objects = new MemoryObjectStore();
  });

  it('round-trips a sealed item and keeps it out of getItem', async () => {
    const owner = 'google:store-owner';
    const { epoch } = await store.vault(owner);
    const sealed = {
      enc: E2EE_FORMAT as typeof E2EE_FORMAT,
      wrappedKey: toBase64url(new Uint8Array(40)),
      sealedMeta: toBase64url(new Uint8Array(64)),
      metaRevision: 1,
      cipherByteLength: 216,
      cipherSha256: 'a'.repeat(64),
    };
    const item = { globalId: randomUUID(), revision: 1, deleted: false, byteLength: 216, sealed };
    await store.publish(owner, item, epoch);
    expect(await store.getAnyItem(owner, item.globalId)).toEqual(item);
    expect(await store.getItem(owner, item.globalId)).toBeUndefined();
    expect(await store.committedBytes(owner)).toBe(216);
    void objects;
  });

  it('sets vault settings once per epoch and clears them on reset', async () => {
    const owner = 'google:store-owner';
    const { epoch } = await store.vault(owner);
    const settings = { vaultSalt: 'salt-a', keyCheck: 'check-a' };
    expect(await store.setVaultE2ee(owner, epoch, settings)).toBe('set');
    expect(await store.setVaultE2ee(owner, epoch, settings)).toBe('same');
    expect(await store.setVaultE2ee(owner, epoch, { ...settings, keyCheck: 'other' })).toBe(
      'conflict',
    );
    expect(await store.setVaultE2ee(owner, epoch + 1, settings)).toBe('reset');
    expect(await store.vaultE2ee(owner)).toEqual(settings);
    await store.resetVault(owner);
    expect(await store.vaultE2ee(owner)).toBeUndefined();
  });

  it('keeps pairings until they are taken or expire', async () => {
    const pairing = {
      pairingId: randomUUID(),
      ownerKey: 'google:store-owner',
      codeHash: 'h'.repeat(64),
      newPublicKey: 'new-key',
      expiresAt: 1000,
    };
    await store.createPairing(pairing);
    expect(await store.findPairing('google:store-owner', 'h'.repeat(64))).toEqual(pairing);
    expect(await store.findPairing('google:other', 'h'.repeat(64))).toBeUndefined();
    const answered = { ...pairing, oldPublicKey: 'old-key', sealedSecret: 'sealed' };
    await store.updatePairing(answered);
    expect(await store.getPairing(pairing.pairingId)).toEqual(answered);
    await store.deletePairing(pairing.pairingId);
    expect(await store.getPairing(pairing.pairingId)).toBeUndefined();
    await store.createPairing({ ...pairing, pairingId: randomUUID(), expiresAt: 10 });
    await store.cleanUp({ now: 20, abandonedBefore: 0, finishedBefore: 0, responsesBefore: 0 });
    expect(await store.findPairing('google:store-owner', 'h'.repeat(64))).toBeUndefined();
  });
});
