// Sync state in IndexedDB: one database per account, one record replaced atomically.
import Dexie, { type DexieOptions, type Table } from 'dexie';
import { emptySnapshot, type SyncSnapshot, type SyncStateStore } from './types';

interface Row extends SyncSnapshot {
  id: 'state';
}

class SyncStateDatabase extends Dexie {
  state!: Table<Row, string>;
  constructor(name: string, options?: DexieOptions) {
    super(name, options);
    this.version(1).stores({ state: 'id' });
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
    this.databaseName = `campus-recall-pilot-sync-${account}`;
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

  close() {
    this.database.close();
  }
}
