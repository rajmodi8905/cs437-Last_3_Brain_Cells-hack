// Publishing an item's index bundle (P05), shared by `PUT /items/{id}/index` and the WhatsApp
// indexer so both apply the same checks, quota, object key and change-feed entry.
import {
  PILOT_INDEX_VERSIONS,
  searchMetadataDigest,
  validateIndexBundle,
  type IndexBundle,
  type PilotErrorCode,
} from '../contract';
import type { ObjectStore, PilotStore, StoredItem } from './store';

/** A refused bundle, with the API error code it is reported as. */
export class IndexPublishError extends Error {
  constructor(
    readonly code: PilotErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'IndexPublishError';
  }
}

export interface IndexPublishDeps {
  store: PilotStore;
  objects: ObjectStore;
  quotaBytes: number;
  /** Index versions accepted; the pilot contract's list by default. */
  supportedIndexVersions?: readonly string[];
}

/**
 * Checks `bundle` against the item's current original, title and the supported index versions,
 * then stores `bytes()` (the bundle exactly as it will be served) under the vault's epoch and
 * publishes the item with its index. The caller holds the owner's lock and has checked `epoch`.
 */
export async function publishIndexBundle(
  deps: IndexPublishDeps,
  ownerKey: string,
  epoch: number,
  globalId: string,
  bundle: IndexBundle,
  bytes: () => Uint8Array | undefined,
): Promise<StoredItem> {
  const { store, objects } = deps;
  const current = await store.getItem(ownerKey, globalId);
  if (!current) throw new IndexPublishError('NOT_FOUND', 'Item not found.');
  if (current.deleted) throw new IndexPublishError('ITEM_DELETED', 'This item was deleted.');
  const valid = validateIndexBundle(
    bundle,
    {
      globalId: current.globalId,
      contentSha256: current.contentSha256,
      searchMetadataDigest: await searchMetadataDigest(current),
    },
    deps.supportedIndexVersions ?? PILOT_INDEX_VERSIONS,
  );
  if (!valid.ok) throw new IndexPublishError(valid.code, valid.reason);
  const stored = bytes();
  if (!stored) throw new IndexPublishError('INVALID_INPUT', 'Body has no bundle.');
  // The new bundle replaces any earlier one, so only the difference is new storage.
  const used = (await store.committedBytes(ownerKey)) - (current.indexBytes ?? 0);
  if (used + stored.length > deps.quotaBytes)
    throw new IndexPublishError('QUOTA_EXCEEDED', 'This would exceed your cloud storage quota.');
  const indexObjectKey = `${ownerKey}/${epoch}/${current.globalId}/index`;
  await objects.put(indexObjectKey, stored);
  // An index does not change the item's revision, so it never causes rename conflicts.
  const next = { ...current, index: valid.value, indexObjectKey, indexBytes: stored.length };
  await store.publish(ownerKey, next, epoch);
  return next;
}
