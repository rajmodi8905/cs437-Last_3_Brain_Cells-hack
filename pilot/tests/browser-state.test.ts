import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { IndexedDbSyncStateStore } from '../client/idb';
import { emptySnapshot } from '../client/types';

const unique = () => `acct${Math.random().toString(16).slice(2, 14)}`;

describe('Sync state saved in the browser', () => {
  it('starts empty and keeps a saved snapshot across reopening', async () => {
    const account = unique();
    const first = new IndexedDbSyncStateStore(account);
    expect(await first.load()).toEqual(emptySnapshot());
    const snapshot = {
      ...emptySnapshot(),
      included: true,
      epoch: 1,
      cursor: 4,
      mappings: [
        {
          localId: 'l1',
          globalId: 'g1',
          state: 'synced' as const,
          syncedTitle: 'A',
          syncedRevision: 2,
        },
      ],
    };
    await first.save(snapshot);
    first.close();
    const reopened = new IndexedDbSyncStateStore(account);
    expect(await reopened.load()).toEqual(snapshot);
    reopened.close();
  });

  it('replaces the whole snapshot on save', async () => {
    const store = new IndexedDbSyncStateStore(unique());
    await store.save({
      ...emptySnapshot(),
      cursor: 9,
      catalogue: { g1: { globalId: 'g1', revision: 1, deleted: false } },
    });
    await store.save({ ...emptySnapshot(), cursor: 10 });
    expect(await store.load()).toEqual({ ...emptySnapshot(), cursor: 10 });
    store.close();
  });

  it('keeps each account in its own database', async () => {
    const a = new IndexedDbSyncStateStore(unique());
    const b = new IndexedDbSyncStateStore(unique());
    await a.save({ ...emptySnapshot(), included: true, cursor: 3 });
    expect(await b.load()).toEqual(emptySnapshot());
    expect(a.databaseName).not.toBe(b.databaseName);
    a.close();
    b.close();
  });

  it('keeps downloaded cloud indexes across reopening', async () => {
    const account = unique();
    const first = new IndexedDbSyncStateStore(account);
    const entry = {
      key: 'k1',
      kind: 'pdf' as const,
      segments: [
        {
          modality: 'text' as const,
          location: { kind: 'page' as const, page: 2 },
          text: 'x',
          vector: [1, 0],
        },
      ],
    };
    await first.remoteIndex.put('g1', entry);
    first.close();
    const reopened = new IndexedDbSyncStateStore(account);
    expect(await reopened.remoteIndex.get('g1')).toEqual(entry);
    expect(await reopened.remoteIndex.all()).toEqual([{ globalId: 'g1', ...entry }]);
    await reopened.remoteIndex.delete('g1');
    expect(await reopened.remoteIndex.get('g1')).toBeUndefined();
    reopened.close();
  });

  it('refuses an account ID that could reach another database name', () => {
    expect(() => new IndexedDbSyncStateStore('../anyrecall')).toThrow();
    expect(() => new IndexedDbSyncStateStore('')).toThrow();
  });
});
