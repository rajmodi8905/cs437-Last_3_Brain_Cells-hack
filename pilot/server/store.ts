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

/** An upload in progress. Its chunk bytes live in the object store under `stagingKey`. */
export interface UploadRecord {
  uploadId: string;
  ownerKey: string;
  epoch: number;
  globalId: string;
  item: ItemDescription;
  /** When the upload began, in seconds; unfinished uploads expire after a day. */
  createdAt: number;
  /** The published item, once completion succeeded. */
  result?: CloudItem;
}

export const stagingKey = (uploadId: string, n: number) => `staging/${uploadId}/${n}`;

/** Thrown by `publish` when the account's cloud library was reset since the caller checked. */
export class VaultResetError extends Error {
  constructor() {
    super('The cloud library was reset.');
    this.name = 'VaultResetError';
  }
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
  /** Serializes one owner's complete mutation; durable stores commit all its writes together. */
  withOwnerLock<T>(ownerKey: string, run: () => Promise<T>): Promise<T>;
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
  /** `savedAt` (seconds) decides when the result is cleaned up; defaults to now. */
  saveResponse(
    ownerKey: string,
    opId: string,
    response: SavedResponse,
    savedAt?: number,
  ): Promise<void>;
  createUpload(upload: UploadRecord): Promise<void>;
  getUpload(uploadId: string): Promise<UploadRecord | undefined>;
  /** Notes that chunk `n` is stored; repeating it is harmless. */
  recordChunk(uploadId: string, n: number): Promise<void>;
  /** Received chunk numbers in ascending order. */
  receivedChunks(uploadId: string): Promise<number[]>;
  /** Marks the upload complete with its published item; it no longer reserves quota. */
  finishUpload(uploadId: string, result: CloudItem): Promise<void>;
  /**
   * Stores the item and appends its change in one step, allocating the next cursor, only if the
   * account is still at `epoch`; otherwise throws `VaultResetError` and changes nothing.
   */
  publish(ownerKey: string, item: StoredItem, epoch: number): Promise<Change>;
  changesAfter(ownerKey: string, after: number): Promise<{ cursor: number; changes: Change[] }>;
  /**
   * Removes the account's cloud library: forgets its items, change feed, saved results and
   * unfinished uploads and moves to a new epoch. Returns the removed items and the abandoned
   * uploads' received chunks so their objects can be deleted.
   */
  resetVault(ownerKey: string): Promise<{
    epoch: number;
    removed: StoredItem[];
    abandoned: { uploadId: string; chunks: number[] }[];
  }>;
  /**
   * Deletes sessions and sign-in attempts that expired by `now`, unfinished uploads begun before
   * `abandonedBefore`, finished uploads begun before `finishedBefore` and operation results
   * saved before `responsesBefore`. Returns the abandoned uploads' chunks to delete.
   */
  cleanUp(
    cutoffs: CleanUpCutoffs,
  ): Promise<{ abandoned: { uploadId: string; chunks: number[] }[] }>;
}

export interface CleanUpCutoffs {
  now: number;
  abandonedBefore: number;
  finishedBefore: number;
  responsesBefore: number;
}

export interface ObjectStore {
  put(key: string, bytes: Uint8Array): Promise<void>;
  /** The object, or bytes `start` to `end` inclusive of it; undefined when it does not exist. */
  get(key: string, range?: { start: number; end: number }): Promise<Uint8Array | undefined>;
  /** Deleting a missing object is not an error. */
  delete(key: string): Promise<void>;
  /** Writes `target` as the parts joined in order, holding at most one part in memory. */
  compose(target: string, parts: string[]): Promise<void>;
  /** Keys that start with `prefix`, sorted. */
  list(prefix: string): Promise<string[]>;
}

/** What other devices see: tombstones keep only identity and revision. */
export const publicItem = (item: StoredItem): Change['item'] => {
  if (item.deleted) return { globalId: item.globalId, revision: item.revision, deleted: true };
  const { objectKey: _objectKey, indexObjectKey: _indexObjectKey, ...visible } = item;
  return visible;
};
