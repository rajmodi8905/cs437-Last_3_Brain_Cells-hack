// Auto-sync engine. Each pass: plan local changes into saved operations, pull the server's
// change feed and apply it locally, then send the saved operations. Planning is reconciliation
// against the last agreed state, so a crash between a local save and an upload loses nothing.
import {
  PILOT_INDEX_VERSIONS,
  pickItemDescription,
  searchMetadataDigest,
  validateIndexBundle,
  type IndexBundle,
} from '../contract';
import {
  E2EE_FORMAT,
  E2eeError,
  ORIGINAL_CHUNK_BYTES,
  TAG_BYTES,
  cipherChunkRange,
  decodeRecoveryCode,
  deriveVaultKeys,
  encodeRecoveryCode,
  fromBase64url,
  keyCheck,
  newItemKey,
  newPairingKeys,
  newRecoverySecret,
  newVaultSalt,
  openIndexBundle,
  openMeta,
  openOriginalChunk,
  openPairingSecret,
  pairingCheckNumber,
  pairingCommitment,
  plainOriginalLength,
  sealIndexBundle,
  sealMeta,
  sealOriginal,
  sealPairingSecret,
  toBase64url,
  unwrapItemKey,
  verifyKeyCheck,
  wrapItemKey,
  type PairingKeys,
  type SealedItemFields,
  type SealedMeta,
  type VaultKeys,
} from '../contract/e2ee';
import { ApiFailure, isAccountChanged, type ApiClient, type ChangeItem } from './api';
import { emptySnapshot } from './types';
import type {
  CloudSegment,
  LocalItem,
  LocalLibrary,
  Mapping,
  OfflineStore,
  PendingOp,
  RemoteIndexEntry,
  RemoteIndexStore,
  SyncSnapshot,
  SyncStateStore,
  VaultSecretStore,
} from './types';

/**
 * Where a pairing stands on this device: waiting for the other device, showing the check
 * number to compare, or done. A new device is done once it holds the library's key.
 */
export type PairingProgress =
  { stage: 'waiting' } | { stage: 'compare'; checkNumber: string } | { stage: 'done' };

/** A pairing in progress; it lives only in memory, as its private key does. */
interface Pairing {
  role: 'new' | 'old';
  pairingId: string;
  keys: PairingKeys;
  /** Old device: the hash the new device committed to. */
  commitment?: string;
  /** New device: the old device's key, as first received. */
  oldPublicKey?: string;
  /** Old device: the new device's key, once it matched the commitment. */
  newPublicKey?: string;
  /** New device: the student said both devices show the same number. */
  confirmed?: boolean;
}

/** Opens an encrypted library's items outside a sync pass, as an export does. */
export interface SealedReader {
  /** The item with the fields its sealed metadata holds. */
  open(item: ChangeItem): Promise<ChangeItem>;
  /** The item's original, downloaded and decrypted. */
  original(item: ChangeItem): Promise<Uint8Array>;
}

const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256Hex = async (bytes: Uint8Array) =>
  hex(await globalThis.crypto.subtle.digest('SHA-256', bytes as BufferSource));

