/// <reference types="node" />
// Phase 2 of docs/pilot/e2ee-design.md: the sync engine seals what it sends to an encrypted
// library and opens what it receives, so the server only ever holds ciphertext.
import { strFromU8, unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApiClient } from '../client/api';
import { exportCloudVault } from '../client/export';
import {
  MemoryLocalLibrary,
  MemoryOfflineStore,
  MemoryRemoteIndexStore,
  MemorySyncStateStore,
  MemoryVaultSecretStore,
} from '../client/memory';
import { SyncEngine } from '../client/sync';
import { PILOT_INDEX_VERSIONS } from '../contract';
import {
  E2EE_FORMAT,
  decodeRecoveryCode,
  encodeRecoveryCode,
  newRecoverySecret,
  toBase64url,
} from '../contract/e2ee';
import type { SealedStoredItem } from '../server/store';
import { deviceFetch, idToken, sha256, startPilotServer } from './helpers';

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

let pilot: Awaited<ReturnType<typeof startPilotServer>>;
beforeEach(async () => {
  pilot = await startPilotServer();
});
afterEach(() => pilot.close());

/** A signed-in device whose library is included; it records every request body it sends. */
async function device() {
  const net = deviceFetch();
  const bodies: string[] = [];
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    if (typeof init.body === 'string') bodies.push(init.body);
    else if (init.body instanceof Uint8Array)
      bodies.push(Buffer.from(init.body).toString('latin1'));
    return net.fetchImpl(input, init);
  };
  const api = createApiClient({ base: pilot.base, fetch: fetchImpl });
  const library = new MemoryLocalLibrary();
  const vaultSecret = new MemoryVaultSecretStore();
  const engine = new SyncEngine({
    api,
    library,
    state: new MemorySyncStateStore(),
    remoteIndex: new MemoryRemoteIndexStore(),
    offline: new MemoryOfflineStore(),
    vaultSecret,
    libraryId: 'library',
  });
  const session = await api.signIn(idToken());
  await engine.include(session.vault.epoch);
  return { net, bodies, api, library, engine, vaultSecret, epoch: session.vault.epoch };
}
type Device = Awaited<ReturnType<typeof device>>;

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

/** The phone turns encryption on and syncs one indexed note; the laptop is a second device. */
async function encryptedLibrary(bytes = text(`Locker code ${MARKER}`)) {
  const phone = await device();
  const code = await phone.engine.turnOnEncryption();
  const id = phone.library.add(
    { kind: 'note', title: `Locker ${MARKER}`, mimeType: 'text/plain' },
    bytes,
  );
  phone.library.setIndex(id, version, segments(3));
  expect(await phone.engine.runOnce()).toMatchObject({ uploaded: 1, indexed: 1, failed: 0 });
  const [entry] = await phone.engine.catalogue();
  return { phone, code, id, bytes, globalId: entry.globalId };
}

async function unlockedLaptop(code: string) {
  const laptop = await device();
  await laptop.engine.runOnce();
  await laptop.engine.unlock(code);
  expect(await laptop.engine.runOnce()).toMatchObject({ failed: 0 });
  return laptop;
}

const originalReads = (dev: Device, globalId: string) =>
  dev.net.controls.log.filter((line) => line === `GET /items/${globalId}/original`).length;

describe('E1 an encrypted library holds no plaintext on the server', () => {
  it('seals originals, titles and index bundles before they leave the device', async () => {
    const { phone, code, globalId } = await encryptedLibrary();
    expect(await phone.engine.encryption()).toEqual({ on: true, unlocked: true });
    expect(await phone.engine.recoveryCode()).toBe(code);
    const stored = (await pilot.store.getAnyItem(OWNER, globalId)) as SealedStoredItem;
    expect(stored.sealed).toMatchObject({ enc: E2EE_FORMAT, metaRevision: 1 });
    expect(stored.sealedIndex).toMatchObject({ metaRevision: 1 });
    expect(stored).not.toHaveProperty('title');
    expect(await serverHolds(MARKER)).toBe(false);
    // The device still shows its own item in full.
    expect((await phone.engine.catalogue())[0]).toMatchObject({
      globalId,
      kind: 'note',
      title: `Locker ${MARKER}`,
      sealed: { enc: E2EE_FORMAT },
    });
  });

  it('E8 never sends the recovery secret or the plaintext in any request', async () => {
    const { phone, code } = await encryptedLibrary();
    const secret = await decodeRecoveryCode(code);
    const forms = [code, toBase64url(secret), Buffer.from(secret).toString('hex'), MARKER];
    for (const body of phone.bodies) for (const form of forms) expect(body).not.toContain(form);
  });

  it('refuses to turn encryption on a second time and forgets the unused secret', async () => {
    await encryptedLibrary();
    const laptop = await device();
    await expect(laptop.engine.turnOnEncryption()).rejects.toThrow();
    expect(await laptop.vaultSecret.get()).toBeUndefined();
  });
});

