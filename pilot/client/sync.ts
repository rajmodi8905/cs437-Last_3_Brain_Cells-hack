// Auto-sync engine. Each pass: plan local changes into saved operations, pull the server's
// change feed and apply it locally, then send the saved operations. Planning is reconciliation
// against the last agreed state, so a crash between a local save and an upload loses nothing.
import {
  PILOT_INDEX_VERSIONS,
  searchMetadataDigest,
  validateIndexBundle,
  type CloudItem,
} from '../contract';
import { ApiFailure, type ApiClient, type ChangeItem } from './api';
import { emptySnapshot } from './types';
import type {
  CloudSegment,
  LocalItem,
  LocalLibrary,
  Mapping,
  OfflineStore,
  PendingOp,
  RemoteIndexStore,
  SyncSnapshot,
  SyncStateStore,
} from './types';

export interface SyncResult {
  uploaded: number;
  renamed: number;
  deleted: number;
  conflicts: number;
  failed: number;
  /** Index bundles this device published. */
  indexed: number;
  /** Sync was paused; any work completed before the pause is recorded in the counts. */
  paused?: true;
  /** The cloud library was removed or reset; the user must start again. */
  needsResync?: true;
  /** The account's cloud storage is full; the waiting uploads are retried later. */
  quotaExceeded?: true;
  /** Set when the engine refused to run against a library other than the included one. */
  blocked?: 'library-mismatch';
}

/** No answer, or the server asked to come back later: keep the work and stop this pass. */
const isTransient = (cause: unknown) =>
  !(cause instanceof ApiFailure) ||
  cause.code === 'RATE_LIMITED' ||
  cause.code === 'INTERNAL_ERROR';

export class SyncEngine {
  private api: ApiClient;
  private library: LocalLibrary;
  private state: SyncStateStore;
  private newId: () => string;
  private libraryId: string;
  private remoteIndex?: RemoteIndexStore;
  private offline?: OfflineStore;
  private indexVersion: string;
  private downloadRangeBytes: number;
  private paused?: boolean;

