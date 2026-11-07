// Explicit cloud export: reads originals only; no query, embedding or document content analytics.
import { Zip, ZipPassThrough, strToU8 } from 'fflate';
import { ApiFailure, type ApiClient, type ChangeItem } from './api';
import { validateCloudItem, type CloudItem } from '../contract';

/**
 * Uses the existing local-library archive format, split at its 500-item / 250 MB import limits.
 * Originals are downloaded sequentially and stored without compression to avoid a second
 * complete uncompressed copy or a long synchronous compression pass on a phone.
 */
export async function exportCloudVault(options: {
  api: Pick<ApiClient, 'changes' | 'original'>;
  epoch: number;
  assertAccount?: () => void;
}): Promise<Blob[]> {
  const check = () => options.assertAccount?.();
  async function read<T>(work: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      check();
      try {
        return await work();
      } catch (cause) {
        if (!(cause instanceof ApiFailure) || cause.code !== 'RATE_LIMITED' || attempt >= 3)
          throw cause;
        const seconds = cause.retryAfterSeconds;
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            seconds && Number.isFinite(seconds)
              ? Math.min(60, Math.max(0.2, seconds)) * 1000
              : 1000,
          ),
        );
      }
    }
  }
  check();
  const initial = await read(() => options.api.changes(options.epoch, 0));
  check();
  const catalogue = new Map<string, ChangeItem>();
  for (const { item } of initial.changes) {
    if (item.deleted) catalogue.delete(item.globalId);
    else catalogue.set(item.globalId, item);
  }
  if (!catalogue.size) throw new Error('Your cloud library is empty.');
  const archives: Blob[] = [];
  let parts: BlobPart[] = [];
  let failure: Error | null = null;
  let zip = openZip();
  let items: Record<string, unknown>[] = [];
  let totalBytes = 0;
  function openZip() {
    return new Zip((error, bytes) => {
      if (error) failure = error;
      else parts.push(bytes as BlobPart);
    });
  }
  function add(path: string, bytes: Uint8Array) {
    const entry = new ZipPassThrough(path);
    zip.add(entry);
    entry.push(bytes, true);
    if (failure) throw failure;
  }
  function finish() {
    add(
      'manifest.json',
      strToU8(
        JSON.stringify({ format: 'campus-recall', version: 1, exportedAt: Date.now(), items }),
      ),
    );
    zip.end();
    if (failure) throw failure;
    archives.push(new Blob(parts, { type: 'application/zip' }));
    parts = [];
    items = [];
    totalBytes = 0;
    zip = openZip();
  }
  for (const raw of catalogue.values()) {
    check();
    const valid = validateCloudItem(raw as CloudItem);
    if (!valid.ok) throw new Error('Cloud metadata is incomplete. Sync again before exporting.');
    const item = raw as CloudItem;
    if (items.length && (items.length >= 500 || totalBytes + item.byteLength > 200_000_000))
      finish();
    const bytes = await read(() => options.api.original(item.globalId));
    check();
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
    const hash = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
    if (bytes.length !== item.byteLength || hash !== item.contentSha256)
      throw new Error(
        'Downloaded original does not match its saved length and hash. Try exporting again.',
      );
    const originalPath = `originals/${item.globalId}`;
    add(originalPath, bytes);
    totalBytes += bytes.length;
    items.push({
      id: item.globalId,
      kind: item.kind,
      title: item.title,
      mimeType: item.mimeType,
      byteLength: item.byteLength,
      contentSha256: item.contentSha256,
      createdAt: item.createdAt,
      sourceUrl: item.sourceUrl,
      originalPath,
    });
  }
  // The archive is a snapshot, not a mixture of metadata and bytes from different revisions.
  const latest = await read(() => options.api.changes(options.epoch, initial.cursor));
  check();
  if (latest.changes.length)
    throw new Error('Your cloud library changed during export. Try again.');
  if (items.length) finish();
  return archives;
}