describe('E2 another device needs the recovery code', () => {
  it('stays locked and sends nothing until the code is entered, then reads everything', async () => {
    const { code, bytes, globalId } = await encryptedLibrary();
    const laptop = await device();
    const own = laptop.library.add(
      { kind: 'note', title: 'Laptop note', mimeType: 'text/plain' },
      text('Written on the laptop'),
    );
    expect(await laptop.engine.runOnce()).toMatchObject({ locked: true, uploaded: 0 });
    expect(await laptop.engine.encryption()).toEqual({ on: true, unlocked: false });
    expect(await laptop.engine.catalogue()).toEqual([]);
    expect((await pilot.store.changesAfter(OWNER, 0)).changes).toHaveLength(2); // upload, index

    await laptop.engine.unlock(code);
    expect(await laptop.engine.runOnce()).toMatchObject({ uploaded: 1, failed: 0 });
    const titles = (await laptop.engine.catalogue()).map((item) => item.title);
    expect(titles).toEqual(['Laptop note', `Locker ${MARKER}`]);
    expect(Buffer.from(await laptop.engine.download(globalId)).equals(Buffer.from(bytes))).toBe(
      true,
    );
    const cloud = await laptop.engine.cloudSegments();
    expect(cloud.map((segment) => segment.text)).toEqual([
      `The locker code is ${MARKER}.`,
      undefined,
    ]);
    expect(Array.from(cloud[0].vector)).toEqual(Array.from(unit(3)));
    expect(await serverHolds('Written on the laptop')).toBe(false);
    void own;
  });

  it('refuses a wrong or mistyped code and stays locked', async () => {
    const { code } = await encryptedLibrary();
    const laptop = await device();
    await laptop.engine.runOnce();
    const other = await encodeRecoveryCode(newRecoverySecret());
    await expect(laptop.engine.unlock(other)).rejects.toMatchObject({ code: 'WRONG_KEY' });
    await expect(laptop.engine.unlock(code.slice(0, -1))).rejects.toMatchObject({
      code: 'INVALID_CODE',
    });
    expect(await laptop.engine.encryption()).toEqual({ on: true, unlocked: false });
    expect(await laptop.vaultSecret.get()).toBeUndefined();
  });

  it('keeps an offline copy decrypted on the device and reads it from there', async () => {
    const { code, bytes, globalId } = await encryptedLibrary();
    const laptop = await unlockedLaptop(code);
    await laptop.engine.keepOffline(globalId);
    expect(await laptop.engine.offlineIds()).toEqual([globalId]);
    const reads = originalReads(laptop, globalId);
    expect(Buffer.from(await laptop.engine.download(globalId)).equals(Buffer.from(bytes))).toBe(
      true,
    );
    expect(originalReads(laptop, globalId)).toBe(reads);
  });
});

describe('E1 sealed renames and indexes follow the item', () => {
  it('seals a rename under the next metaRevision and republishes the index for it', async () => {
    const { phone, code, id, globalId } = await encryptedLibrary();
    const laptop = await unlockedLaptop(code);
    phone.library.setTitle(id, `Renamed ${MARKER}`);
    expect(await phone.engine.runOnce()).toMatchObject({ renamed: 1, indexed: 1, failed: 0 });
    const stored = (await pilot.store.getAnyItem(OWNER, globalId)) as SealedStoredItem;
    expect(stored.sealed?.metaRevision).toBe(2);
    expect(stored.sealedIndex?.metaRevision).toBe(2);
    expect(await serverHolds('Renamed')).toBe(false);

    expect(await laptop.engine.runOnce()).toMatchObject({ failed: 0 });
    expect((await laptop.engine.catalogue())[0].title).toBe(`Renamed ${MARKER}`);
    expect(await laptop.engine.cloudSegments()).toHaveLength(2);
  });
});

