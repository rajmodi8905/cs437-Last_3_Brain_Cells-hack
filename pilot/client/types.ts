// Device-side sync state. Persisted per signed-in account, never shared with Local only mode.
import type { ItemKind, LibraryItem, SourceLocation } from '../../src/shared';
import type { ChangeItem } from './api';

export type LocalItem = Pick<
  LibraryItem,
  | 'id'
  | 'kind'
  | 'title'
  | 'mimeType'
  | 'byteLength'
  | 'contentSha256'
  | 'createdAt'
  | 'sourceUrl'
  | 'status'
>;

/** The parts of the app's LibraryRepository that sync reads and applies remote changes to. */
export interface LocalLibrary {
  listItems(): Promise<LocalItem[]>;
  getOriginal(id: string): Promise<Uint8Array | undefined>;
  renameItem(id: string, title: string): Promise<void>;
  deleteItem(id: string): Promise<void>;
  /** Search segments of a processed (ready) item, if any. */
  getIndex?(id: string): Promise<{ indexVersion: string; segments: LocalSegment[] } | undefined>;
}

export interface LocalSegment {
  modality: 'text' | 'visual';
  location: SourceLocation;
  text?: string;
  vector: Float32Array | number[];
}

/** Link between a local item and its cloud copy. */
export interface Mapping {
  localId: string;
  globalId: string;
  state: 'pending' | 'synced' | 'conflict' | 'deleted' | 'failed';
  /** Title and revision both sides last agreed on. */
  syncedTitle: string;
  syncedRevision?: number;
  /** The other device's title while in conflict. */
  remoteTitle?: string;
  /** This device's title when the conflict was found; renaming away from it resolves the conflict. */
  conflictLocalTitle?: string;
  /** Key (hash|title digest|index version) of the index last published for this item. */
  publishedIndex?: string;
  /** Index key this device cannot publish, such as one built by an older model. */
  skippedIndex?: string;
}

/** A write saved before it is sent, so a retry reuses the same operation IDs. */
export type PendingOp =
  | {
      kind: 'upload';
      opId: string;
      completeOpId: string;
      localId: string;
      globalId: string;
      uploadId?: string;
      chunkBytes?: number;
      /** Chunks the server has acknowledged, so a resumed upload does not send them again. */
      sentChunks?: number;
    }
  | {
      kind: 'rename';
      opId: string;
      localId: string;
      globalId: string;
      title: string;
      expectedRevision: number;
    }
  | { kind: 'delete'; opId: string; localId: string; globalId: string; expectedRevision: number }
  | { kind: 'publishIndex'; opId: string; localId: string; globalId: string; key: string };

export interface SyncSnapshot {
  included: boolean;
  epoch?: number;
  cursor: number;
  needsResync?: boolean;
  /** Sync paused on this device; nothing is sent or polled. */
  paused?: boolean;
  /** The local library this state reconciles against; another library never plans deletes. */
  libraryId?: string;
  mappings: Mapping[];
  ops: PendingOp[];
  /** Live cloud items by global ID, including ones that exist only on other devices. */
  catalogue: Record<string, ChangeItem>;
}

export interface SyncStateStore {
  load(): Promise<SyncSnapshot>;
  /** Must replace the whole snapshot atomically. */
  save(snapshot: SyncSnapshot): Promise<void>;
}

export const emptySnapshot = (): SyncSnapshot => ({
  included: false,
  cursor: 0,
  mappings: [],
  ops: [],
  catalogue: {},
});

/** Downloaded index of a cloud item, kept per account for local search. */
export interface RemoteIndexEntry {
  key: string;
  kind: ItemKind;
  segments: {
    modality: 'text' | 'visual';
    location: SourceLocation;
    text?: string;
    vector: number[];
  }[];
}

export interface RemoteIndexStore {
  get(globalId: string): Promise<RemoteIndexEntry | undefined>;
  put(globalId: string, entry: RemoteIndexEntry): Promise<void>;
  delete(globalId: string): Promise<void>;
  all(): Promise<(RemoteIndexEntry & { globalId: string })[]>;
}

/** A cloud segment in the shape the app's search ranks. */
export interface CloudSegment {
  id: string;
  itemId: string;
  itemKind: ItemKind;
  modality: 'text' | 'visual';
  location: SourceLocation;
  text?: string;
  vector: Float32Array;
  indexVersion: string;
}

/** A cloud original the user chose to keep on this device. */
export interface OfflineCopy {
  bytes: Uint8Array;
  contentSha256: string;
  mimeType: string;
}

export interface OfflineStore {
  get(globalId: string): Promise<OfflineCopy | undefined>;
  put(globalId: string, copy: OfflineCopy): Promise<void>;
  delete(globalId: string): Promise<void>;
  keys(): Promise<string[]>;
}
