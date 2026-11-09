import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApiClient } from '../client/api';
import { MemoryLocalLibrary, MemorySyncStateStore } from '../client/memory';
import { SyncEngine } from '../client/sync';
import { deviceFetch, idToken, sha256, startPilotServer } from './helpers';

let pilot: Awaited<ReturnType<typeof startPilotServer>>;
beforeEach(async () => {
  pilot = await startPilotServer();
});
afterEach(() => pilot.close());

const pdf = new TextEncoder().encode(
  '%PDF-1.4\n' + 'Guests need a pass from the warden. '.repeat(3000),
);
const note = new TextEncoder().encode('Submit the demo link and README by the 3rd.');

async function device(token = idToken()) {
  const net = deviceFetch();
  const api = createApiClient({ base: pilot.base, fetch: net.fetchImpl });
  const library = new MemoryLocalLibrary();
  const state = new MemorySyncStateStore();
  const engine = new SyncEngine({ api, library, state, libraryId: 'phone-library' });
  const signedIn = await api.signIn(token);
  return { net, api, library, state, engine, epoch: signedIn.vault.epoch };
}
const writes = (log: string[]) => log.filter((line) => !line.startsWith('GET'));

describe('P02 nothing syncs before the library is included', () => {
  it('signing in alone sends no library data', async () => {
    const phone = await device();
    phone.library.add(
      { kind: 'pdf', title: 'Hostel mess rules', mimeType: 'application/pdf' },
      pdf,
    );
    await phone.engine.runOnce();
    expect(writes(phone.net.controls.log)).toEqual(['POST /session']);
    expect(phone.net.controls.log.some((line) => line.startsWith('GET /changes'))).toBe(false);
  });
});

describe('P04 phone to laptop through the pilot API', () => {
  it('uploads included items once and shows them on a second device with exact bytes', async () => {
    const phone = await device();
    const pdfId = phone.library.add(
      { kind: 'pdf', title: 'Hostel mess rules', mimeType: 'application/pdf' },
      pdf,
    );
    phone.library.add(
      { kind: 'note', title: 'CS437 instructions', mimeType: 'text/plain;charset=utf-8' },
      note,
    );
    await phone.engine.include(phone.epoch);
    const result = await phone.engine.runOnce();
    expect(result).toMatchObject({ uploaded: 2, failed: 0 });
    expect((await phone.engine.runOnce()).uploaded).toBe(0);

    const laptop = await device();
    await laptop.engine.include(laptop.epoch);
    await laptop.engine.runOnce();
    const catalogue = await laptop.engine.catalogue();
    expect(catalogue.map((item) => item.title).sort()).toEqual([
      'CS437 instructions',
      'Hostel mess rules',
    ]);
    const cloudPdf = catalogue.find((item) => item.title === 'Hostel mess rules')!;
    expect(cloudPdf).toMatchObject({
      kind: 'pdf',
      mimeType: 'application/pdf',
      byteLength: pdf.length,
      contentSha256: sha256(pdf),
    });
    const bytes = await laptop.engine.download(cloudPdf.globalId);
    expect(sha256(bytes)).toBe(sha256(pdf));
    expect((await phone.state.load()).mappings.find((m) => m.localId === pdfId)).toMatchObject({
      globalId: cloudPdf.globalId,
      state: 'synced',
    });
  });

  it('sends local renames and deletions to other devices', async () => {
    const phone = await device();
    const id = phone.library.add(
      { kind: 'pdf', title: 'Hostel mess rules', mimeType: 'application/pdf' },
      pdf,
    );
    const gone = phone.library.add(
      { kind: 'note', title: 'Old note', mimeType: 'text/plain;charset=utf-8' },
      note,
    );
    await phone.engine.include(phone.epoch);
    await phone.engine.runOnce();
    phone.library.setTitle(id, 'Mess rules 2026');
    phone.library.remove(gone);
    expect(await phone.engine.runOnce()).toMatchObject({ renamed: 1, deleted: 1 });

    const laptop = await device();
    await laptop.engine.include(laptop.epoch);
    await laptop.engine.runOnce();
    expect((await laptop.engine.catalogue()).map((item) => [item.title, item.revision])).toEqual([
      ['Mess rules 2026', 2],
    ]);
  });
});

