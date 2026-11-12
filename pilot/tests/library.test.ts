import 'fake-indexeddb/auto';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AnyRecallDatabase, DexieLibraryRepository } from '../../src/storage';
import { createApiClient } from '../client/api';
import { IndexedDbSyncStateStore } from '../client/idb';
import { repositoryLibrary } from '../client/library';
import { SyncEngine } from '../client/sync';
import { deviceFetch, idToken, sha256, startPilotServer } from './helpers';

let pilot: Awaited<ReturnType<typeof startPilotServer>>;
beforeEach(async () => {
  pilot = await startPilotServer();
});
afterEach(() => pilot.close());

const pdfBytes = new TextEncoder().encode(
  '%PDF-1.4\n' + 'Guests need a pass from the warden. '.repeat(400) + '\n%%EOF',
);
const unique = () => Math.random().toString(16).slice(2, 12);

async function appDevice() {
  const libraryName = `anyrecall-test-${unique()}`;
  const repository = new DexieLibraryRepository(new AnyRecallDatabase(libraryName));
  const net = deviceFetch();
  const api = createApiClient({ base: pilot.base, fetch: net.fetchImpl });
  const session = await api.signIn(idToken());
  // Each simulated device gets its own IndexedDB, as separate browsers would.
  const state = new IndexedDbSyncStateStore(session.account, {
    indexedDB: new IDBFactory(),
    IDBKeyRange,
  });
  const engine = new SyncEngine({
    api,
    library: repositoryLibrary(repository),
    state,
    libraryId: libraryName,
  });
  return { repository, api, state, engine, epoch: session.vault.epoch };
}

describe('Adapter around the app library', () => {
  it('reads items and exact originals from the real Dexie library', async () => {
    const repository = new DexieLibraryRepository(
      new AnyRecallDatabase(`anyrecall-test-${unique()}`),
    );
    const saved = await repository.save({
      kind: 'file',
      file: new File([pdfBytes], 'mess-rules.pdf', { type: 'application/pdf' }),
      title: 'Hostel mess rules',
    });
    const library = repositoryLibrary(repository);
    expect(await library.listItems()).toEqual([
      expect.objectContaining({
        id: saved.id,
        kind: 'pdf',
        title: 'Hostel mess rules',
        mimeType: 'application/pdf',
        byteLength: pdfBytes.length,
        contentSha256: sha256(pdfBytes),
      }),
    ]);
    expect(sha256((await library.getOriginal(saved.id))!)).toBe(sha256(pdfBytes));
    await library.renameItem(saved.id, 'Mess rules 2026');
    expect((await repository.getItem(saved.id))?.title).toBe('Mess rules 2026');
    await library.deleteItem(saved.id);
    expect(await repository.getItem(saved.id)).toBeUndefined();
  });

  it('syncs a PDF saved in the app library from a phone to a laptop', async () => {
    const phone = await appDevice();
    await phone.repository.save({
      kind: 'file',
      file: new File([pdfBytes], 'mess-rules.pdf', { type: 'application/pdf' }),
      title: 'Hostel mess rules',
    });
    await phone.repository.save({
      kind: 'note',
      text: 'Submit the demo link by the 3rd.',
      title: 'CS437 note',
    });
    await phone.engine.include(phone.epoch);
    expect(await phone.engine.runOnce()).toMatchObject({ uploaded: 2, failed: 0 });

    const laptop = await appDevice();
    await laptop.engine.include(laptop.epoch);
    await laptop.engine.runOnce();
    const titles = (await laptop.engine.catalogue()).map((item) => item.title).sort();
    expect(titles).toEqual(['CS437 note', 'Hostel mess rules']);
    const pdf = (await laptop.engine.catalogue()).find((item) => item.kind === 'pdf')!;
    expect(sha256(await laptop.engine.download(pdf.globalId))).toBe(sha256(pdfBytes));
    // The laptop's own library is untouched: cloud items stay in the catalogue.
    expect(await laptop.repository.listItems()).toHaveLength(0);
  });
});
