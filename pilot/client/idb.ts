// Sync state in IndexedDB: one database per account, one record replaced atomically.
import Dexie, { type DexieOptions, type Table } from 'dexie';
import {
  emptySnapshot,
  type OfflineCopy,
  type OfflineStore,
  type RemoteIndexEntry,
  type RemoteIndexStore,
  type SyncSnapshot,
  type SyncStateStore,
} from './types';

interface Row extends SyncSnapshot {
  id: 'state';
}

class SyncStateDatabase extends Dexie {
  state!: Table<Row, string>;
  remote!: Table<RemoteIndexEntry & { globalId: string }, string>;
  offline!: Table<OfflineCopy & { globalId: string }, string>;
  constructor(name: string, options?: DexieOptions) {
    super(name, options);
    this.version(1).stores({ state: 'id' });
    this.version(2).stores({ state: 'id', remote: 'globalId' });
    this.version(3).stores({ state: 'id', remote: 'globalId', offline: 'globalId' });
  }
}

export class IndexedDbSyncStateStore implements SyncStateStore {
  readonly databaseName: string;
  private database: SyncStateDatabase;

  /**
   * `account` is the opaque ID the server returns at sign-in. `options` lets tests give each
   * simulated device its own IndexedDB.
   */
  constructor(account: string, options?: DexieOptions) {
    if (!/^[A-Za-z0-9]{8,64}$/.test(account)) throw new Error('Invalid account ID.');
    this.databaseName = `anyrecall-pilot-sync-${account}`;
    this.database = new SyncStateDatabase(this.databaseName, options);
  }

  async load(): Promise<SyncSnapshot> {
    const row = await this.database.state.get('state');
    if (!row) return emptySnapshot();
    const { id: _id, ...snapshot } = row;
    return snapshot;
  }

  async save(snapshot: SyncSnapshot) {
    await this.database.state.put({ ...snapshot, id: 'state' });
  }

  /** Downloaded cloud indexes for this account, in the same database. */
  get remoteIndex(): RemoteIndexStore {
    const table = this.database.remote;
    return {
      get: async (globalId) => {
        const row = await table.get(globalId);
        if (!row) return undefined;
        const { globalId: _id, ...entry } = row;
        return entry;
      },
      put: async (globalId, entry) => {
        await table.put({ ...entry, globalId });
      },
      delete: async (globalId) => {
        await table.delete(globalId);
      },
      all: async () => table.toArray(),
    };
  }

  /** Cloud originals kept on this device for offline use. */
  get offline(): OfflineStore {
    const table = this.database.offline;
    return {
      get: async (globalId) => {
        const row = await table.get(globalId);
        if (!row) return undefined;
        const { globalId: _id, ...copy } = row;
        return copy;
      },
      put: async (globalId, copy) => {
        await table.put({ ...copy, globalId });
      },
      delete: async (globalId) => {
        await table.delete(globalId);
      },
      keys: async () => (await table.toCollection().primaryKeys()).map(String).sort(),
    };
  }

  /** Deletes this account's sync state, cloud indexes and offline copies from this device. */
  async destroy() {
    await this.database.delete();
  }

  close() {
    this.database.close();
  }
}
