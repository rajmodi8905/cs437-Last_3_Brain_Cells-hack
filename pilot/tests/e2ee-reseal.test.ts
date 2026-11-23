/// <reference types="node" />
// Phase 4 of docs/pilot/e2ee-design.md: turning encryption on for a library that already has
// plain items seals them in place, leaves no plaintext on the server, and keeps bot items plain.
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiFailure, createApiClient } from '../client/api';
import {
  MemoryLocalLibrary,
  MemoryOfflineStore,
  MemoryRemoteIndexStore,
  MemorySyncStateStore,
  MemoryVaultSecretStore,
} from '../client/memory';
import { SyncEngine } from '../client/sync';
import { PILOT_INDEX_VERSIONS } from '../contract';
import { E2EE_FORMAT, toBase64url } from '../contract/e2ee';
import { createPilotHandler } from '../server/app';
import { MemoryObjectStore, MemoryPilotStore } from '../server/memory';
import { PostgresPilotStore } from '../server/postgres';
import {
  publicItem,
  type PilotStore,
  type SealedStoredItem,
  type StoredItem,
} from '../server/store';
import { MemoryTelegramStore } from '../server/telegram/store';
import { staticKeySource } from '../server/tokens';
import { clientId, clock, deviceFetch, idToken, origin, sha256 } from './helpers';

const DATABASE = process.env.PILOT_TEST_DATABASE_URL;
const OWNER = 'google:subject-a';
const MARKER = 'zebra-quokka-7731';
const version = PILOT_INDEX_VERSIONS[0];
const text = (value: string) => new TextEncoder().encode(value);
const unit = (axis: number) => Float32Array.from({ length: 768 }, (_, i) => (i === axis ? 1 : 0));
const segments = (axis: number) => [
  {
    modality: 'text' as const,
    location: { kind: 'page' as const, page: 1 },
    text: `The locker code is ${MARKER}.`,
    vector: unit(axis),
  },
  { modality: 'visual' as const, location: { kind: 'whole' as const }, vector: unit(axis + 1) },
];

