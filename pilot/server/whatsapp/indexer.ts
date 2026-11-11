/// <reference types="node" />
// Server indexing for WhatsApp items (W7): the `onIndexJob` handler. It indexes the stored
// original with the engine host and publishes the bundle exactly as `PUT /items/{id}/index` does,
// so the app's cloud search (P05/P06) uses it like a device-made bundle.
import {
  INDEX_DIMENSION,
  PILOT_INDEX_VERSIONS,
  searchMetadataDigest,
  type IndexBundle,
} from '../../contract';
import { IndexPublishError, publishIndexBundle } from '../index-publish';
import type { ObjectStore, PilotStore } from '../store';
import { EngineIndexError, type EngineHost, type EngineSearchItem } from './engine-host';
import { PermanentJobError, REPLIES, globalIdFor } from './ingest';
import type { BotJob } from './store';

export interface WhatsAppIndexerOptions {
  store: PilotStore;
  objects: ObjectStore;
  engine: EngineHost;
  /** The same account quota as uploads and device-made bundles. */
  quotaBytes: number;
  /** Index versions accepted; the pilot contract's list by default, as for devices. */
  supportedIndexVersions?: readonly string[];
  /** Indexing passes when the title keeps changing meanwhile, before the job is retried; 3. */
  maxPasses?: number;
  /**
   * The item an index job is for. WhatsApp's by default; another channel passes its own, as it
   * made the item's global ID from its own message key.
   */
  globalIdOf?: (job: BotJob) => string;
}

/** Codes for bundles that would be refused the same way every time. */
const PERMANENT = new Set(['INVALID_INPUT', 'LIMIT_EXCEEDED']);

export function createWhatsAppIndexer(options: WhatsAppIndexerOptions) {
  const { store, objects, engine } = options;
  const versions = options.supportedIndexVersions ?? PILOT_INDEX_VERSIONS;
  const maxPasses = options.maxPasses ?? 3;
  const globalIdOf = options.globalIdOf ?? ((job: BotJob) => globalIdFor(job.wamid));

  return async function onIndexJob(job: BotJob): Promise<void> {
    const { ownerKey } = job;
    const globalId = globalIdOf(job);
    for (let pass = 0; pass < maxPasses; pass++) {
      const item = await store.getItem(ownerKey, globalId);
      // Deleted (or its vault reset) meanwhile: there is nothing left to index.
      if (!item || item.deleted || !item.objectKey) return;
      const digest = await searchMetadataDigest(item);
      // A retry after the bundle was published has nothing left to do.
      if (
        item.index &&
        item.index.contentSha256 === item.contentSha256 &&
        item.index.searchMetadataDigest === digest &&
        versions.includes(item.index.indexVersion)
      )
        return;
      const bytes = await objects.get(item.objectKey);
      if (!bytes) {
        if ((await store.getItem(ownerKey, globalId))?.deleted !== false) return;
        throw new Error('The stored original could not be read.');
      }

      let result;
      try {
        result = await engine.index({
          bytes,
          kind: item.kind,
          mimeType: item.mimeType,
          title: item.title,
          createdAt: item.createdAt,
          ...(item.sourceUrl ? { sourceUrl: item.sourceUrl } : {}),
        });
      } catch (cause) {
        if (cause instanceof EngineIndexError)
          throw new PermanentJobError(`${cause.code}: ${cause.message}`);
        throw cause;
      }
      if (result.contentSha256 !== item.contentSha256)
        throw new Error('The engine host indexed different bytes from the stored original.');

      const bundle: IndexBundle = {
        globalId,
        contentSha256: item.contentSha256,
        searchMetadataDigest: digest,
        indexVersion: result.indexVersion,
        dimension: INDEX_DIMENSION,
        segments: result.segments,
      };
      const encoded = new TextEncoder().encode(JSON.stringify(bundle));
      // Under the owner's lock, like every write from the app.
      const outcome = await store.withOwnerLock(ownerKey, async () => {
        const current = await store.getItem(ownerKey, globalId);
        if (!current || current.deleted) return 'gone';
        // Renamed meanwhile: search embeds the title, so index again with the new one.
        if (current.title !== item.title) return 'renamed';
        const { epoch } = await store.vault(ownerKey);
        try {
          await publishIndexBundle(
            {
              store,
              objects,
              quotaBytes: options.quotaBytes,
              supportedIndexVersions: options.supportedIndexVersions,
            },
            ownerKey,
            epoch,
            globalId,
            bundle,
            () => encoded,
          );
        } catch (cause) {
          if (!(cause instanceof IndexPublishError)) throw cause;
          if (cause.code === 'QUOTA_EXCEEDED')
            throw new PermanentJobError(cause.message, REPLIES.indexFull(current.title));
          if (PERMANENT.has(cause.code))
            throw new PermanentJobError(`${cause.code}: ${cause.message}`);
          throw cause;
        }
        return 'published';
      });
      if (outcome !== 'renamed') return;
    }
    throw new Error('The item kept being renamed while it was indexed; trying again later.');
  };
}

/**
 * An owner's usable index bundles, ready for `EngineHost.search`: every live item whose bundle
 * still matches its original, title and a supported index version, as the app checks before it
 * uses a synced bundle.
 */
export async function ownerSearchItems(
  store: PilotStore,
  objects: ObjectStore,
  ownerKey: string,
  supportedIndexVersions: readonly string[] = PILOT_INDEX_VERSIONS,
): Promise<EngineSearchItem[]> {
  const { changes } = await store.changesAfter(ownerKey, 0);
  const items: EngineSearchItem[] = [];
  for (const globalId of new Set(changes.map((change) => change.item.globalId))) {
    const item = await store.getItem(ownerKey, globalId);
    if (!item || item.deleted || !item.index || !item.indexObjectKey) continue;
    if (
      item.index.contentSha256 !== item.contentSha256 ||
      item.index.searchMetadataDigest !== (await searchMetadataDigest(item)) ||
      !supportedIndexVersions.includes(item.index.indexVersion)
    )
      continue;
    const bytes = await objects.get(item.indexObjectKey);
    if (!bytes) continue;
    const bundle = JSON.parse(new TextDecoder().decode(bytes)) as IndexBundle;
    items.push({
      globalId,
      kind: item.kind,
      indexVersion: bundle.indexVersion,
      segments: bundle.segments,
    });
  }
  return items;
}
