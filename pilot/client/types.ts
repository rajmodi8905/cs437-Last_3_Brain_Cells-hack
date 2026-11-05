// Device-side sync state. Persisted per signed-in account, never shared with Local only mode.
import type { LibraryItem } from '../../src/shared';
import type { ChangeItem } from './api';

export type LocalItem = Pick<
  LibraryItem,
  'id' | 'kind' | 'title' | 'mimeType' | 'byteLength' | 'contentSha256' | 'createdAt' | 'sourceUrl'
>;

/** The parts of the app's LibraryRepository that sync reads and applies remote changes to. */
export interface LocalLibrary {
  listItems(): Promise<LocalItem[]>;
  getOriginal(id: string): Promise<Uint8Array | undefined>;
  renameItem(id: string, title: string): Promise<void>;
  deleteItem(id: string): Promise<void>;
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
    }
  | {
      kind: 'rename';
      opId: string;
      localId: string;
      globalId: string;
      title: string;
      expectedRevision: number;
    }
  | { kind: 'delete'; opId: string; localId: string; globalId: string; expectedRevision: number };

export interface SyncSnapshot {
  included: boolean;
  epoch?: number;
  cursor: number;
  needsResync?: boolean;
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