describe('P08 no duplicates after crashes or lost responses', () => {
  it('retries a completion whose response was lost without creating a second item', async () => {
    const phone = await device();
    phone.library.add(
      { kind: 'pdf', title: 'Hostel mess rules', mimeType: 'application/pdf' },
      pdf,
    );
    await phone.engine.include(phone.epoch);
    phone.net.controls.loseResponse = /^POST \/uploads\/[^/]+\/complete$/;
    expect((await phone.engine.runOnce()).failed).toBe(1);
    expect((await phone.engine.runOnce()).uploaded).toBe(1);
    const laptop = await device();
    await laptop.engine.include(laptop.epoch);
    await laptop.engine.runOnce();
    expect(await laptop.engine.catalogue()).toHaveLength(1);
  });

  it('reuses the same upload when the reply to starting it was lost', async () => {
    const phone = await device();
    phone.library.add(
      { kind: 'pdf', title: 'Hostel mess rules', mimeType: 'application/pdf' },
      pdf,
    );
    await phone.engine.include(phone.epoch);
    phone.net.controls.loseResponse = /^POST \/items\/[^/]+\/upload$/;
    expect((await phone.engine.runOnce()).failed).toBe(1);
    expect((await phone.engine.runOnce()).uploaded).toBe(1);
    // A second upload would leave an unfinished reservation counted against the quota.
    expect(await pilot.store.committedBytes('google:subject-a')).toBe(pdf.length);
  });

  it('keeps planned work across a restart and sends it once when the network returns', async () => {
    const phone = await device();
    phone.library.add(
      { kind: 'pdf', title: 'Hostel mess rules', mimeType: 'application/pdf' },
      pdf,
    );
    await phone.engine.include(phone.epoch);
    phone.net.controls.down = true;
    expect((await phone.engine.runOnce()).failed).toBeGreaterThan(0);
    expect((await phone.state.load()).ops).toHaveLength(1);

    phone.net.controls.down = false;
    const restarted = new SyncEngine({
      api: phone.api,
      library: phone.library,
      state: phone.state,
      libraryId: 'phone-library',
    });
    expect((await restarted.runOnce()).uploaded).toBe(1);
    expect((await phone.state.load()).ops).toHaveLength(0);
    const laptop = await device();
    await laptop.engine.include(laptop.epoch);
    await laptop.engine.runOnce();
    expect(await laptop.engine.catalogue()).toHaveLength(1);
  });
});

