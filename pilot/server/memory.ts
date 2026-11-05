// In-memory stores for tests and local development. Not durable; never use for the hosted pilot.
import {
  publicItem,
  type Change,
  type ObjectStore,
  type PilotStore,
  type SavedResponse,
  type Session,
  type StoredItem,
  type UploadRecord,
} from './store';

interface Vault {
  epoch: number;
  items: Map<string, StoredItem>;
  changes: Change[];
  responses: Map<string, SavedResponse>;
}

export class MemoryPilotStore implements PilotStore {
  private vaults = new Map<string, Vault>();
  private sessions = new Map<string, Session>();
  private uploads = new Map<string, UploadRecord>();

  private vaultOf(ownerKey: string): Vault {
    let vault = this.vaults.get(ownerKey);
    if (!vault) {
      vault = { epoch: 1, items: new Map(), changes: [], responses: new Map() };
      this.vaults.set(ownerKey, vault);
    }
    return vault;
  }

  async vault(ownerKey: string) {
    return { epoch: this.vaultOf(ownerKey).epoch };
  }
  async createSession(session: Session) {
    this.sessions.set(session.id, session);
  }
  async getSession(id: string) {
    return this.sessions.get(id);
  }
  async deleteSession(id: string) {
    this.sessions.delete(id);
  }
  async getItem(ownerKey: string, globalId: string) {
    return this.vaultOf(ownerKey).items.get(globalId);
  }
  async committedBytes(ownerKey: string) {
    let bytes = 0;
    for (const item of this.vaultOf(ownerKey).items.values())
      if (!item.deleted) bytes += item.byteLength;
    for (const upload of this.uploads.values())
      if (upload.ownerKey === ownerKey && !upload.result) bytes += upload.item.byteLength;
    return bytes;
  }
  async savedResponse(ownerKey: string, opId: string) {
    return this.vaultOf(ownerKey).responses.get(opId);
  }
  async saveResponse(ownerKey: string, opId: string, response: SavedResponse) {
    this.vaultOf(ownerKey).responses.set(opId, response);
  }
  async createUpload(upload: UploadRecord) {
    this.uploads.set(upload.uploadId, upload);
  }
  async getUpload(uploadId: string) {
    return this.uploads.get(uploadId);
  }
  async publish(ownerKey: string, item: StoredItem) {
    const vault = this.vaultOf(ownerKey);
    vault.items.set(item.globalId, item);
    const change = { cursor: vault.changes.length + 1, item: publicItem(item) };
    vault.changes.push(change);
    return change;
  }
  async changesAfter(ownerKey: string, after: number) {
    const changes = this.vaultOf(ownerKey).changes;
    return { cursor: changes.length, changes: changes.slice(after) };
  }

  async resetVault(ownerKey: string) {
    const vault = this.vaultOf(ownerKey);
    const removed = [...vault.items.values()];
    vault.epoch += 1;
    vault.items.clear();
    vault.changes = [];
    vault.responses.clear();
    for (const [id, upload] of this.uploads)
      if (upload.ownerKey === ownerKey) this.uploads.delete(id);
    return { epoch: vault.epoch, removed };
  }

  /** Test helper: which owner an upload belongs to. */
  uploadOwner(uploadId: string) {
    return this.uploads.get(uploadId)?.ownerKey;
  }
}

export class MemoryObjectStore implements ObjectStore {
  private objects = new Map<string, Uint8Array>();
  async put(key: string, bytes: Uint8Array) {
    this.objects.set(key, bytes);
  }
  async get(key: string) {
    return this.objects.get(key);
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
}
