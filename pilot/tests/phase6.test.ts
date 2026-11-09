import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApiClient } from '../client/api';
import {
  MemoryLocalLibrary,
  MemoryOfflineStore,
  MemoryRemoteIndexStore,
  MemorySyncStateStore,
} from '../client/memory';
import { SyncEngine } from '../client/sync';
import { deviceFetch, idToken, sha256, startPilotServer } from './helpers';

let pilot: Awaited<ReturnType<typeof startPilotServer>>;
beforeEach(async () => {
  pilot = await startPilotServer();
});
afterEach(() => pilot.close());

const pdf = new TextEncoder().encode(
  '%PDF-1.4\n' + 'Guests need a pass from the warden. '.repeat(300),
);
const writes = (log: string[]) => log.filter((line) => !line.startsWith('GET'));

async function device(
  interceptFetch?: (url: string, init: RequestInit, baseFetch: typeof fetch) => Promise<Response>,
) {
  const net = deviceFetch();
  const fetchWrapper: typeof fetch = (input, init = {}) => {
    if (interceptFetch) return interceptFetch(String(input), init, net.fetchImpl);
    return net.fetchImpl(input, init);
  };
  const api = createApiClient({ base: pilot.base, fetch: fetchWrapper });
  const library = new MemoryLocalLibrary();
  const offline = new MemoryOfflineStore();
  const engine = new SyncEngine({
    api,
    library,
    state: new MemorySyncStateStore(),
    remoteIndex: new MemoryRemoteIndexStore(),
    offline,
    libraryId: 'library',
  });
  const session = await api.signIn(idToken());
  await engine.include(session.vault.epoch);
  return { net, api, library, offline, engine };
}
async function phoneWithPdf() {
  const phone = await device();
  const id = phone.library.add(
    { kind: 'pdf', title: 'Hostel mess rules', mimeType: 'application/pdf' },
    pdf,
  );
  await phone.engine.runOnce();
  return { phone, id };
}

describe('P07 keep offline and remove download', () => {
  it('keeps a verified copy that opens without the network, and removing it deletes nothing in the cloud', async () => {
    await phoneWithPdf();
    const laptop = await device();
    await laptop.engine.runOnce();
    const [item] = await laptop.engine.catalogue();
    await laptop.engine.keepOffline(item.globalId);
    expect(await laptop.engine.offlineIds()).toEqual([item.globalId]);

    laptop.net.controls.down = true;
    expect(sha256(await laptop.engine.download(item.globalId))).toBe(sha256(pdf));

    laptop.net.controls.down = false;
    laptop.net.controls.log.length = 0;
    await laptop.engine.removeDownload(item.globalId);
    expect(writes(laptop.net.controls.log)).toEqual([]);
    expect(await laptop.engine.offlineIds()).toEqual([]);
    expect(await laptop.engine.catalogue()).toHaveLength(1);
    laptop.net.controls.down = true;
    await expect(laptop.engine.download(item.globalId)).rejects.toThrow();
  });

  it('drops an offline copy when the item is deleted on another device', async () => {
    const { phone, id } = await phoneWithPdf();
    const laptop = await device();
    await laptop.engine.runOnce();
    const [item] = await laptop.engine.catalogue();
    await laptop.engine.keepOffline(item.globalId);
    phone.library.remove(id);
    await phone.engine.runOnce();
    await laptop.engine.runOnce();
    expect(await laptop.engine.offlineIds()).toEqual([]);
  });
});

describe('P09 deleting a document from another device', () => {
  it('deletes it for every device, including the device that saved it', async () => {
    const { phone, id } = await phoneWithPdf();
    const laptop = await device();
    await laptop.engine.runOnce();
    const [item] = await laptop.engine.catalogue();
    await laptop.engine.deleteCloudItem(item.globalId);
    expect(await laptop.engine.catalogue()).toEqual([]);
    await phone.engine.runOnce();
    expect(phone.library.titleOf(id)).toBeUndefined();
  });
});