// A pilot server with a Telegram store, so items saved through the bot can be recorded.
const signing = generateKeyPairSync('rsa', { modulusLength: 2048 });
const token = (over: Record<string, unknown> = {}) => idToken(over, signing.privateKey);
let pilot: {
  base: string;
  store: MemoryPilotStore;
  objects: MemoryObjectStore;
  telegram: MemoryTelegramStore;
  close: () => Promise<void>;
};
beforeEach(async () => {
  const store = new MemoryPilotStore();
  const objects = new MemoryObjectStore();
  const telegram = new MemoryTelegramStore();
  const server: Server = createServer(
    createPilotHandler({
      clientId,
      allowedEmailDomain: 'iitgn.ac.in',
      origin,
      keys: staticKeySource({ 'test-key': signing.publicKey }),
      store,
      objects,
      nowSeconds: () => clock.now,
      limits: { signInBurst: 1000 },
      quotaBytes: 5_000_000,
      chunkBytes: 32 * 1024,
      telegram: { state: telegram },
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  pilot = {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`,
    store,
    objects,
    telegram,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
});
afterEach(() => pilot.close());

async function device() {
  const net = deviceFetch();
  const api = createApiClient({ base: pilot.base, fetch: net.fetchImpl });
  const library = new MemoryLocalLibrary();
  const state = new MemorySyncStateStore();
  const engine = new SyncEngine({
    api,
    library,
    state,
    remoteIndex: new MemoryRemoteIndexStore(),
    offline: new MemoryOfflineStore(),
    vaultSecret: new MemoryVaultSecretStore(),
    libraryId: 'library',
  });
  const session = await api.signIn(token());
  await engine.include(session.vault.epoch);
  return { api, library, state, engine, epoch: session.vault.epoch };
}

/** True when any stored object, item row or change holds `value` in plain text. */
async function serverHolds(value: string) {
  const needle = Buffer.from(value);
  for (const key of await pilot.objects.list(''))
    if (Buffer.from((await pilot.objects.get(key))!).includes(needle)) return true;
  const { changes } = await pilot.store.changesAfter(OWNER, 0);
  for (const { item } of changes) {
    if (JSON.stringify(item).includes(value)) return true;
    if (JSON.stringify(await pilot.store.getAnyItem(OWNER, item.globalId)).includes(value))
      return true;
  }
  return false;
}

/** The phone syncs one indexed note in plain, before encryption exists. */
async function plainPhone() {
  const phone = await device();
  const id = phone.library.add(
    { kind: 'note', title: `Locker ${MARKER}`, mimeType: 'text/plain' },
    text(`Locker code ${MARKER}`),
  );
  phone.library.setIndex(id, version, segments(3));
  expect(await phone.engine.runOnce()).toMatchObject({ uploaded: 1, indexed: 1 });
  expect(await serverHolds(MARKER)).toBe(true);
  const [entry] = await phone.engine.catalogue();
  return { phone, id, globalId: entry.globalId };
}

describe('E4 turning encryption on seals what is already in the cloud library', () => {
  it('seals this device’s items in place and republishes their index sealed', async () => {
    const { phone, globalId } = await plainPhone();
    await phone.engine.turnOnEncryption();
    expect(await phone.engine.runOnce()).toMatchObject({ resealed: 1, failed: 0 });
    expect(await phone.engine.runOnce()).toMatchObject({ indexed: 1, failed: 0 });
    const stored = (await pilot.store.getAnyItem(OWNER, globalId)) as SealedStoredItem;
    expect(stored).toMatchObject({ revision: 2, sealed: { enc: E2EE_FORMAT } });
    expect(stored.sealedIndex?.metaRevision).toBe(stored.sealed?.metaRevision);
    expect(await serverHolds(MARKER)).toBe(false);
    expect((await phone.engine.catalogue())[0]).toMatchObject({ title: `Locker ${MARKER}` });
    // Nothing is left to seal.
    expect((await phone.engine.runOnce()).resealed ?? 0).toBe(0);
  });

  it('seals another device’s items, carrying over the index it had downloaded', async () => {
    const { phone, id, globalId } = await plainPhone();
    const laptop = await device();
    await laptop.engine.runOnce();
    expect(await laptop.engine.cloudSegments()).toHaveLength(2);
    const code = await laptop.engine.turnOnEncryption();
    expect(await laptop.engine.runOnce()).toMatchObject({ resealed: 1, failed: 0 });
    const stored = (await pilot.store.getAnyItem(OWNER, globalId)) as SealedStoredItem;
    expect(stored.sealedIndex?.metaRevision).toBe(1);
    expect(await serverHolds(MARKER)).toBe(false);

    // The phone, unlocked, keeps working on its item: a rename is sealed too.
    expect(await phone.engine.runOnce()).toMatchObject({ locked: true });
    await phone.engine.unlock(code);
    expect(await phone.engine.runOnce()).toMatchObject({ failed: 0, conflicts: 0 });
    phone.library.setTitle(id, `Renamed ${MARKER}`);
    expect(await phone.engine.runOnce()).toMatchObject({ renamed: 1, indexed: 1, failed: 0 });
    expect(await serverHolds('Renamed')).toBe(false);

    const tablet = await device();
    await tablet.engine.runOnce();
    await tablet.engine.unlock(code);
    await tablet.engine.runOnce();
    expect((await tablet.engine.catalogue())[0].title).toBe(`Renamed ${MARKER}`);
    expect(await tablet.engine.cloudSegments()).toHaveLength(2);
  });

  it('keeps a rename made here while another device sealed the item', async () => {
    const { phone, id } = await plainPhone();
    const laptop = await device();
    await laptop.engine.runOnce();
    const code = await laptop.engine.turnOnEncryption();
    await laptop.engine.runOnce();
    phone.library.setTitle(id, 'Renamed while sealing');
    expect(await phone.engine.runOnce()).toMatchObject({ locked: true });
    await phone.engine.unlock(code);
    expect(await phone.engine.runOnce()).toMatchObject({ renamed: 1, conflicts: 0, failed: 0 });
    await laptop.engine.runOnce();
    expect((await laptop.engine.catalogue())[0].title).toBe('Renamed while sealing');
  });

  it('refuses a reseal against an old revision or of an item already sealed', async () => {
    const { phone, globalId } = await plainPhone();
    await phone.engine.turnOnEncryption();
    const sealed = {
      enc: E2EE_FORMAT as typeof E2EE_FORMAT,
      wrappedKey: toBase64url(new Uint8Array(40)),
      sealedMeta: toBase64url(new Uint8Array(64)),
      metaRevision: 1,
      cipherByteLength: 216,
      cipherSha256: 'a'.repeat(64),
    };
    const begin = (expectedRevision: number) =>
      phone.api.beginUpload(globalId, {
        opId: randomUUID(),
        epoch: phone.epoch,
        sealed,
        reseal: { expectedRevision },
      });
    await expect(begin(7)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    await phone.engine.runOnce();
    await expect(begin(2)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});

describe('E6 items sent through Telegram stay plain', () => {
  it('lists them as bot items, never seals them, and the server refuses to', async () => {
    const phone = await device();
    await phone.engine.turnOnEncryption();
    const bytes = text('Sent through Telegram');
    const globalId = randomUUID();
    const objectKey = `${OWNER}/1/${globalId}/original`;
    await pilot.objects.put(objectKey, bytes);
    const bot: StoredItem = {
      globalId,
      kind: 'note',
      title: 'Telegram note',
      mimeType: 'text/plain',
      byteLength: bytes.length,
      contentSha256: sha256(bytes),
      createdAt: 1,
      revision: 1,
      deleted: false,
      objectKey,
    };
    await pilot.store.publish(OWNER, bot, phone.epoch);
    await pilot.telegram.recordSaved({ ownerKey: OWNER, globalId, userId: 'u-1', savedAt: 1 });

    expect(await phone.engine.runOnce()).toMatchObject({ failed: 0 });
    expect((await phone.engine.runOnce()).resealed ?? 0).toBe(0);
    expect((await phone.state.load()).botItems).toEqual([globalId]);
    expect(await pilot.store.getItem(OWNER, globalId)).toMatchObject({ title: 'Telegram note' });
    // Listed and opened as it is, next to sealed items.
    const listed = (await phone.engine.catalogue()).find((item) => item.globalId === globalId);
    expect(listed).toMatchObject({ title: 'Telegram note' });
    expect(listed).not.toHaveProperty('sealed');
    expect(Buffer.from(await phone.engine.download(globalId)).equals(Buffer.from(bytes))).toBe(
      true,
    );
    const refused = await phone.api
      .beginUpload(globalId, {
        opId: randomUUID(),
        epoch: phone.epoch,
        sealed: {
          enc: E2EE_FORMAT,
          wrappedKey: toBase64url(new Uint8Array(40)),
          sealedMeta: toBase64url(new Uint8Array(64)),
          metaRevision: 1,
          cipherByteLength: 216,
          cipherSha256: 'a'.repeat(64),
        },
        reseal: { expectedRevision: 1 },
      })
      .catch((cause: unknown) => cause);
    expect(refused).toBeInstanceOf(ApiFailure);
    expect((refused as ApiFailure).code).toBe('INVALID_INPUT');
  });
});

const postgresStores: PostgresPilotStore[] = [];
afterEach(async () => {
  for (const store of postgresStores.splice(0)) {
    await store.dropSchemaForTests();
    await store.close();
  }
});
const kinds: [string, () => Promise<PilotStore>][] = [
  ['memory', async () => new MemoryPilotStore()],
  ...(DATABASE
    ? [
        [
          'PostgreSQL',
          async () => {
            const store = await PostgresPilotStore.open({
              connectionString: DATABASE,
              schema: `test_${randomUUID().replaceAll('-', '')}`,
            });
            postgresStores.push(store);
            return store;
          },
        ] as [string, () => Promise<PilotStore>],
      ]
    : []),
];

describe.each(kinds)('E4 forgetting plaintext in the %s store', (_, open) => {
  it('rewrites the change history and drops saved results and finished uploads', async () => {
    const store = await open();
    const owner = 'google:store-owner';
    const { epoch } = await store.vault(owner);
    const globalId = randomUUID();
    const plain: StoredItem = {
      globalId,
      kind: 'note',
      title: `Plain ${MARKER}`,
      mimeType: 'text/plain',
      byteLength: 5,
      contentSha256: 'c'.repeat(64),
      createdAt: 1,
      revision: 1,
      deleted: false,
    };
    await store.publish(owner, plain, epoch);
    const opId = randomUUID();
    await store.saveResponse(owner, opId, { status: 200, body: { item: publicItem(plain) } });
    const finished = { uploadId: randomUUID(), ownerKey: owner, epoch, globalId, createdAt: 1 };
    await store.createUpload({ ...finished, item: plain });
    await store.finishUpload(finished.uploadId, publicItem(plain));
    const current = { ...finished, uploadId: randomUUID() };
    await store.createUpload({ ...current, item: plain });

    const sealed: SealedStoredItem = {
      globalId,
      revision: 2,
      deleted: false,
      byteLength: 216,
      sealed: {
        enc: E2EE_FORMAT,
        wrappedKey: toBase64url(new Uint8Array(40)),
        sealedMeta: toBase64url(new Uint8Array(64)),
        metaRevision: 1,
        cipherByteLength: 216,
        cipherSha256: 'a'.repeat(64),
      },
    };
    await store.publish(owner, sealed, epoch);
    await store.forgetPlaintext(owner, globalId, publicItem(sealed), current.uploadId);

    const { changes } = await store.changesAfter(owner, 0);
    expect(changes.map((change) => change.item)).toEqual([publicItem(sealed), publicItem(sealed)]);
    expect(JSON.stringify(changes)).not.toContain(MARKER);
    expect(await store.savedResponse(owner, opId)).toBeUndefined();
    expect(await store.getUpload(finished.uploadId)).toBeUndefined();
    expect(await store.getUpload(current.uploadId)).toBeDefined();
  });
});