  constructor(options: {
    api: ApiClient;
    library: LocalLibrary;
    state: SyncStateStore;
    newId?: () => string;
    /** Stable ID of the local library database being synced. */
    libraryId: string;
    /** Where downloaded cloud indexes are kept; without it, no index sync happens. */
    remoteIndex?: RemoteIndexStore;
    /** Where originals kept for offline use are stored. */
    offline?: OfflineStore;
    /** The index version this device's search uses. */
    indexVersion?: string;
    /** Originals larger than this are downloaded in parts of this size. */
    downloadRangeBytes?: number;
  }) {
    this.api = options.api;
    this.library = options.library;
    this.state = options.state;
    this.newId = options.newId ?? (() => globalThis.crypto.randomUUID());
    this.libraryId = options.libraryId;
    this.remoteIndex = options.remoteIndex;
    this.offline = options.offline;
    this.indexVersion = options.indexVersion ?? PILOT_INDEX_VERSIONS[0];
    this.downloadRangeBytes = options.downloadRangeBytes ?? 4 * 1024 * 1024;
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
    const kept = await this.offline?.get(globalId);
    if (kept && kept.contentSha256 === entry.contentSha256) return kept.bytes;
    const bytes = await this.fetchOriginal(globalId, entry.byteLength);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as BufferSource);
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    if (hex !== entry.contentSha256)
      throw new Error('Downloaded original does not match its hash.');
    return bytes;
  }

  /** Large media comes in parts, each retried once, so one dropped response costs one part. */
  private async fetchOriginal(globalId: string, byteLength?: number) {
    const size = this.downloadRangeBytes;
    if (!byteLength || byteLength <= size) return this.api.original(globalId);
    const bytes = new Uint8Array(byteLength);
    for (let start = 0; start < byteLength; start += size) {
      const range = { start, end: Math.min(start + size, byteLength) - 1 };
      const part = await this.api
        .original(globalId, range)
        .catch((cause: unknown) =>
          cause instanceof ApiFailure ? Promise.reject(cause) : this.api.original(globalId, range),
        );
      bytes.set(part, start);
    }
    return bytes;
  }

  private async saveState(snapshot: SyncSnapshot): Promise<void> {
    if (this.paused !== undefined) snapshot.paused = this.paused;
    await this.state.save(snapshot);
  }

  async runOnce(): Promise<SyncResult> {
    const result: SyncResult = {
      uploaded: 0,
      renamed: 0,
      deleted: 0,
      conflicts: 0,
      failed: 0,
      indexed: 0,
    };
    const snapshot = await this.state.load();
    if (this.paused === undefined) this.paused = snapshot.paused;
    else snapshot.paused = this.paused;
    if (!snapshot.included || snapshot.epoch === undefined) return result;
    if (this.paused) return { ...result, paused: true };
    if (snapshot.needsResync) return { ...result, needsResync: true };
    // A different or recreated library would look like mass deletion; refuse instead.
    if (snapshot.libraryId !== this.libraryId) return { ...result, blocked: 'library-mismatch' };

    await this.plan(snapshot, await this.library.listItems());
    if (this.paused) return { ...result, paused: true };
    await this.saveState(snapshot);

    try {
      await this.pull(snapshot, result);
      if (this.paused) return { ...result, paused: true };
      await this.saveState(snapshot);
      await this.syncRemoteIndexes(snapshot, result);
      await this.cleanOffline(snapshot);
    } catch (cause) {
      result.failed++;
      if (cause instanceof ApiFailure && cause.code === 'RESYNC_REQUIRED') {
        snapshot.needsResync = true;
        await this.saveState(snapshot);
        return { ...result, needsResync: true };
      }
      return result;
    }

    for (const op of [...snapshot.ops]) {
      if (this.paused) return { ...result, paused: true };
      if (!snapshot.ops.includes(op)) continue;
      try {
        await this.send(op, snapshot, result);
      } catch (cause) {
        result.failed++;
        if (cause instanceof ApiFailure && cause.code === 'VAULT_RESET') {
          snapshot.needsResync = true;
          await this.saveState(snapshot);
          return { ...result, needsResync: true };
        }
        await this.saveState(snapshot);
        if (isTransient(cause)) break;
        continue;
      }
      await this.saveState(snapshot);
      if (this.paused) return { ...result, paused: true };
    }
    if (this.paused) return { ...result, paused: true };
    return result;
  }

  private async plan(snapshot: SyncSnapshot, local: LocalItem[]) {
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
      } else if (mapping.state === 'conflict' && mapping.syncedRevision !== undefined) {
        this.planConflict(snapshot, mapping, item, hasOp(mapping.globalId, 'rename'));
      }
    }

    // Publish each processed item's index once per (file, title, index version).
    if (this.library.getIndex) {
      for (const item of local) {
        const mapping =
          byLocal.get(item.id) ?? snapshot.mappings.find((m) => m.localId === item.id);
        if (!mapping || item.status !== 'ready') continue;
        if (mapping.state !== 'pending' && mapping.state !== 'synced') continue;
        const key = await this.indexKey(item);
        if (mapping.publishedIndex === key || mapping.skippedIndex === key) continue;
        if (hasOp(mapping.globalId, 'publishIndex')) continue;
        // Only queue work when there is an index to send.
        if (!(await this.library.getIndex(item.id))?.segments.length) continue;
        snapshot.ops.push({
          kind: 'publishIndex',
          opId: this.newId(),
          localId: item.id,
          globalId: mapping.globalId,
          key,
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

  /**
   * The user settles a rename conflict by renaming the item here: to the other device's title
   * (accepted with no request) or to any new title (sent against the revision now on the server).
   */
  private planConflict(
    snapshot: SyncSnapshot,
    mapping: Mapping,
    item: LocalItem,
    renameQueued: boolean,
  ) {
    if (item.title === mapping.remoteTitle) {
      Object.assign(mapping, {
        state: 'synced',
        syncedTitle: item.title,
        remoteTitle: undefined,
        conflictLocalTitle: undefined,
      } satisfies Partial<Mapping>);
      return;
    }
    // Conflicts saved before this field existed do not record which title caused them, so a
    // current title cannot be told apart from a rename the user already made. Watch from it
    // rather than send it: sending would silently overwrite the other device's title. Such a
    // conflict clears on the next rename here, or when the other device's title is chosen.
    mapping.conflictLocalTitle ??= item.title;
    if (item.title === mapping.conflictLocalTitle || renameQueued) return;
    snapshot.ops.push({
      kind: 'rename',
      opId: this.newId(),
      localId: item.id,
      globalId: mapping.globalId,
      title: item.title,
      expectedRevision: mapping.syncedRevision!,
    });
  }

  private async pull(snapshot: SyncSnapshot, result: SyncResult) {
    const page = await this.api.changes(snapshot.epoch!, snapshot.cursor);
    const local = new Map((await this.library.listItems()).map((item) => [item.id, item]));
    for (const { item } of page.changes) {
      const mapping = snapshot.mappings.find((m) => m.globalId === item.globalId);
      if (item.deleted) {
        delete snapshot.catalogue[item.globalId];
        await this.offline?.delete(item.globalId);
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
          conflictLocalTitle: undefined,
        } satisfies Partial<Mapping>);
        this.dropOps(snapshot, item.globalId, 'rename');
      } else {
        // Both sides renamed: keep both titles and let the user choose.
        mapping.state = 'conflict';
        mapping.remoteTitle = remoteTitle;
        mapping.conflictLocalTitle = localItem.title;
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
        let item: CloudItem | undefined;
        for (let attempt = 0; !item; attempt++) {
          try {
            if (!op.uploadId) {
              if (this.paused) return;
              const { kind, title, mimeType, byteLength, contentSha256, createdAt, sourceUrl } =
                local;
              const begun = await this.api.beginUpload(op.globalId, {
                opId: op.opId,
                epoch,
                item: { kind, title, mimeType, byteLength, contentSha256, createdAt, sourceUrl },
              });
              op.uploadId = begun.uploadId;
              op.chunkBytes = begun.chunkBytes;
              op.sentChunks = 0;
              await this.saveState(snapshot);
            }
            const size = op.chunkBytes!;
            for (let n = op.sentChunks ?? 0; n * size < bytes.length; n++) {
              if (this.paused) return;
              await this.api.putChunk(op.uploadId, n, bytes.slice(n * size, (n + 1) * size));
              op.sentChunks = n + 1;
              await this.saveState(snapshot);
            }
            if (this.paused) return;
            ({ item } = await this.api.completeUpload(op.uploadId, {
              opId: op.completeOpId,
              epoch,
            }));
          } catch (cause) {
            // The server expired the unfinished upload: begin once more with new operation IDs.
            if (attempt > 0 || !(cause instanceof ApiFailure) || cause.code !== 'NOT_FOUND')
              throw cause;
            Object.assign(op, {
              uploadId: undefined,
              chunkBytes: undefined,
              sentChunks: 0,
              opId: this.newId(),
              completeOpId: this.newId(),
            });
            await this.saveState(snapshot);
          }
        }
        snapshot.catalogue[item.globalId] = item;
        if (mapping)
          Object.assign(mapping, {
            state: 'synced',
            syncedTitle: item.title,
            syncedRevision: item.revision,
          });
        result.uploaded++;
      } else if (op.kind === 'rename') {
        if (this.paused) return;
        const { item } = await this.api.rename(op.globalId, {
          opId: op.opId,
          epoch,
          expectedRevision: op.expectedRevision,
          title: op.title,
        });
        snapshot.catalogue[item.globalId] = item;
        if (mapping)
          Object.assign(mapping, {
            state: 'synced',
            syncedTitle: item.title,
            syncedRevision: item.revision,
            remoteTitle: undefined,
            conflictLocalTitle: undefined,
          } satisfies Partial<Mapping>);
        result.renamed++;
      } else if (op.kind === 'publishIndex') {
        if (this.paused) return;
        await this.sendIndex(op, snapshot, mapping, result);
        return;
      } else {
        if (this.paused) return;
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
      if (cause.code === 'VAULT_RESET') throw cause;
      if (cause.code === 'QUOTA_EXCEEDED' && op.kind === 'upload') {
        // Not the item's fault: keep it waiting until space is freed.
        result.quotaExceeded = true;
        throw cause;
      }
      if (cause.code === 'REVISION_CONFLICT' && mapping) {
        const current = cause.body.current as ChangeItem | undefined;
        mapping.state = 'conflict';
        mapping.remoteTitle = current?.title;
        mapping.conflictLocalTitle = op.kind === 'rename' ? op.title : undefined;
        if (current) mapping.syncedRevision = current.revision;
        this.removeOp(snapshot, op);
        result.conflicts++;
        return;
      }
      if (op.kind === 'publishIndex') {
        // A stale or rejected index is planned again from the current local state.
        this.removeOp(snapshot, op);
        if (['INDEX_INCOMPATIBLE', 'ITEM_DELETED', 'NOT_FOUND'].includes(cause.code)) return;
        throw cause;
      }
      if ((cause.code === 'ITEM_DELETED' || cause.code === 'NOT_FOUND') && op.kind === 'delete') {
        delete snapshot.catalogue[op.globalId];
        if (mapping) mapping.state = 'deleted';
        this.removeOp(snapshot, op);
        result.deleted++;
        return;
      }
      if (mapping && !isTransient(cause)) {
        mapping.state = cause.code === 'ITEM_DELETED' ? 'deleted' : 'failed';
        this.removeOp(snapshot, op);
      }
      throw cause;
    }
  }

  async status() {
    const { included, paused, needsResync, epoch } = await this.state.load();
    return {
      included,
      paused: this.paused !== undefined ? this.paused : !!paused,
      needsResync: !!needsResync,
      epoch,
    };
  }

  /** Pause stops all sync work on this device only; cloud data is untouched. */
  async setPaused(paused: boolean) {
    this.paused = paused;
    const snapshot = await this.state.load();
    await this.state.save({ ...snapshot, paused });
  }

  /** Downloads, verifies and keeps a cloud original on this device. */
  async keepOffline(globalId: string) {
    if (!this.offline) throw new Error('Offline copies are not available here.');
    const { catalogue } = await this.state.load();
    const entry = catalogue[globalId];
    if (!entry?.contentSha256) throw new Error('This item is not in the cloud library.');
    const bytes = await this.download(globalId);
    await this.offline.put(globalId, {
      bytes,
      contentSha256: entry.contentSha256,
      mimeType: entry.mimeType ?? 'application/octet-stream',
    });
  }

  /** Removes only this device's copy; the document stays in the cloud library. */
  async removeDownload(globalId: string) {
    await this.offline?.delete(globalId);
  }

  async offlineIds() {
    return (await this.offline?.keys()) ?? [];
  }

  /** Deletes a document from the account, for every device. */
  async deleteCloudItem(globalId: string) {
    const snapshot = await this.state.load();
    const entry = snapshot.catalogue[globalId];
    if (!entry || snapshot.epoch === undefined)
      throw new Error('This item is not in the cloud library.');
    try {
      await this.api.remove(globalId, {
        opId: this.newId(),
        epoch: snapshot.epoch,
        expectedRevision: entry.revision,
      });
    } catch (cause) {
      if (!(cause instanceof ApiFailure) || !['ITEM_DELETED', 'NOT_FOUND'].includes(cause.code))
        throw cause;
    }
    delete snapshot.catalogue[globalId];
    await this.remoteIndex?.delete(globalId);
    await this.offline?.delete(globalId);
    const mapping = snapshot.mappings.find((m) => m.globalId === globalId);
    if (mapping && mapping.state !== 'deleted') {
      mapping.state = 'deleted';
      this.dropOps(snapshot, globalId);
      if ((await this.library.listItems()).some((item) => item.id === mapping.localId))
        await this.library.deleteItem(mapping.localId);
    }
    await this.state.save(snapshot);
  }

  /** Removes the whole cloud library for this account; this device then starts over, opted out. */
  async removeCloudLibrary() {
    const snapshot = await this.state.load();
    if (snapshot.epoch === undefined) throw new Error('Sign in and include a library first.');
    const result = await this.api.removeVault({
      epoch: snapshot.epoch,
      confirm: 'remove-cloud-library',
    });
    await this.resetLocal(result.vault.epoch);
    return result;
  }

  /** After a removal elsewhere: forget old cloud state; the user must include again. */
  async startAgain(epoch: number) {
    await this.resetLocal(epoch);
  }

  private async resetLocal(epoch: number) {
    const snapshot = await this.state.load();
    for (const entry of (await this.remoteIndex?.all()) ?? [])
      await this.remoteIndex!.delete(entry.globalId);
    for (const id of await this.offlineIds()) await this.offline!.delete(id);
    await this.state.save({ ...emptySnapshot(), epoch, libraryId: snapshot.libraryId });
  }

  /** Offline copies only exist for live cloud items. */
  private async cleanOffline(snapshot: SyncSnapshot) {
    for (const id of await this.offlineIds())
      if (!snapshot.catalogue[id] || snapshot.catalogue[id].deleted) await this.offline!.delete(id);
  }

  /** Cloud items' segments in the shape the app's search ranks. */
  async cloudSegments(): Promise<CloudSegment[]> {
    if (!this.remoteIndex) return [];
    const segments: CloudSegment[] = [];
    for (const entry of await this.remoteIndex.all())
      entry.segments.forEach((segment, i) =>
        segments.push({
          id: `cloud:${entry.globalId}:${i}`,
          itemId: `cloud:${entry.globalId}`,
          itemKind: entry.kind,
          modality: segment.modality,
          location: segment.location,
          text: segment.text,
          vector: Float32Array.from(segment.vector),
          indexVersion: this.indexVersion,
        }),
      );
    return segments;
  }

  private async indexKey(item: { contentSha256: string; title: string }) {
    return `${item.contentSha256}|${await searchMetadataDigest(item)}|${this.indexVersion}`;
  }

  private async sendIndex(
    op: Extract<PendingOp, { kind: 'publishIndex' }>,
    snapshot: SyncSnapshot,
    mapping: Mapping | undefined,
    result: SyncResult,
  ) {
    const local = (await this.library.listItems()).find((item) => item.id === op.localId);
    const index = local ? await this.library.getIndex?.(op.localId) : undefined;
    if (!mapping || !local || !index || mapping.state !== 'synced') {
      this.removeOp(snapshot, op);
      return;
    }
    const key = await this.indexKey(local);
    if (key !== op.key) {
      this.removeOp(snapshot, op);
      return;
    }
    if (index.indexVersion !== this.indexVersion) {
      mapping.skippedIndex = key;
      this.removeOp(snapshot, op);
      return;
    }
    if (this.paused) return;
    const { item } = await this.api.publishIndex(op.globalId, {
      opId: op.opId,
      epoch: snapshot.epoch!,
      bundle: {
        globalId: op.globalId,
        contentSha256: local.contentSha256,
        searchMetadataDigest: await searchMetadataDigest(local),
        indexVersion: index.indexVersion,
        dimension: 768,
        segments: index.segments.map((segment) => ({
          modality: segment.modality,
          location: segment.location,
          ...(segment.text !== undefined ? { text: segment.text } : {}),
          vector: Array.from(segment.vector),
        })),
      },
    });
    snapshot.catalogue[item.globalId] = item;
    mapping.publishedIndex = key;
    this.removeOp(snapshot, op);
    result.indexed++;
  }

  /** Keeps a usable local copy of each other-device item's index; drops stale ones. */
  private async syncRemoteIndexes(snapshot: SyncSnapshot, result: SyncResult) {
    if (!this.remoteIndex) return;
    const mine = new Set(
      snapshot.mappings.filter((m) => m.state !== 'deleted').map((m) => m.globalId),
    );
    const wanted = new Set<string>();
    for (const item of Object.values(snapshot.catalogue)) {
      if (item.deleted || mine.has(item.globalId) || !item.index || !item.contentSha256) continue;
      const usable =
        item.index.indexVersion === this.indexVersion &&
        item.index.contentSha256 === item.contentSha256 &&
        item.index.searchMetadataDigest ===
          (await searchMetadataDigest({ title: item.title ?? '' }));
      if (!usable) continue;
      wanted.add(item.globalId);
      const key = `${item.contentSha256}|${item.index.searchMetadataDigest}|${item.index.indexVersion}`;
      if ((await this.remoteIndex.get(item.globalId))?.key === key) continue;
      try {
        const bundle = await this.api.index(item.globalId);
        const valid = validateIndexBundle(
          bundle,
          {
            globalId: item.globalId,
            contentSha256: item.contentSha256,
            searchMetadataDigest: item.index.searchMetadataDigest,
          },
          [this.indexVersion],
        );
        if (!valid.ok) {
          wanted.delete(item.globalId);
          continue;
        }
        await this.remoteIndex.put(item.globalId, {
          key,
          kind: item.kind!,
          segments: bundle.segments,
        });
      } catch {
        result.failed++;
      }
    }
    for (const entry of await this.remoteIndex.all())
      if (!wanted.has(entry.globalId)) await this.remoteIndex.delete(entry.globalId);
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