describe('P09 changes from other devices', () => {
  async function syncedPhone() {
    const phone = await device();
    const id = phone.library.add(
      { kind: 'pdf', title: 'Hostel mess rules', mimeType: 'application/pdf' },
      pdf,
    );
    await phone.engine.include(phone.epoch);
    await phone.engine.runOnce();
    const mapping = (await phone.state.load()).mappings.find((m) => m.localId === id)!;
    const other = await device();
    return { phone, id, globalId: mapping.globalId, other };
  }

  it('applies a rename made elsewhere to the local library without sending it back', async () => {
    const { phone, id, globalId, other } = await syncedPhone();
    await other.api.rename(globalId, {
      opId: randomUUID(),
      epoch: other.epoch,
      expectedRevision: 1,
      title: 'Renamed on laptop',
    });
    phone.net.controls.log.length = 0;
    await phone.engine.runOnce();
    expect(phone.library.titleOf(id)).toBe('Renamed on laptop');
    expect(writes(phone.net.controls.log)).toEqual([]);
  });

  it('marks a conflict instead of overwriting when both devices renamed', async () => {
    const { phone, id, globalId, other } = await syncedPhone();
    await other.api.rename(globalId, {
      opId: randomUUID(),
      epoch: other.epoch,
      expectedRevision: 1,
      title: 'Renamed on laptop',
    });
    phone.library.setTitle(id, 'Renamed on phone');
    phone.net.controls.log.length = 0;
    const result = await phone.engine.runOnce();
    expect(result.conflicts).toBe(1);
    expect(writes(phone.net.controls.log)).toEqual([]);
    expect(phone.library.titleOf(id)).toBe('Renamed on phone');
    expect((await phone.state.load()).mappings.find((m) => m.localId === id)).toMatchObject({
      state: 'conflict',
      remoteTitle: 'Renamed on laptop',
    });
    await other.engine.include(other.epoch);
    await other.engine.runOnce();
    expect((await other.engine.catalogue())[0].title).toBe('Renamed on laptop');
  });

  it('clears a rename conflict when the item is renamed again here', async () => {
    const { phone, id, globalId, other } = await syncedPhone();
    await other.api.rename(globalId, {
      opId: randomUUID(),
      epoch: other.epoch,
      expectedRevision: 1,
      title: 'Renamed on laptop',
    });
    phone.library.setTitle(id, 'Renamed on phone');
    expect((await phone.engine.runOnce()).conflicts).toBe(1);

    phone.library.setTitle(id, 'Final title');
    phone.net.controls.log.length = 0;
    expect(await phone.engine.runOnce()).toMatchObject({ renamed: 1, conflicts: 0, failed: 0 });
    expect(writes(phone.net.controls.log)).toEqual([`PATCH /items/${globalId}`]);
    expect((await phone.state.load()).mappings.find((m) => m.localId === id)).toMatchObject({
      state: 'synced',
      syncedTitle: 'Final title',
      remoteTitle: undefined,
    });
    phone.net.controls.log.length = 0;
    await phone.engine.runOnce();
    expect(writes(phone.net.controls.log)).toEqual([]);

    await other.engine.include(other.epoch);
    await other.engine.runOnce();
    expect((await other.engine.catalogue())[0].title).toBe('Final title');
  });

  it('clears a rename conflict without a request when the other title is chosen here', async () => {
    const { phone, id, globalId, other } = await syncedPhone();
    await other.api.rename(globalId, {
      opId: randomUUID(),
      epoch: other.epoch,
      expectedRevision: 1,
      title: 'Renamed on laptop',
    });
    phone.library.setTitle(id, 'Renamed on phone');
    expect((await phone.engine.runOnce()).conflicts).toBe(1);

    phone.library.setTitle(id, 'Renamed on laptop');
    phone.net.controls.log.length = 0;
    expect(await phone.engine.runOnce()).toMatchObject({ renamed: 0, conflicts: 0, failed: 0 });
    expect(writes(phone.net.controls.log)).toEqual([]);
    expect((await phone.state.load()).mappings.find((m) => m.localId === id)).toMatchObject({
      state: 'synced',
      syncedTitle: 'Renamed on laptop',
      syncedRevision: 2,
    });
  });

  it('never overwrites the other title for a conflict saved before the fix, and clears on a rename', async () => {
    const { phone, id, globalId, other } = await syncedPhone();
    await other.api.rename(globalId, {
      opId: randomUUID(),
      epoch: other.epoch,
      expectedRevision: 1,
      title: 'Renamed on laptop',
    });
    phone.library.setTitle(id, 'Renamed on phone');
    expect((await phone.engine.runOnce()).conflicts).toBe(1);
    // A conflict saved by the old engine does not record the title that caused it.
    const saved = await phone.state.load();
    delete saved.mappings.find((m) => m.localId === id)!.conflictLocalTitle;
    await phone.state.save(saved);

    phone.net.controls.log.length = 0;
    await phone.engine.runOnce();
    expect(writes(phone.net.controls.log)).toEqual([]);
    expect((await phone.state.load()).mappings.find((m) => m.localId === id)?.state).toBe(
      'conflict',
    );

    phone.library.setTitle(id, 'Final title');
    expect(await phone.engine.runOnce()).toMatchObject({ renamed: 1, conflicts: 0, failed: 0 });
    expect((await phone.state.load()).mappings.find((m) => m.localId === id)?.state).toBe('synced');
  });

  it('removes the local copy when the document was deleted elsewhere', async () => {
    const { phone, id, globalId, other } = await syncedPhone();
    await other.api.remove(globalId, {
      opId: randomUUID(),
      epoch: other.epoch,
      expectedRevision: 1,
    });
    await phone.engine.runOnce();
    expect(phone.library.titleOf(id)).toBeUndefined();
    expect(await phone.engine.catalogue()).toHaveLength(0);
    phone.net.controls.log.length = 0;
    await phone.engine.runOnce();
    expect(writes(phone.net.controls.log)).toEqual([]);
  });
});

describe('P10 sync state is bound to one library', () => {
  it('refuses to sync a different library instead of deleting everything in the cloud', async () => {
    const phone = await device();
    phone.library.add(
      { kind: 'pdf', title: 'Hostel mess rules', mimeType: 'application/pdf' },
      pdf,
    );
    await phone.engine.include(phone.epoch);
    await phone.engine.runOnce();
    // Same account state, but pointed at a new, empty library (for example a recreated database).
    const other = new SyncEngine({
      api: phone.api,
      library: new MemoryLocalLibrary(),
      state: phone.state,
      libraryId: 'recreated-library',
    });
    phone.net.controls.log.length = 0;
    expect(await other.runOnce()).toMatchObject({ blocked: 'library-mismatch', deleted: 0 });
    expect(writes(phone.net.controls.log)).toEqual([]);
    await expect(other.include(phone.epoch)).rejects.toThrow(/different library/);
    const laptop = await device();
    await laptop.engine.include(laptop.epoch);
    await laptop.engine.runOnce();
    expect(await laptop.engine.catalogue()).toHaveLength(1);
  });
});

describe('P03 accounts stay separate', () => {
  it('never shows one account its neighbour’s catalogue', async () => {
    const phone = await device();
    phone.library.add(
      { kind: 'pdf', title: 'Hostel mess rules', mimeType: 'application/pdf' },
      pdf,
    );
    await phone.engine.include(phone.epoch);
    await phone.engine.runOnce();
    const neighbour = await device(idToken({ sub: 'subject-b', email: 'student.b@iitgn.ac.in' }));
    await neighbour.engine.include(neighbour.epoch);
    await neighbour.engine.runOnce();
    expect(await neighbour.engine.catalogue()).toHaveLength(0);
  });
});