export interface SyncResult {
  uploaded: number;
  renamed: number;
  deleted: number;
  conflicts: number;
  failed: number;
  /** Index bundles this device published. */
  indexed: number;
  /** Plain cloud items this device sealed in place after encryption was turned on. */
  resealed?: number;
  /** Sync was paused; any work completed before the pause is recorded in the counts. */
  paused?: true;
  /** The cloud library was removed or reset; the user must start again. */
  needsResync?: true;
  /** The account's cloud storage is full; the waiting uploads are retried later. */
  quotaExceeded?: true;
  /** Set when the engine refused to run against a library other than the included one. */
  blocked?: 'library-mismatch';
  /**
   * The library is end-to-end encrypted and this device does not have its key yet: nothing
   * was applied or sent. Enter the recovery code, or pair with a device that has it.
   */
  locked?: true;
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
  private vaultSecret?: VaultSecretStore;
  /** Vault keys derived for the settings and epoch they were checked against. */
  private keyCache?: { vaultSalt: string; epoch: number; keys: VaultKeys };
  private pairing?: Pairing;

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
    /** Where this device keeps an encrypted library's recovery secret. */
    vaultSecret?: VaultSecretStore;
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
    this.vaultSecret = options.vaultSecret;
  }

  /** Explicit opt-in: the signed-in user chose to sync this device's library. */
  async include(epoch: number) {
    const snapshot = await this.state.load();
    if (snapshot.libraryId && snapshot.libraryId !== this.libraryId)
      throw new Error('This account is already syncing a different library on this device.');
    await this.state.save({ ...snapshot, included: true, epoch, libraryId: this.libraryId });
  }

  /**
   * Read only, for an account whose device library is not included: fetches the cloud
   * catalogue and the usable index bundles so cloud items are listed and searchable. Nothing is
   * planned or sent, so this device's library stays on the device (P02).
   */
  async browse(epoch: number): Promise<SyncResult> {
    const result: SyncResult = {
      uploaded: 0,
      renamed: 0,
      deleted: 0,
      conflicts: 0,
      failed: 0,
      indexed: 0,
    };
    const snapshot = await this.state.load();
    if (snapshot.included) return result;
    const restart = () => {
      snapshot.epoch = epoch;
      snapshot.cursor = 0;
      snapshot.catalogue = {};
    };
    if (snapshot.epoch !== epoch) restart();
    try {
      await this.pull(snapshot, result);
      if (!result.locked) {
        await this.syncRemoteIndexes(snapshot, result);
        await this.cleanOffline(snapshot);
      }
    } catch (cause) {
      // The browser now has another account's session: keep nothing, let the app follow it.
      if (isAccountChanged(cause)) throw cause;
      result.failed++;
      // Nothing of this device is mapped yet, so a reset library is simply listed again.
      if (cause instanceof ApiFailure && cause.code === 'RESYNC_REQUIRED') restart();
    }
    await this.state.save(snapshot);
    return result;
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
    const bytes = entry.sealed
      ? await (await this.requireReader()).original(entry)
      : await this.fetchOriginal(globalId, entry.byteLength);
    if ((await sha256Hex(bytes)) !== entry.contentSha256)
      throw new Error('Downloaded original does not match its hash.');
    return bytes;
  }

  /**
   * An encrypted original, one sealed chunk per request when it has several. Each chunk is
   * opened as it arrives, so a changed, moved or cut chunk fails at once.
   */
  private async fetchSealedOriginal(keys: VaultKeys, epoch: number, entry: ChangeItem) {
    const sealed = entry.sealed!;
    const itemKey = await unwrapItemKey(keys, sealed.wrappedKey);
    const ctx = { globalId: entry.globalId, epoch };
    const cipherLength = sealed.cipherByteLength;
    const plainLength = plainOriginalLength(cipherLength);
    if (plainLength === null) throw new E2eeError('INVALID_FORMAT', 'Sealed length is not valid.');
    const out = new Uint8Array(plainLength);
    const whole = cipherLength <= ORIGINAL_CHUNK_BYTES + TAG_BYTES;
    for (let i = 0; ; i++) {
      const range = cipherChunkRange(i, cipherLength);
      if (!range) break;
      const part = whole
        ? await this.api.original(entry.globalId)
        : await this.api
            .original(entry.globalId, range)
            .catch((cause: unknown) =>
              cause instanceof ApiFailure
                ? Promise.reject(cause)
                : this.api.original(entry.globalId, range),
            );
      out.set(
        await openOriginalChunk(itemKey, part, ctx, i, range.isLast),
        i * ORIGINAL_CHUNK_BYTES,
      );
    }
    return out;
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
      if (result.locked) return result;
      await this.syncRemoteIndexes(snapshot, result);
      await this.cleanOffline(snapshot);
      await this.planReseals(snapshot);
      await this.saveState(snapshot);
    } catch (cause) {
      // Another account's session: stop without changing this account's state.
      if (isAccountChanged(cause)) throw cause;
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
        if (isAccountChanged(cause)) {
          // Progress already made (an upload's ID and chunks) is kept for when it is back.
          await this.saveState(snapshot);
          throw cause;
        }
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
    snapshot.e2ee = page.e2ee;
    const keys = await this.vaultKeys(snapshot);
    // Without the key nothing can be read, and anything sent would be refused or plaintext.
    if (snapshot.e2ee && !keys) {
      result.locked = true;
      return;
    }
    const local = new Map((await this.library.listItems()).map((item) => [item.id, item]));
    for (const change of page.changes) {
      let item = change.item;
      const mapping = snapshot.mappings.find((m) => m.globalId === item.globalId);
      if (item.sealed && !item.deleted) {
        try {
          item = await this.openItem(item, keys, snapshot.epoch!);
        } catch (cause) {
          if (!(cause instanceof E2eeError)) throw cause;
          // Tampered or moved: the item stays as this device last had it.
          result.failed++;
          continue;
        }
      }
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
      if (remoteTitle === mapping.syncedTitle && localItem.title !== remoteTitle) {
        // The other side kept the title and changed something else (it sealed the item): this
        // device's rename still stands, now against the new revision.
        mapping.syncedRevision = item.revision;
        for (const queued of snapshot.ops)
          if (queued.kind === 'rename' && queued.globalId === item.globalId)
            queued.expectedRevision = item.revision;
        continue;
      }
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
    // This device's sealed items whose cloud copy has no index for its current metadata (it
    // was sealed by another device, or its index went with the plain copy) are indexed again.
    for (const mapping of snapshot.mappings) {
      const entry = snapshot.catalogue[mapping.globalId];
      if (mapping.state !== 'synced' || !entry?.sealed) continue;
      if (entry.sealedIndex?.metaRevision !== entry.sealed.metaRevision)
        delete mapping.publishedIndex;
    }
  }

  private async send(op: PendingOp, snapshot: SyncSnapshot, result: SyncResult) {
    const mapping = snapshot.mappings.find((m) => m.globalId === op.globalId);
    const epoch = snapshot.epoch!;
    try {
      if (op.kind === 'upload') {
        const local = (await this.library.listItems()).find((item) => item.id === op.localId);
        const bytes = local ? await this.library.getOriginal(op.localId) : undefined;
        if (!local || !bytes) {
          // Deleted here after the upload began. The server may have finished it with the
          // reply lost, so ask before dropping it; a finished one is deleted from the cloud too.
          if (op.uploadId && this.paused) return;
          const begun = op.uploadId ? await this.finishedUpload(op, epoch) : undefined;
          this.dropOps(snapshot, op.globalId);
          if (!begun) {
            if (mapping) mapping.state = 'deleted';
            return;
          }
          const finished = await this.opened(begun, snapshot);
          snapshot.catalogue[finished.globalId] = finished;
          if (mapping)
            Object.assign(mapping, {
              state: 'synced',
              syncedTitle: finished.title ?? mapping.syncedTitle,
              syncedRevision: finished.revision,
            });
          const remove: PendingOp = {
            kind: 'delete',
            opId: this.newId(),
            localId: op.localId,
            globalId: op.globalId,
            expectedRevision: finished.revision,
          };
          snapshot.ops.push(remove);
          await this.saveState(snapshot);
          await this.send(remove, snapshot, result);
          return;
        }
        // An encrypted library gets the sealed original; an upload begun in plain stays plain.
        const sealing =
          op.sealed || (!op.uploadId && snapshot.e2ee)
            ? await this.sealForUpload(op, snapshot, pickItemDescription(local), bytes)
            : undefined;
        const { kind, title, mimeType, byteLength, contentSha256, createdAt, sourceUrl } = local;
        let item = await this.transfer(op, snapshot, sealing?.payload ?? bytes, () =>
          this.api.beginUpload(
            op.globalId,
            sealing
              ? { opId: op.opId, epoch, sealed: sealing.sealed }
              : {
                  opId: op.opId,
                  epoch,
                  item: { kind, title, mimeType, byteLength, contentSha256, createdAt, sourceUrl },
                },
          ),
        );
        if (!item) return;
        item = await this.opened(item, snapshot);
        snapshot.catalogue[item.globalId] = item;
        if (mapping)
          Object.assign(mapping, {
            state: 'synced',
            syncedTitle: item.title ?? local.title,
            syncedRevision: item.revision,
          });
        result.uploaded++;
      } else if (op.kind === 'rename') {
        if (this.paused) return;
        const entry = snapshot.catalogue[op.globalId];
        let renamed: ChangeItem;
        if (entry?.sealed) {
          // The title is sealed again with the item's own key, under the next metaRevision.
          const itemKey = await unwrapItemKey(
            await this.requireKeys(snapshot),
            entry.sealed.wrappedKey,
          );
          const metaRevision = entry.sealed.metaRevision + 1;
          const sealedMeta = await sealMeta(
            itemKey,
            { ...pickItemDescription(entry), title: op.title },
            { globalId: op.globalId, epoch, metaRevision },
          );
          ({ item: renamed } = await this.api.rename(op.globalId, {
            opId: op.opId,
            epoch,
            expectedRevision: op.expectedRevision,
            sealedMeta,
            metaRevision,
          }));
        } else {
          ({ item: renamed } = await this.api.rename(op.globalId, {
            opId: op.opId,
            epoch,
            expectedRevision: op.expectedRevision,
            title: op.title,
          }));
        }
        const item = await this.opened(renamed, snapshot);
        snapshot.catalogue[item.globalId] = item;
        if (mapping)
          Object.assign(mapping, {
            state: 'synced',
            syncedTitle: item.title ?? op.title,
            syncedRevision: item.revision,
            remoteTitle: undefined,
            conflictLocalTitle: undefined,
          } satisfies Partial<Mapping>);
        result.renamed++;
      } else if (op.kind === 'publishIndex') {
        if (this.paused) return;
        await this.sendIndex(op, snapshot, mapping, result);
        return;
      } else if (op.kind === 'reseal') {
        if (this.paused) return;
        await this.sendReseal(op, snapshot, mapping, result);
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
      // Neither says anything about this item: the operation stays queued as it is.
      if (cause.code === 'VAULT_RESET' || cause.code === 'ACCOUNT_CHANGED') throw cause;
      if (cause.code === 'QUOTA_EXCEEDED' && op.kind === 'upload') {
        // Not the item's fault: keep it waiting until space is freed.
        result.quotaExceeded = true;
        throw cause;
      }
      if (cause.code === 'REVISION_CONFLICT' && mapping) {
        const listed = cause.body.current as ChangeItem | undefined;
        const current = listed && (await this.opened(listed, snapshot).catch(() => listed));
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

  /**
   * The item an upload created, if the server finished it. Completion is idempotent, so this
   * returns the item when an earlier reply was lost, and nothing when the upload never finished.
   */
  private async finishedUpload(
    op: Extract<PendingOp, { kind: 'upload' }>,
    epoch: number,
  ): Promise<ChangeItem | undefined> {
    try {
      return (await this.api.completeUpload(op.uploadId!, { opId: op.completeOpId, epoch })).item;
    } catch (cause) {
      const neverFinished = ['NOT_FOUND', 'INVALID_INPUT', 'HASH_MISMATCH', 'ITEM_DELETED'];
      if (cause instanceof ApiFailure && neverFinished.includes(cause.code)) return undefined;
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
    // A new epoch has no encryption settings; the old secret can open nothing any more.
    await this.vaultSecret?.delete();
    this.keyCache = undefined;
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
    const epoch = snapshot.epoch!;
    const bundle: IndexBundle = {
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
    };
    const entry = snapshot.catalogue[op.globalId];
    let published: ChangeItem;
    if (entry?.sealed) {
      // The server cannot check a sealed bundle against the item, so this device does: the
      // cloud copy must already carry this original and title, or the index waits for it.
      if (entry.contentSha256 !== local.contentSha256 || entry.title !== local.title) {
        this.removeOp(snapshot, op);
        return;
      }
      const itemKey = await unwrapItemKey(
        await this.requireKeys(snapshot),
        entry.sealed.wrappedKey,
      );
      const metaRevision = entry.sealed.metaRevision;
      const sealedIndex = await sealIndexBundle(itemKey, bundle, {
        globalId: op.globalId,
        epoch,
        metaRevision,
      });
      ({ item: published } = await this.api.publishIndex(op.globalId, {
        opId: op.opId,
        epoch,
        sealedIndex: toBase64url(sealedIndex),
        metaRevision,
      }));
    } else {
      ({ item: published } = await this.api.publishIndex(op.globalId, {
        opId: op.opId,
        epoch,
        bundle,
      }));
    }
    const item = await this.opened(published, snapshot);
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
      if (item.deleted || mine.has(item.globalId) || !item.contentSha256) continue;
      if (item.sealed) {
        if (await this.syncSealedIndex(snapshot, item, result)) wanted.add(item.globalId);
        continue;
      }
      if (!item.index) continue;
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
      } catch (cause) {
        if (isAccountChanged(cause)) throw cause;
        result.failed++;
      }
    }
    for (const entry of await this.remoteIndex.all())
      if (!wanted.has(entry.globalId)) await this.remoteIndex.delete(entry.globalId);
  }

  /**
   * Seals `bytes` for an upload. The item key (wrapped) and sealed metadata are kept on `op`
   * before anything is sent, so a resumed upload seals exactly the same ciphertext again.
   */
  private async sealForUpload(
    op: { globalId: string; sealed?: { wrappedKey: string; sealedMeta: string } },
    snapshot: SyncSnapshot,
    meta: SealedMeta,
    bytes: Uint8Array,
  ) {
    const keys = await this.requireKeys(snapshot);
    const epoch = snapshot.epoch!;
    if (!op.sealed) {
      const itemKey = await newItemKey();
      op.sealed = {
        wrappedKey: await wrapItemKey(keys, itemKey),
        sealedMeta: await sealMeta(itemKey, meta, {
          globalId: op.globalId,
          epoch,
          metaRevision: 1,
        }),
      };
      await this.saveState(snapshot);
    }
    const itemKey = await unwrapItemKey(keys, op.sealed.wrappedKey);
    const payload = await sealOriginal(itemKey, bytes, { globalId: op.globalId, epoch });
    const sealed: SealedItemFields = {
      enc: E2EE_FORMAT,
      ...op.sealed,
      metaRevision: 1,
      cipherByteLength: payload.length,
      cipherSha256: await sha256Hex(payload),
    };
    return { payload, sealed };
  }

  /**
   * Sends `payload` through an upload: begins it once, sends the chunks the server has not
   * acknowledged, and completes it. Returns undefined when sync was paused on the way. When the
   * server expired the unfinished upload, it begins once more under new operation IDs.
   */
  private async transfer(
    op: {
      opId: string;
      completeOpId: string;
      uploadId?: string;
      chunkBytes?: number;
      sentChunks?: number;
    },
    snapshot: SyncSnapshot,
    payload: Uint8Array,
    begin: () => Promise<{ uploadId: string; chunkBytes: number }>,
  ): Promise<ChangeItem | undefined> {
    const epoch = snapshot.epoch!;
    for (let attempt = 0; ; attempt++) {
      try {
        if (!op.uploadId) {
          if (this.paused) return undefined;
          const begun = await begin();
          op.uploadId = begun.uploadId;
          op.chunkBytes = begun.chunkBytes;
          op.sentChunks = 0;
          await this.saveState(snapshot);
        }
        const size = op.chunkBytes!;
        for (let n = op.sentChunks ?? 0; n * size < payload.length; n++) {
          if (this.paused) return undefined;
          await this.api.putChunk(op.uploadId, n, payload.slice(n * size, (n + 1) * size));
          op.sentChunks = n + 1;
          await this.saveState(snapshot);
        }
        if (this.paused) return undefined;
        return (await this.api.completeUpload(op.uploadId, { opId: op.completeOpId, epoch })).item;
      } catch (cause) {
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
  }

  /**
   * After a pull in an encrypted library: queues a reseal for each plain cloud item that is not
   * a bot item and has no other work queued. The bot's list is asked for only while some plain
   * item is not yet known to be one.
   */
  private async planReseals(snapshot: SyncSnapshot) {
    if (!snapshot.e2ee || !(await this.vaultKeys(snapshot))) return;
    const busy = new Set(snapshot.ops.map((op) => op.globalId));
    const candidates = () => {
      const bot = new Set(snapshot.botItems ?? []);
      return Object.values(snapshot.catalogue).filter(
        (item) =>
          !item.deleted &&
          !item.sealed &&
          !bot.has(item.globalId) &&
          !busy.has(item.globalId) &&
          snapshot.resealSkipped?.[item.globalId] !== item.revision,
      );
    };
    if (!candidates().length) return;
    snapshot.botItems = (await this.api.botItems()).globalIds;
    for (const item of candidates()) {
      const mapping = snapshot.mappings.find((m) => m.globalId === item.globalId);
      // Only a settled item: a pending rename or conflict here is sorted out first.
      if (mapping && mapping.state !== 'synced') continue;
      snapshot.ops.push({
        kind: 'reseal',
        opId: this.newId(),
        completeOpId: this.newId(),
        globalId: item.globalId,
        localId: mapping?.localId,
        expectedRevision: item.revision,
      });
    }
  }

  /**
   * Seals a plain cloud item in place: from this device's copy when it has the same original,
   * otherwise downloaded and checked. An item only another device had keeps the index this
   * device downloaded for it, sealed; this device's own items publish theirs again sealed.
   */
  private async sendReseal(
    op: Extract<PendingOp, { kind: 'reseal' }>,
    snapshot: SyncSnapshot,
    mapping: Mapping | undefined,
    result: SyncResult,
  ) {
    const epoch = snapshot.epoch!;
    const entry = snapshot.catalogue[op.globalId];
    if (!entry || entry.deleted || entry.sealed || entry.revision !== op.expectedRevision) {
      this.removeOp(snapshot, op);
      return;
    }
    try {
      let bytes: Uint8Array | undefined;
      if (op.localId) {
        const local = (await this.library.listItems()).find((item) => item.id === op.localId);
        if (local?.contentSha256 === entry.contentSha256)
          bytes = await this.library.getOriginal(op.localId);
      }
      bytes ??= await this.download(op.globalId);
      const sealing = await this.sealForUpload(op, snapshot, pickItemDescription(entry), bytes);
      const done = await this.transfer(op, snapshot, sealing.payload, () =>
        this.api.beginUpload(op.globalId, {
          opId: op.opId,
          epoch,
          sealed: sealing.sealed,
          reseal: { expectedRevision: op.expectedRevision },
        }),
      );
      if (!done) return;
      let item = await this.opened(done, snapshot);
      if (mapping) {
        mapping.syncedRevision = item.revision;
        // Its plain index went with the plain item: this device publishes it again, sealed.
        delete mapping.publishedIndex;
      } else {
        const kept = await this.remoteIndex?.get(op.globalId);
        if (kept?.segments.length && entry.index?.indexVersion === this.indexVersion) {
          op.indexOpId ??= this.newId();
          await this.saveState(snapshot);
          const itemKey = await unwrapItemKey(
            await this.requireKeys(snapshot),
            item.sealed!.wrappedKey,
          );
          const metaRevision = item.sealed!.metaRevision;
          const bundle: IndexBundle = {
            globalId: op.globalId,
            contentSha256: entry.contentSha256!,
            searchMetadataDigest: await searchMetadataDigest({ title: entry.title ?? '' }),
            indexVersion: this.indexVersion,
            dimension: 768,
            segments: kept.segments,
          };
          const sealedIndex = await sealIndexBundle(itemKey, bundle, {
            globalId: op.globalId,
            epoch,
            metaRevision,
          });
          item = await this.opened(
            (
              await this.api.publishIndex(op.globalId, {
                opId: op.indexOpId,
                epoch,
                sealedIndex: toBase64url(sealedIndex),
                metaRevision,
              })
            ).item,
            snapshot,
          );
        }
      }
      snapshot.catalogue[op.globalId] = item;
      result.resealed = (result.resealed ?? 0) + 1;
      this.removeOp(snapshot, op);
    } catch (cause) {
      if (!(cause instanceof ApiFailure)) throw cause;
      if (cause.code === 'VAULT_RESET' || cause.code === 'ACCOUNT_CHANGED' || isTransient(cause))
        throw cause;
      this.removeOp(snapshot, op);
      if (cause.code === 'QUOTA_EXCEEDED') {
        result.quotaExceeded = true;
        return;
      }
      // Changed or deleted meanwhile: the next pull shows what it is now, and it is planned again.
      if (['REVISION_CONFLICT', 'ITEM_DELETED', 'NOT_FOUND'].includes(cause.code)) return;
      (snapshot.resealSkipped ??= {})[op.globalId] = op.expectedRevision;
      result.failed++;
    }
  }

  /**
   * Keeps the opened index of an encrypted item from another device. Only a bundle sealed for
   * the item's current metadata is used; one that does not open or does not match it is kept
   * as empty, so it is not downloaded again until the item changes. Returns whether it is kept.
   */
  private async syncSealedIndex(snapshot: SyncSnapshot, item: ChangeItem, result: SyncResult) {
    const sealed = item.sealed!;
    if (!item.sealedIndex || item.sealedIndex.metaRevision !== sealed.metaRevision) return false;
    const keys = await this.vaultKeys(snapshot);
    if (!keys) return false;
    const key = `sealed|${sealed.metaRevision}|${item.sealedIndex.byteLength}|${this.indexVersion}`;
    if ((await this.remoteIndex!.get(item.globalId))?.key === key) return true;
    const ctx = {
      globalId: item.globalId,
      epoch: snapshot.epoch!,
      metaRevision: sealed.metaRevision,
    };
    let usable: RemoteIndexEntry['segments'] = [];
    try {
      const itemKey = await unwrapItemKey(keys, sealed.wrappedKey);
      const bundle = await openIndexBundle(itemKey, await this.api.sealedIndex(item.globalId), ctx);
      const valid = validateIndexBundle(
        bundle,
        {
          globalId: item.globalId,
          contentSha256: item.contentSha256!,
          searchMetadataDigest: await searchMetadataDigest({ title: item.title ?? '' }),
        },
        [this.indexVersion],
      );
      if (valid.ok) usable = bundle.segments;
    } catch (cause) {
      if (isAccountChanged(cause)) throw cause;
      result.failed++;
      // A network failure is tried again next pass; a bundle that does not open is kept empty.
      if (!(cause instanceof E2eeError)) return false;
    }
    await this.remoteIndex!.put(item.globalId, { key, kind: item.kind!, segments: usable });
    return true;
  }

  /**
   * The vault keys for the library's current settings, when this device holds the matching
   * recovery secret and it passes the key check.
   */
  private async vaultKeys(snapshot: SyncSnapshot): Promise<VaultKeys | undefined> {
    const settings = snapshot.e2ee;
    const epoch = snapshot.epoch;
    if (!settings || epoch === undefined || !this.vaultSecret) return undefined;
    const cached = this.keyCache;
    if (cached?.vaultSalt === settings.vaultSalt && cached.epoch === epoch) return cached.keys;
    const stored = await this.vaultSecret.get();
    if (!stored || stored.vaultSalt !== settings.vaultSalt || stored.epoch !== epoch)
      return undefined;
    const keys = await deriveVaultKeys(stored.secret, fromBase64url(settings.vaultSalt));
    if (!(await verifyKeyCheck(keys, epoch, settings.keyCheck))) return undefined;
    this.keyCache = { vaultSalt: settings.vaultSalt, epoch, keys };
    return keys;
  }

  private async requireKeys(snapshot: SyncSnapshot): Promise<VaultKeys> {
    const keys = await this.vaultKeys(snapshot);
    if (!keys) throw new Error('Enter this library’s recovery code on this device first.');
    return keys;
  }

  /** An encrypted item with the fields its sealed metadata holds added. */
  private async openItem(item: ChangeItem, keys: VaultKeys | undefined, epoch: number) {
    const sealed = item.sealed!;
    if (!keys) throw new E2eeError('WRONG_KEY', 'This device does not have the library’s key.');
    const itemKey = await unwrapItemKey(keys, sealed.wrappedKey);
    const meta = await openMeta(itemKey, sealed.sealedMeta, {
      globalId: item.globalId,
      epoch,
      metaRevision: sealed.metaRevision,
    });
    return { ...item, ...meta };
  }

  /** `item` as this device lists it: opened when it is sealed. */
  private async opened(item: ChangeItem, snapshot: SyncSnapshot): Promise<ChangeItem> {
    if (!item.sealed || item.deleted) return item;
    return this.openItem(item, await this.vaultKeys(snapshot), snapshot.epoch!);
  }

  private async requireReader(): Promise<SealedReader> {
    const reader = await this.sealedReader();
    if (!reader) throw new Error('Enter this library’s recovery code on this device first.');
    return reader;
  }

  /** Opens this encrypted library's items for an export; undefined while it is locked here. */
  async sealedReader(): Promise<SealedReader | undefined> {
    const snapshot = await this.state.load();
    const keys = await this.vaultKeys(snapshot);
    if (!keys) return undefined;
    const epoch = snapshot.epoch!;
    return {
      open: (item) => (item.sealed ? this.openItem(item, keys, epoch) : Promise.resolve(item)),
      original: (item) => this.fetchSealedOriginal(keys, epoch, item),
    };
  }

  /** Whether the library is end-to-end encrypted, as of the last pass, and readable here. */
  async encryption() {
    const snapshot = await this.state.load();
    return { on: !!snapshot.e2ee, unlocked: !!(await this.vaultKeys(snapshot)) };
  }

  /**
   * Turns end-to-end encryption on for this account's library and returns the recovery code
   * to show the student. The secret is kept on this device before the request is sent, so a
   * lost reply never leaves the library encrypted under a key no device has; a retry sends the
   * same settings again.
   */
  async turnOnEncryption(): Promise<string> {
    if (!this.vaultSecret) throw new Error('This device cannot keep an encryption key.');
    const snapshot = await this.state.load();
    const epoch = snapshot.epoch;
    if (epoch === undefined) throw new Error('Sign in and include a library first.');
    if (snapshot.e2ee) throw new Error('End-to-end encryption is already on for this library.');
    let stored = await this.vaultSecret.get();
    if (!stored || stored.epoch !== epoch) {
      stored = { epoch, vaultSalt: toBase64url(newVaultSalt()), secret: newRecoverySecret() };
      await this.vaultSecret.put(stored);
    }
    const keys = await deriveVaultKeys(stored.secret, fromBase64url(stored.vaultSalt));
    const settings = { vaultSalt: stored.vaultSalt, keyCheck: await keyCheck(keys, epoch) };
    try {
      await this.api.setVaultE2ee({ opId: this.newId(), epoch, ...settings });
    } catch (cause) {
      // Refused: the library has other settings (or none can be set), so this secret is unused.
      if (cause instanceof ApiFailure && !isTransient(cause)) await this.vaultSecret.delete();
      throw cause;
    }
    await this.state.save({ ...(await this.state.load()), e2ee: settings });
    return encodeRecoveryCode(stored.secret);
  }

  /** Keeps the recovery secret typed on this device once it proves to be this library's. */
  async unlock(code: string) {
    await this.keepSecret(await decodeRecoveryCode(code));
  }

  /** Keeps a recovery secret once it passes this library's key check. */
  private async keepSecret(secret: Uint8Array) {
    if (!this.vaultSecret) throw new Error('This device cannot keep an encryption key.');
    const snapshot = await this.state.load();
    const settings = snapshot.e2ee;
    if (!settings || snapshot.epoch === undefined)
      throw new Error('This cloud library is not end-to-end encrypted.');
    const keys = await deriveVaultKeys(secret, fromBase64url(settings.vaultSalt));
    if (!(await verifyKeyCheck(keys, snapshot.epoch, settings.keyCheck)))
      throw new E2eeError('WRONG_KEY', 'This recovery code belongs to another library.');
    await this.vaultSecret.put({ epoch: snapshot.epoch, vaultSalt: settings.vaultSalt, secret });
  }

  /**
   * The recovery code for a library about to be encrypted, so the student can write it down
   * before anything is sent. The same code is then used by `turnOnEncryption`.
   */
  async prepareEncryption(): Promise<string> {
    if (!this.vaultSecret) throw new Error('This device cannot keep an encryption key.');
    const snapshot = await this.state.load();
    const epoch = snapshot.epoch;
    if (epoch === undefined) throw new Error('Sign in and include a library first.');
    if (snapshot.e2ee) throw new Error('End-to-end encryption is already on for this library.');
    let stored = await this.vaultSecret.get();
    if (!stored || stored.epoch !== epoch) {
      stored = { epoch, vaultSalt: toBase64url(newVaultSalt()), secret: newRecoverySecret() };
      await this.vaultSecret.put(stored);
    }
    return encodeRecoveryCode(stored.secret);
  }

  /** New device: starts pairing and returns the code to type on a device that has the key. */
  async startPairing(): Promise<{ code: string; expiresAt: number }> {
    const snapshot = await this.state.load();
    if (!snapshot.e2ee) throw new Error('This cloud library is not end-to-end encrypted.');
    await this.cancelPairing();
    const keys = await newPairingKeys();
    const started = await this.api.startPairing({
      commitment: await pairingCommitment(keys.publicKey),
    });
    this.pairing = { role: 'new', pairingId: started.pairingId, keys };
    return { code: started.code, expiresAt: started.expiresAt };
  }

  /** Device with the key: claims the code shown on the new device and shows its own key. */
  async claimPairing(code: string): Promise<PairingProgress> {
    if (!(await this.vaultKeys(await this.state.load())))
      throw new Error('This device does not have the library’s key.');
    await this.cancelPairing();
    const claimed = await this.api.claimPairing({ code });
    const keys = await newPairingKeys();
    await this.api.pairingStep(claimed.pairingId, 'old-key', { publicKey: keys.publicKey });
    this.pairing = {
      role: 'old',
      pairingId: claimed.pairingId,
      keys,
      commitment: claimed.commitment,
    };
    return { stage: 'waiting' };
  }

  /** Moves the pairing on as far as the other device has got; call it again while waiting. */
  async pairingStep(): Promise<PairingProgress> {
    const pairing = this.pairing;
    if (!pairing) throw new Error('No pairing is in progress. Start again.');
    const state = await this.api.pairing(pairing.pairingId);
    if (pairing.role === 'old') {
      if (!state.newPublicKey) return { stage: 'waiting' };
      // The key must be the one the new device committed to before it saw this device's key.
      if ((await pairingCommitment(state.newPublicKey)) !== pairing.commitment) {
        await this.cancelPairing();
        throw new E2eeError(
          'TAMPERED',
          'The new device’s key was changed on the way. Start again.',
        );
      }
      pairing.newPublicKey = state.newPublicKey;
      return {
        stage: 'compare',
        checkNumber: await pairingCheckNumber(state.newPublicKey, pairing.keys.publicKey),
      };
    }
    if (!state.oldPublicKey) return { stage: 'waiting' };
    if (!pairing.oldPublicKey) {
      pairing.oldPublicKey = state.oldPublicKey;
      // Revealed only now, after the other key is fixed: see "pairing" in the contract.
      await this.api.pairingStep(pairing.pairingId, 'new-key', {
        publicKey: pairing.keys.publicKey,
      });
    } else if (state.oldPublicKey !== pairing.oldPublicKey) {
      await this.cancelPairing();
      throw new E2eeError('TAMPERED', 'The other device’s key changed. Start again.');
    }
    const checkNumber = await pairingCheckNumber(pairing.keys.publicKey, pairing.oldPublicKey);
    if (!pairing.confirmed || !state.sealedSecret) return { stage: 'compare', checkNumber };
    const secret = await openPairingSecret(
      pairing.keys,
      {
        pairingId: pairing.pairingId,
        newPublicKey: pairing.keys.publicKey,
        oldPublicKey: pairing.oldPublicKey,
      },
      state.sealedSecret,
    );
    try {
      await this.keepSecret(secret);
    } finally {
      await this.cancelPairing();
    }
    return { stage: 'done' };
  }

  /**
   * The student saw the same number on both devices. The device with the key then sends it;
   * the new device accepts it when it arrives.
   */
  async confirmPairing(): Promise<PairingProgress> {
    const pairing = this.pairing;
    if (!pairing) throw new Error('No pairing is in progress. Start again.');
    if (pairing.role === 'new') {
      pairing.confirmed = true;
      return this.pairingStep();
    }
    if (!pairing.newPublicKey) throw new Error('The new device has not answered yet.');
    await this.requireKeys(await this.state.load());
    const stored = (await this.vaultSecret!.get())!;
    const sealedSecret = await sealPairingSecret(
      pairing.keys,
      {
        pairingId: pairing.pairingId,
        newPublicKey: pairing.newPublicKey,
        oldPublicKey: pairing.keys.publicKey,
      },
      stored.secret,
    );
    await this.api.pairingStep(pairing.pairingId, 'secret', { sealedSecret });
    this.pairing = undefined;
    return { stage: 'done' };
  }

  /** Stops the pairing on this device and asks the server to forget it. */
  async cancelPairing() {
    const pairing = this.pairing;
    this.pairing = undefined;
    if (pairing) await this.api.deletePairing(pairing.pairingId).catch(() => undefined);
  }

  /** The recovery code again, for Settings; undefined unless this device holds the key. */
  async recoveryCode() {
    const snapshot = await this.state.load();
    if (!(await this.vaultKeys(snapshot))) return undefined;
    const stored = await this.vaultSecret!.get();
    return stored && encodeRecoveryCode(stored.secret);
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