describe('E1 large and interrupted transfers', () => {
  it('downloads a sealed original of several chunks one chunk per request', async () => {
    const big = Uint8Array.from({ length: 4_300_000 }, (_, i) => (i * 7) % 251);
    const phone = await device();
    const code = await phone.engine.turnOnEncryption();
    phone.library.add({ kind: 'pdf', title: 'Big scan', mimeType: 'application/pdf' }, big);
    expect(await phone.engine.runOnce()).toMatchObject({ uploaded: 1, failed: 0 });
    const laptop = await unlockedLaptop(code);
    const [entry] = await laptop.engine.catalogue();
    expect(entry.byteLength).toBe(big.length);
    expect(Buffer.from(await laptop.engine.download(entry.globalId)).equals(Buffer.from(big))).toBe(
      true,
    );
    expect(originalReads(laptop, entry.globalId)).toBe(2);
  });

  it('resumes an interrupted sealed upload with the same ciphertext', async () => {
    const bytes = Uint8Array.from({ length: 100_000 }, (_, i) => (i * 13) % 256);
    const phone = await device();
    const code = await phone.engine.turnOnEncryption();
    phone.library.add({ kind: 'pdf', title: 'Resumed scan', mimeType: 'application/pdf' }, bytes);
    phone.net.controls.loseResponse = /^PUT \/uploads\/[^/]+\/chunks\/2$/;
    expect((await phone.engine.runOnce()).uploaded).toBe(0);
    expect(await phone.engine.runOnce()).toMatchObject({ uploaded: 1, failed: 0 });
    const laptop = await unlockedLaptop(code);
    const [entry] = await laptop.engine.catalogue();
    expect(sha256(await laptop.engine.download(entry.globalId))).toBe(sha256(bytes));
  });
});

describe('E3 tampered ciphertext is refused and replaces nothing', () => {
  it('refuses a changed original and keeps no offline copy of it', async () => {
    const { code, globalId } = await encryptedLibrary();
    const laptop = await unlockedLaptop(code);
    const { objectKey } = (await pilot.store.getAnyItem(OWNER, globalId))!;
    const bytes = (await pilot.objects.get(objectKey!))!;
    bytes[20] ^= 1;
    await pilot.objects.put(objectKey!, bytes);
    await expect(laptop.engine.download(globalId)).rejects.toMatchObject({ code: 'TAMPERED' });
    await expect(laptop.engine.keepOffline(globalId)).rejects.toThrow();
    expect(await laptop.engine.offlineIds()).toEqual([]);
  });

  it('skips metadata moved from another item and keeps the item as it was', async () => {
    const phone = await device();
    const code = await phone.engine.turnOnEncryption();
    phone.library.add({ kind: 'note', title: 'First', mimeType: 'text/plain' }, text('one'));
    phone.library.add({ kind: 'note', title: 'Second', mimeType: 'text/plain' }, text('two'));
    await phone.engine.runOnce();
    const laptop = await unlockedLaptop(code);
    const [first, second] = await laptop.engine.catalogue();
    const a = (await pilot.store.getAnyItem(OWNER, first.globalId)) as SealedStoredItem;
    const b = (await pilot.store.getAnyItem(OWNER, second.globalId)) as SealedStoredItem;
    await pilot.store.publish(
      OWNER,
      {
        ...b,
        revision: b.revision + 1,
        sealed: { ...b.sealed!, sealedMeta: a.sealed!.sealedMeta },
      },
      laptop.epoch,
    );
    expect((await laptop.engine.runOnce()).failed).toBeGreaterThan(0);
    expect((await laptop.engine.catalogue()).map((item) => item.title)).toEqual([
      'First',
      'Second',
    ]);
  });
});

describe('E1 removing the cloud library ends encryption', () => {
  it('forgets the recovery secret on this device', async () => {
    const { phone } = await encryptedLibrary();
    await phone.engine.removeCloudLibrary();
    expect(await phone.vaultSecret.get()).toBeUndefined();
    expect(await phone.engine.encryption()).toEqual({ on: false, unlocked: false });
  });
});

describe('E7 export of an encrypted library', () => {
  it('exports titles and originals decrypted, and needs the key to do so', async () => {
    const { code, bytes, globalId } = await encryptedLibrary();
    const laptop = await device();
    await laptop.engine.runOnce();
    await expect(exportCloudVault({ api: laptop.api, epoch: laptop.epoch })).rejects.toThrow(
      /recovery code/,
    );
    await laptop.engine.unlock(code);
    await laptop.engine.runOnce();
    const [archive] = await exportCloudVault({
      api: laptop.api,
      epoch: laptop.epoch,
      vault: await laptop.engine.sealedReader(),
    });
    const files = unzipSync(new Uint8Array(await archive.arrayBuffer()));
    const manifest = JSON.parse(strFromU8(files['manifest.json']));
    expect(manifest.items).toEqual([
      expect.objectContaining({ id: globalId, title: `Locker ${MARKER}`, kind: 'note' }),
    ]);
    expect(Buffer.from(files[`originals/${globalId}`]).equals(Buffer.from(bytes))).toBe(true);
  });
});
