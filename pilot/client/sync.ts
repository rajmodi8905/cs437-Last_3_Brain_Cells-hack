// Auto-sync engine. Each pass: plan local changes into saved operations, pull the server's
// change feed and apply it locally, then send the saved operations. Planning is reconciliation
// against the last agreed state, so a crash between a local save and an upload loses nothing.
import { ApiFailure, type ApiClient, type ChangeItem } from './api';
import type {
  LocalItem,
  LocalLibrary,
  Mapping,
  PendingOp,
  SyncSnapshot,
  SyncStateStore,
} from './types';

export interface SyncResult {
  uploaded: number;
  renamed: number;
  deleted: number;
  conflicts: number;
  failed: number;
  /** Set when the engine refused to run against a library other than the included one. */
  blocked?: 'library-mismatch';
}

const isNetworkError = (cause: unknown) => !(cause instanceof ApiFailure);

export class SyncEngine {
  private api: ApiClient;
  private library: LocalLibrary;
  private state: SyncStateStore;
  private newId: () => string;
  private libraryId: string;

  constructor(options: {
    api: ApiClient;
    library: LocalLibrary;
    state: SyncStateStore;
    newId?: () => string;
    /** Stable ID of the local library database being synced. */
    libraryId: string;
  }) {
    this.api = options.api;
    this.library = options.library;
    this.state = options.state;
    this.newId = options.newId ?? (() => globalThis.crypto.randomUUID());
    this.libraryId = options.libraryId;
  }

  /** Explicit opt-in: the signed-in user chose to sync this device's library. */
  async include(epoch: number) {
    const snapshot = await this.state.load();
    if (snapshot.libraryId && snapshot.libraryId !== this.libraryId)
      throw new Error('This account is already syncing a different library on this device.');
    await this.state.save({ ...snapshot, included: true, epoch, libraryId: this.libraryId });
  }

  async catalogue(): Promise<ChangeItem[]> {
    const { catalogue } = await this.state.load();
    return Object.values(catalogue).sort((a, b) => (a.title ?? '').localeCompare(b.title ?? ''));
  }

