/// <reference types="node" />
// docs/pilot/e2ee-design.md, "Turning it on for an existing library": a student can choose
// encryption while including a library, so none of its items is ever uploaded readable.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApiClient } from '../client/api';
import {
  MemoryLocalLibrary,
  MemoryOfflineStore,
  MemoryRemoteIndexStore,
  MemorySyncStateStore,
  MemoryVaultSecretStore,
} from '../client/memory';
import { SyncEngine } from '../client/sync';
import { PILOT_INDEX_VERSIONS } from '../contract';
import { deviceFetch, idToken, startPilotServer } from './helpers';

const OWNER = 'google:subject-a';
const MARKER = 'zebra-quokka-7731';
const unit = (axis: number) => Float32Array.from({ length: 768 }, (_, i) => (i === axis ? 1 : 0));

let pilot: Awaited<ReturnType<typeof startPilotServer>>;
beforeEach(async () => {
  pilot = await startPilotServer();
});
afterEach(() => pilot.close());

/** A signed-in device whose library is not included yet; it records what it sends. */
async function device() {
  const net = deviceFetch();
  const sent: { line: string; body: string }[] = [];
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const line = `${init.method ?? 'GET'} ${new URL(String(input)).pathname.replace(/^\/api\/v1/, '')}`;
    const body =
      typeof init.body === 'string'
        ? init.body
        : init.body instanceof Uint8Array
          ? Buffer.from(init.body).toString('latin1')
          : '';
    sent.push({ line, body });
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
  const { vault } = await api.signIn(idToken());
  return { sent, library, engine, vaultSecret, epoch: vault.epoch };
}

describe('E1 a new library can be encrypted before its first upload', () => {
  it('turns encryption on before including, so nothing is ever uploaded readable', async () => {
    const phone = await device();
    const id = phone.library.add(
      { kind: 'note', title: `Locker ${MARKER}`, mimeType: 'text/plain' },
      new TextEncoder().encode(`Locker code ${MARKER}`),
    );
    phone.library.setIndex(id, PILOT_INDEX_VERSIONS[0], [
      {
        modality: 'text',
        location: { kind: 'whole' },
        text: `The locker code is ${MARKER}.`,
        vector: unit(2),
      },
    ]);

    // The code is shown first; nothing but sign-in has reached the server.
    const code = await phone.engine.prepareEncryption(phone.epoch);
    expect(phone.sent.map((request) => request.line)).toEqual(['POST /session']);
    expect(await phone.engine.turnOnEncryption(phone.epoch)).toBe(code);
    await phone.engine.include(phone.epoch);
    expect(await phone.engine.runOnce()).toMatchObject({ uploaded: 1, indexed: 1, failed: 0 });

    const uploads = phone.sent.filter((request) =>
      /^POST \/items\/[^/]+\/upload$/.test(request.line),
    );
    expect(uploads).toHaveLength(1);
    expect(JSON.parse(uploads[0].body)).toMatchObject({ sealed: { enc: 'ar-e2ee-1' } });
    expect(JSON.parse(uploads[0].body)).not.toHaveProperty('reseal');
    for (const request of phone.sent) expect(request.body).not.toContain(MARKER);
    const { changes } = await pilot.store.changesAfter(OWNER, 0);
    expect(JSON.stringify(changes)).not.toContain(MARKER);
    for (const key of await pilot.objects.list(''))
      expect(Buffer.from((await pilot.objects.get(key))!).includes(Buffer.from(MARKER))).toBe(
        false,
      );

    const laptop = await device();
    await laptop.engine.include(laptop.epoch);
    expect(await laptop.engine.runOnce()).toMatchObject({ locked: true });
    await laptop.engine.unlock(code);
    await laptop.engine.runOnce();
    expect((await laptop.engine.catalogue()).map((item) => item.title)).toEqual([
      `Locker ${MARKER}`,
    ]);
  });

  it('leaves the library out when the cloud library is already encrypted', async () => {
    const phone = await device();
    await phone.engine.prepareEncryption(phone.epoch);
    await phone.engine.turnOnEncryption(phone.epoch);
    const laptop = await device();
    await laptop.engine.prepareEncryption(laptop.epoch);
    await expect(laptop.engine.turnOnEncryption(laptop.epoch)).rejects.toThrow();
    expect(await laptop.vaultSecret.get()).toBeUndefined();
    expect((await laptop.engine.status()).included).toBe(false);
  });
});