describe('P10 pause and cloud library removal', () => {
  it('sends nothing while paused and resumes afterwards', async () => {
    const phone = await device();
    await phone.engine.setPaused(true);
    phone.library.add(
      { kind: 'pdf', title: 'Hostel mess rules', mimeType: 'application/pdf' },
      pdf,
    );
    phone.net.controls.log.length = 0;
    expect(await phone.engine.runOnce()).toMatchObject({ paused: true, uploaded: 0 });
    expect(phone.net.controls.log).toEqual([]);
    await phone.engine.setPaused(false);
    expect((await phone.engine.runOnce()).uploaded).toBe(1);
  });

  it('stops upload when paused while a chunk is in flight and preserves paused state', async () => {
    const holder: { engine?: SyncEngine } = {};
    let pausedMidway = false;
    const phone = await device(async (url, init, baseFetch) => {
      if (url.includes('/chunks/0') && !pausedMidway) {
        pausedMidway = true;
        const res = await baseFetch(url, init);
        await holder.engine?.setPaused(true);
        return res;
      }
      return baseFetch(url, init);
    });
    holder.engine = phone.engine;

    // Multi-chunk PDF (chunkBytes is 32 KB by default; 2000 repeats is ~70 KB = 3 chunks)
    const multiChunkPdf = new TextEncoder().encode(
      '%PDF-1.4\n' + 'Guests need a pass from the warden. '.repeat(2000),
    );
    phone.library.add(
      { kind: 'pdf', title: 'Large rulebook', mimeType: 'application/pdf' },
      multiChunkPdf,
    );

    const result = await phone.engine.runOnce();
    expect(result).toMatchObject({ paused: true, uploaded: 0 });

    // Assert no chunk 1 or complete request was sent
    expect(phone.net.controls.log.some((line) => line.includes('/chunks/1'))).toBe(false);
    expect(phone.net.controls.log.some((line) => line.includes('/complete'))).toBe(false);

    // Assert status().paused is still true after the pass ends
    const status = await phone.engine.status();
    expect(status.paused).toBe(true);

    // Resuming after unpausing completes the upload
    await phone.engine.setPaused(false);
    const resumeResult = await phone.engine.runOnce();
    expect(resumeResult.uploaded).toBe(1);
    expect(phone.net.controls.log.some((line) => line.includes('/complete'))).toBe(true);
    expect((await phone.engine.status()).paused).toBe(false);
  });

  it('stops other devices after the cloud library is removed until the user starts again', async () => {
    const { phone, id } = await phoneWithPdf();
    const laptop = await device();
    await laptop.engine.runOnce();
    await laptop.engine.keepOffline((await laptop.engine.catalogue())[0].globalId);

    const { vault } = await laptop.engine.removeCloudLibrary();
    expect(vault.epoch).toBe(2);
    expect(await laptop.engine.catalogue()).toEqual([]);
    expect(await laptop.engine.offlineIds()).toEqual([]);
    expect((await laptop.engine.status()).included).toBe(false);

    // The phone still has the item locally and must not silently upload it into the new library.
    phone.net.controls.log.length = 0;
    expect((await phone.engine.runOnce()).needsResync).toBe(true);
    expect(writes(phone.net.controls.log)).toEqual([]);
    expect(phone.library.titleOf(id)).toBe('Hostel mess rules');
    // Until the user chooses to start again, the device does not contact the server at all.
    phone.net.controls.log.length = 0;
    expect(await phone.engine.runOnce()).toMatchObject({ needsResync: true, uploaded: 0 });
    expect(phone.net.controls.log).toEqual([]);

    await phone.engine.startAgain(vault.epoch);
    expect((await phone.engine.status()).included).toBe(false);
    expect((await phone.engine.runOnce()).uploaded).toBe(0);
    await phone.engine.include(vault.epoch);
    expect((await phone.engine.runOnce()).uploaded).toBe(1);
  });
});