  /** Downloads a cloud original and checks it against the catalogue's hash. */
  async download(globalId: string): Promise<Uint8Array> {
    const { catalogue } = await this.state.load();
    const entry = catalogue[globalId];
    if (!entry) throw new Error('This item is not in the cloud library.');
    const bytes = await this.api.original(globalId);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as BufferSource);
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    if (hex !== entry.contentSha256)
      throw new Error('Downloaded original does not match its hash.');
    return bytes;
  }

  async runOnce(): Promise<SyncResult> {
    const result: SyncResult = { uploaded: 0, renamed: 0, deleted: 0, conflicts: 0, failed: 0 };
    const snapshot = await this.state.load();
    if (!snapshot.included || snapshot.epoch === undefined || snapshot.needsResync) return result;
    // A different or recreated library would look like mass deletion; refuse instead.
    if (snapshot.libraryId !== this.libraryId) return { ...result, blocked: 'library-mismatch' };

    this.plan(snapshot, await this.library.listItems());
    await this.state.save(snapshot);

    try {
      await this.pull(snapshot, result);
      await this.state.save(snapshot);
    } catch (cause) {
      result.failed++;
      if (cause instanceof ApiFailure && cause.code === 'RESYNC_REQUIRED') {
        snapshot.needsResync = true;
        await this.state.save(snapshot);
      }
      return result;
    }

    for (const op of [...snapshot.ops]) {
      if (!snapshot.ops.includes(op)) continue;
      try {
        await this.send(op, snapshot, result);
      } catch (cause) {
        result.failed++;
        await this.state.save(snapshot);
        if (isNetworkError(cause)) break;
        continue;
      }
      await this.state.save(snapshot);
    }
    return result;
  }

  private plan(snapshot: SyncSnapshot, local: LocalItem[]) {
    const byLocal = new Map(snapshot.mappings.map((m) => [m.localId, m]));
    const localIds = new Set(local.map((item) => item.id));
    const hasOp = (globalId: string, kind: PendingOp['kind']) =>
      snapshot.ops.some((op) => op.globalId === globalId && op.kind === kind);

    for (const item of local) {
      const mapping = byLocal.get(item.id);
      if (!mapping) {
        const globalId = this.newId();
        snapshot.mappings.push({
          localId: item.id,
          globalId,
          state: 'pending',
          syncedTitle: item.title,
        });
        snapshot.ops.push({
          kind: 'upload',
          opId: this.newId(),
          completeOpId: this.newId(),
          localId: item.id,
          globalId,
        });
      } else if (
        mapping.state === 'synced' &&
        item.title !== mapping.syncedTitle &&
        mapping.syncedRevision !== undefined &&
        !hasOp(mapping.globalId, 'rename')
      ) {
        snapshot.ops.push({
          kind: 'rename',
          opId: this.newId(),
          localId: item.id,
          globalId: mapping.globalId,
          title: item.title,
          expectedRevision: mapping.syncedRevision,
        });
      }
    }

    for (const mapping of snapshot.mappings) {
      if (localIds.has(mapping.localId)) continue;
      if (
        (mapping.state === 'synced' || mapping.state === 'conflict') &&
        mapping.syncedRevision !== undefined &&
        !hasOp(mapping.globalId, 'delete')
      ) {
        this.dropOps(snapshot, mapping.globalId);
        snapshot.ops.push({
          kind: 'delete',
          opId: this.newId(),
          localId: mapping.localId,
          globalId: mapping.globalId,
          expectedRevision: mapping.syncedRevision,
        });
      } else if (mapping.state === 'pending') {
        // Deleted locally before upload: drop it unless the server may already have it.
        const upload = snapshot.ops.find(
          (op) => op.kind === 'upload' && op.globalId === mapping.globalId,
        );
        if (!upload || !('uploadId' in upload) || !upload.uploadId) {
          this.dropOps(snapshot, mapping.globalId);
          mapping.state = 'deleted';
        }
      }
    }
  }

  private async pull(snapshot: SyncSnapshot, result: SyncResult) {
    const page = await this.api.changes(snapshot.epoch!, snapshot.cursor);
    const local = new Map((await this.library.listItems()).map((item) => [item.id, item]));
    for (const { item } of page.changes) {
      const mapping = snapshot.mappings.find((m) => m.globalId === item.globalId);
      if (item.deleted) {
        delete snapshot.catalogue[item.globalId];
        if (mapping && mapping.state !== 'deleted') {
          this.dropOps(snapshot, item.globalId);
          mapping.state = 'deleted';
          if (local.has(mapping.localId)) await this.library.deleteItem(mapping.localId);
        }
        continue;
      }
      snapshot.catalogue[item.globalId] = item;
      if (!mapping || mapping.state === 'pending' || mapping.state === 'deleted') continue;
      if (item.revision <= (mapping.syncedRevision ?? 0)) continue;
      const localItem = local.get(mapping.localId);
      if (!localItem) continue; // A local delete is pending and will win.
      const remoteTitle = item.title ?? mapping.syncedTitle;
      if (localItem.title === mapping.syncedTitle || localItem.title === remoteTitle) {
        if (localItem.title !== remoteTitle)
          await this.library.renameItem(mapping.localId, remoteTitle);
        Object.assign(mapping, {
          state: 'synced',
          syncedTitle: remoteTitle,
          syncedRevision: item.revision,
          remoteTitle: undefined,
        } satisfies Partial<Mapping>);
        this.dropOps(snapshot, item.globalId, 'rename');
      } else {
        // Both sides renamed: keep both titles and let the user choose.
        mapping.state = 'conflict';
        mapping.remoteTitle = remoteTitle;
        mapping.syncedRevision = item.revision;
        this.dropOps(snapshot, item.globalId, 'rename');
        result.conflicts++;
      }
    }
    snapshot.cursor = page.cursor;
  }

  private async send(op: PendingOp, snapshot: SyncSnapshot, result: SyncResult) {
    const mapping = snapshot.mappings.find((m) => m.globalId === op.globalId);
    const epoch = snapshot.epoch!;
    try {
      if (op.kind === 'upload') {
        const local = (await this.library.listItems()).find((item) => item.id === op.localId);
        const bytes = local ? await this.library.getOriginal(op.localId) : undefined;
        if (!local || !bytes) {
          this.dropOps(snapshot, op.globalId);
          if (mapping) mapping.state = 'deleted';
          return;
        }
        if (!op.uploadId) {
          const { kind, title, mimeType, byteLength, contentSha256, createdAt, sourceUrl } = local;
          const begun = await this.api.beginUpload(op.globalId, {
            opId: op.opId,
            epoch,
            item: { kind, title, mimeType, byteLength, contentSha256, createdAt, sourceUrl },
          });
          op.uploadId = begun.uploadId;
          op.chunkBytes = begun.chunkBytes;
          await this.state.save(snapshot);
        }
        const size = op.chunkBytes!;
        for (let n = 0; n * size < bytes.length; n++)
          await this.api.putChunk(op.uploadId, n, bytes.slice(n * size, (n + 1) * size));
        const { item } = await this.api.completeUpload(op.uploadId, {
          opId: op.completeOpId,
          epoch,
        });
        snapshot.catalogue[item.globalId] = item;
        if (mapping)
          Object.assign(mapping, {
            state: 'synced',
            syncedTitle: item.title,
            syncedRevision: item.revision,
          });
        result.uploaded++;
      } else if (op.kind === 'rename') {
        const { item } = await this.api.rename(op.globalId, {
          opId: op.opId,
          epoch,
          expectedRevision: op.expectedRevision,
          title: op.title,
        });
        snapshot.catalogue[item.globalId] = item;
        if (mapping)
          Object.assign(mapping, { syncedTitle: item.title, syncedRevision: item.revision });
        result.renamed++;
      } else {
        await this.api.remove(op.globalId, {
          opId: op.opId,
          epoch,
          expectedRevision: op.expectedRevision,
        });
        delete snapshot.catalogue[op.globalId];
        if (mapping) mapping.state = 'deleted';
        result.deleted++;
      }
      this.removeOp(snapshot, op);
    } catch (cause) {
      if (!(cause instanceof ApiFailure)) throw cause;
      if (cause.code === 'REVISION_CONFLICT' && mapping) {
        const current = cause.body.current as ChangeItem | undefined;
        mapping.state = 'conflict';
        mapping.remoteTitle = current?.title;
        if (current) mapping.syncedRevision = current.revision;
        this.removeOp(snapshot, op);
        result.conflicts++;
        return;
      }
      if ((cause.code === 'ITEM_DELETED' || cause.code === 'NOT_FOUND') && op.kind === 'delete') {
        delete snapshot.catalogue[op.globalId];
        if (mapping) mapping.state = 'deleted';
        this.removeOp(snapshot, op);
        result.deleted++;
        return;
      }
      if (mapping && cause.code !== 'INTERNAL_ERROR') {
        mapping.state = cause.code === 'ITEM_DELETED' ? 'deleted' : 'failed';
        this.removeOp(snapshot, op);
      }
      throw cause;
    }
  }

  private removeOp(snapshot: SyncSnapshot, op: PendingOp) {
    snapshot.ops = snapshot.ops.filter((candidate) => candidate !== op);
  }

  private dropOps(snapshot: SyncSnapshot, globalId: string, kind?: PendingOp['kind']) {
    snapshot.ops = snapshot.ops.filter(
      (op) => op.globalId !== globalId || (kind !== undefined && op.kind !== kind),
    );
  }
}
