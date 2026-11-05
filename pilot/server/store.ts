// Storage boundary for the pilot API. Memory implementations back the tests; PostgreSQL and
// Azure Blob implementations must keep the same guarantees (see docs/pilot/protocol.md).
import type { CloudItem } from '../contract';

export type ItemDescription = Omit<CloudItem, 'globalId' | 'revision' | 'deleted' | 'index'>;

export interface StoredItem extends CloudItem {
  objectKey?: string;
  indexObjectKey?: string;
}

export interface Session {
  id: string;
  csrf: string;
  ownerKey: string;
  email: string;
  expiresAt: number;
}

export interface UploadRecord {
  uploadId: string;
  ownerKey: string;
  epoch: number;
  globalId: string;
  item: ItemDescription;
  chunks: Map<number, Uint8Array>;
  result?: CloudItem;
}

/** One Google sign-in in progress, bound to the browser that started it. */
export interface LoginAttempt {
  id: string;
  state: string;
  nonce: string;
  codeVerifier: string;
  expiresAt: number;
}

export interface Change {
  cursor: number;
  item: Partial<CloudItem> & Pick<CloudItem, 'globalId' | 'revision' | 'deleted'>;
}

export interface SavedResponse {
  status: number;
  body: unknown;
}

export interface PilotStore {
  vault(ownerKey: string): Promise<{ epoch: number }>;
  createSession(session: Session): Promise<void>;
  getSession(id: string): Promise<Session | undefined>;
  deleteSession(id: string): Promise<void>;
  createLoginAttempt(attempt: LoginAttempt): Promise<void>;
  /** Returns and removes the attempt in one step, so it can be used only once. */
  takeLoginAttempt(id: string): Promise<LoginAttempt | undefined>;
  getItem(ownerKey: string, globalId: string): Promise<StoredItem | undefined>;
  /** Bytes held by live items plus reservations of unfinished uploads. */
  committedBytes(ownerKey: string): Promise<number>;
  savedResponse(ownerKey: string, opId: string): Promise<SavedResponse | undefined>;
  saveResponse(ownerKey: string, opId: string, response: SavedResponse): Promise<void>;
  createUpload(upload: UploadRecord): Promise<void>;
  getUpload(uploadId: string): Promise<UploadRecord | undefined>;
  /** Stores the item and appends its change; the cursor is allocated in the same step. */
  publish(ownerKey: string, item: StoredItem): Promise<Change>;
  changesAfter(ownerKey: string, after: number): Promise<{ cursor: number; changes: Change[] }>;
  /**
   * Removes the account's cloud library: forgets its items, change feed and unfinished uploads
   * and moves to a new epoch. Returns the removed items so their objects can be deleted.
   */
  resetVault(ownerKey: string): Promise<{ epoch: number; removed: StoredItem[] }>;
}

export interface ObjectStore {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | undefined>;
  delete(key: string): Promise<void>;
}

/** What other devices see: tombstones keep only identity and revision. */
export const publicItem = (item: StoredItem): Change['item'] => {
  if (item.deleted) return { globalId: item.globalId, revision: item.revision, deleted: true };
  const { objectKey: _objectKey, indexObjectKey: _indexObjectKey, ...visible } = item;
  return visible;
};
