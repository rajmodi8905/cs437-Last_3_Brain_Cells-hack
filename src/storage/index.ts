import Dexie, { type Table } from 'dexie';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import {
  AppOperationError, LIMITS, SUPPORTED_MIME_TYPES, type AppError, type ImportReport,
  type IndexedSegment, type ItemFilters, type ItemKind, type LibraryItem, type ProcessingClaim,
  type ProcessingRepository, type SaveInput, type SearchableSegment
} from '../shared/index.js';

interface OriginalRecord { id: string; itemId: string; data: ArrayBuffer; mimeType: string }
interface JobRecord { itemId: string; generation: number; queuedAt: number; claimId?: string; claimedAt?: number }
interface PreviewRecord { id: string; itemId: string; blob: Blob }
interface SettingRecord { key: string; value: unknown }
interface ArchiveManifest {
  format: 'campus-recall'; version: 1; exportedAt: number;
  items: Array<{ id: string; kind: ItemKind; title: string; originalName?: string; mimeType: string; byteLength: number; contentSha256: string; createdAt: number; sourceUrl?: string; originalPath: string }>;
}

export class CampusRecallDatabase extends Dexie {
  items!: Table<LibraryItem, string>;
  originals!: Table<OriginalRecord, string>;
  segments!: Table<IndexedSegment, string>;
  jobs!: Table<JobRecord, string>;
  previews!: Table<PreviewRecord, string>;
  settings!: Table<SettingRecord, string>;

  constructor(name = 'campus-recall') {
    super(name);
    this.version(1).stores({
      items: 'id, createdAt, kind, status, contentSha256',
      originals: 'id, itemId', segments: 'id, itemId, indexVersion',
      jobs: 'itemId, queuedAt, claimId', previews: 'id, itemId', settings: 'key'
    });
  }
}

const error = (code: AppError['code'], message: string, retryable = false) => new AppOperationError({ code, message, retryable });
const codePoints = (value: string) => Array.from(value).length;
const textBlob = (text: string) => new Blob([text], { type: 'text/plain;charset=utf-8' });

const bytesFor = (blob: Blob): Promise<ArrayBuffer> => {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
};

async function sha256(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await bytesFor(blob));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function titleFor(input: SaveInput, kind: ItemKind): string {
  const explicit = input.title?.trim();
  if (explicit) return explicit;
  if (input.kind === 'file' && input.file.name) return input.file.name.replace(/\.[^.]+$/, '');
  if (input.kind === 'webpage') {
    try { return new URL(input.url).hostname || kind; } catch { return kind; }
  }
  return input.kind === 'note' ? input.text.split(/\r?\n/, 1)[0]?.trim() || kind : kind;
}

function normalizeTitle(value: string, explicit: boolean): string {
  const trimmed = value.trim();
  if (!trimmed) throw error('INVALID_INPUT', 'Title must be between one and 120 Unicode code points.');
  if (explicit) {
    if (codePoints(trimmed) > LIMITS.maxTitleCodePoints) throw error('INVALID_INPUT', 'Title must be between one and 120 Unicode code points.');
    return trimmed;
  }
  return Array.from(trimmed).slice(0, LIMITS.maxTitleCodePoints).join('');
}

function validateUrl(url: string): void {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw error('INVALID_INPUT', 'Webpage URL is invalid.'); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw error('INVALID_INPUT', 'Webpage URL must use HTTP or HTTPS.');
}

function isValidHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function validateArchiveEntry(entry: unknown, files: Record<string, Uint8Array>): ArchiveManifest['items'][number] {
  if (!entry || typeof entry !== 'object') throw error('INVALID_ARCHIVE', 'Archive item metadata is invalid.');
  const candidate = entry as Partial<ArchiveManifest['items'][number]>;
  if (typeof candidate.id !== 'string' || !candidate.id.trim()) throw error('INVALID_ARCHIVE', 'Archive item ID is invalid.');
  if (typeof candidate.kind !== 'string' || !['image', 'pdf', 'note', 'webpage', 'audio', 'video'].includes(candidate.kind)) throw error('INVALID_ARCHIVE', 'Archive item kind is invalid.');
  if (typeof candidate.title !== 'string' || !candidate.title.trim() || codePoints(candidate.title.trim()) > LIMITS.maxTitleCodePoints) throw error('INVALID_ARCHIVE', 'Archive title is invalid.');
  if (typeof candidate.mimeType !== 'string' || !candidate.mimeType.trim()) throw error('INVALID_ARCHIVE', 'Archive MIME type is invalid.');
  if (candidate.kind === 'note' || candidate.kind === 'webpage') {
    if (!candidate.mimeType.startsWith('text/plain')) throw error('INVALID_ARCHIVE', 'Archive text item MIME type is invalid.');
  } else if (SUPPORTED_MIME_TYPES[candidate.mimeType] !== candidate.kind) {
    throw error('INVALID_ARCHIVE', 'Archive item MIME type does not match its kind.');
  }
  if (typeof candidate.originalPath !== 'string' || !/^originals\/[0-9a-f-]+$/.test(candidate.originalPath) || candidate.originalPath !== `originals/${candidate.id}` || !files[candidate.originalPath]) {
    throw error('INVALID_ARCHIVE', 'Archive original path is invalid.');
  }
  if (!Number.isInteger(candidate.byteLength) || candidate.byteLength < 0) throw error('INVALID_ARCHIVE', 'Archive item byte length is invalid.');
  const bytes = files[candidate.originalPath];
  if (candidate.byteLength !== bytes.length) throw error('INVALID_ARCHIVE', 'Archive byte length does not match its manifest.');
  if (typeof candidate.contentSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(candidate.contentSha256)) throw error('INVALID_ARCHIVE', 'Archive item hash is invalid.');
  if (typeof candidate.createdAt !== 'number' || !Number.isFinite(candidate.createdAt) || candidate.createdAt <= 0) throw error('INVALID_ARCHIVE', 'Archive item timestamp is invalid.');
  if (candidate.kind === 'webpage') {
    if (typeof candidate.sourceUrl !== 'string' || !candidate.sourceUrl.trim() || !isValidHttpUrl(candidate.sourceUrl)) throw error('INVALID_ARCHIVE', 'Archive webpage URL is invalid.');
  }
  return candidate as ArchiveManifest['items'][number];
}

export class DexieLibraryRepository implements ProcessingRepository {
  constructor(public readonly database: CampusRecallDatabase) {}
  async open(): Promise<void> { await this.database.open(); }

  async save(input: SaveInput): Promise<LibraryItem> {
    let kind: ItemKind; let blob!: Blob; let mimeType!: string; let originalName: string | undefined; let sourceUrl: string | undefined;
    if (input.kind === 'file') {
      kind = SUPPORTED_MIME_TYPES[input.file.type];
      if (!kind) throw error('UNSUPPORTED_FORMAT', 'This file format is not supported.');
      const max = kind === 'image' || kind === 'pdf' ? LIMITS.maxPdfBytes : kind === 'audio' ? LIMITS.maxAudioBytes : LIMITS.maxVideoBytes;
      if (input.file.size > max) throw error('LIMIT_EXCEEDED', 'The file exceeds its supported size limit.');
      blob = input.file; mimeType = input.file.type; originalName = input.file.name;
    } else if (input.kind === 'note' || input.kind === 'webpage') {
      if (codePoints(input.text) > LIMITS.maxTextCodePoints) throw error('LIMIT_EXCEEDED', 'Text exceeds the supported limit.');
      if (input.kind === 'webpage') { validateUrl(input.url); sourceUrl = input.url; }
      kind = input.kind; blob = textBlob(input.text); mimeType = blob.type;
    }
    const id = crypto.randomUUID(); const originalBlobId = crypto.randomUUID(); const createdAt = Date.now();
    const contentSha256 = await sha256(blob);
    const originalBytes = await bytesFor(blob);
    const title = titleFor(input, kind!);
    const itemTitle = input.title?.trim() ? normalizeTitle(title, true) : normalizeTitle(title, false);
    const item: LibraryItem = { id, kind: kind!, title: itemTitle, originalName, mimeType, byteLength: blob.size, contentSha256, originalBlobId, createdAt, sourceUrl, status: 'queued', processingGeneration: 0 };
    try {
      await this.database.transaction('rw', this.database.items, this.database.originals, this.database.jobs, async () => {
        await this.database.items.add(item);
        await this.database.originals.add({ id: originalBlobId, itemId: id, data: originalBytes, mimeType });
        await this.database.jobs.add({ itemId: id, generation: 0, queuedAt: createdAt });
      });
    } catch (cause) { throw error('STORAGE_FAILED', cause instanceof Error ? cause.message : 'Could not save the item.', true); }
    return item;
  }

  getItem(id: string) { return this.database.items.get(id); }
  async getOriginal(id: string): Promise<Blob | undefined> {
    const item = await this.database.items.get(id); if (!item) return undefined;
    const original = await this.database.originals.get(item.originalBlobId);
    return original ? new Blob([original.data], { type: original.mimeType }) : undefined;
  }
  async listItems(filters: ItemFilters = {}): Promise<LibraryItem[]> {
    const items = await this.database.items.toArray();
    return items.filter((item) => (!filters.kind || item.kind === filters.kind) && (!filters.status || item.status === filters.status))
      .sort((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id));
  }
  async renameItem(id: string, title: string): Promise<LibraryItem> {
    const normalized = normalizeTitle(title, true);
    return this.database.transaction('rw', this.database.items, this.database.jobs, async () => {
      const item = await this.database.items.get(id); if (!item) throw error('SOURCE_UNAVAILABLE', 'Item was not found.');
      const updated = { ...item, title: normalized, processingGeneration: item.processingGeneration + 1, status: 'queued' as const, error: undefined };
      await this.database.items.put(updated); await this.database.jobs.put({ itemId: id, generation: updated.processingGeneration, queuedAt: Date.now() });
      return updated;
    });
  }
  async deleteItem(id: string): Promise<void> {
    await this.database.transaction('rw', [this.database.items, this.database.originals, this.database.segments, this.database.jobs, this.database.previews], async () => {
      const item = await this.database.items.get(id); if (!item) return;
      await Promise.all([this.database.items.delete(id), this.database.originals.delete(item.originalBlobId), this.database.jobs.delete(id)]);
      await this.database.segments.where('itemId').equals(id).delete(); await this.database.previews.where('itemId').equals(id).delete();
    });
  }

  async enqueueItem(itemId: string): Promise<void> {
    await this.database.transaction('rw', this.database.items, this.database.jobs, async () => {
      const item = await this.database.items.get(itemId); if (!item) return;
      const nextGeneration = item.status === 'failed' ? item.processingGeneration + 1 : item.processingGeneration;
      if (item.status === 'failed') await this.database.items.put({ ...item, status: 'queued', error: undefined, processingGeneration: nextGeneration });
      const existing = await this.database.jobs.get(itemId); if (!existing) await this.database.jobs.put({ itemId, generation: nextGeneration, queuedAt: Date.now() });
    });
  }
  async claimNextJob(): Promise<ProcessingClaim | undefined> {
    return this.database.transaction('rw', this.database.items, this.database.jobs, async () => {
      const job = (await this.database.jobs.orderBy('queuedAt').toArray()).find((candidate) => !candidate.claimId);
      if (!job) return undefined;
      const item = await this.database.items.get(job.itemId); if (!item || item.processingGeneration !== job.generation) { if (!item) await this.database.jobs.delete(job.itemId); return undefined; }
      const claimId = crypto.randomUUID(); await this.database.jobs.put({ ...job, claimId, claimedAt: Date.now() });
      const processing = { ...item, status: 'processing' as const }; await this.database.items.put(processing);
      return { item: processing, generation: processing.processingGeneration, claimId };
    });
  }
  async recoverInterruptedJobs(): Promise<void> { await this.database.transaction('rw', this.database.items, this.database.jobs, async () => { const jobs = await this.database.jobs.toArray(); for (const job of jobs) if (job.claimId) { const item = await this.database.items.get(job.itemId); if (item?.status === 'processing') await this.database.items.put({ ...item, status: 'queued' }); await this.database.jobs.put({ ...job, claimId: undefined, claimedAt: undefined }); } }); }
  async publishSegments(claim: ProcessingClaim, segments: IndexedSegment[], metadata: { durationMs?: number; pageCount?: number } = {}): Promise<boolean> {
    if (!segments.every((segment) => segment.itemId === claim.item.id && segment.vector.length === 768 && Array.from(segment.vector).every(Number.isFinite))) return false;
    return this.database.transaction('rw', this.database.items, this.database.jobs, this.database.segments, async () => {
      const item = await this.database.items.get(claim.item.id); const job = await this.database.jobs.get(claim.item.id);
      if (!item || !job || job.claimId !== claim.claimId || item.processingGeneration !== claim.generation) return false;
      await this.database.segments.where('itemId').equals(item.id).delete(); await this.database.segments.bulkAdd(segments);
      await this.database.items.put({ ...item, ...metadata, status: 'ready', error: undefined }); await this.database.jobs.delete(item.id); return true;
    });
  }
  async failJob(claim: ProcessingClaim, failure: AppError): Promise<boolean> { return this.database.transaction('rw', this.database.items, this.database.jobs, this.database.segments, async () => { const item = await this.database.items.get(claim.item.id); const job = await this.database.jobs.get(claim.item.id); if (!item || !job || job.claimId !== claim.claimId || item.processingGeneration !== claim.generation) return false; await this.database.segments.where('itemId').equals(item.id).delete(); await this.database.items.put({ ...item, status: 'failed', error: failure }); await this.database.jobs.delete(item.id); return true; }); }
  async cancelItem(itemId: string): Promise<void> { await this.database.transaction('rw', this.database.items, this.database.jobs, this.database.segments, async () => { const item = await this.database.items.get(itemId); if (!item) return; await this.database.jobs.delete(itemId); await this.database.segments.where('itemId').equals(itemId).delete(); await this.database.items.put({ ...item, status: 'failed', processingGeneration: item.processingGeneration + 1, error: { code: 'CANCELLED', message: 'Processing was cancelled.', retryable: true } }); }); }
  async listSearchableSegments(indexVersion: string, kind?: ItemKind): Promise<SearchableSegment[]> { const segments = await this.database.segments.where('indexVersion').equals(indexVersion).toArray(); const result: SearchableSegment[] = []; for (const segment of segments) { const item = await this.database.items.get(segment.itemId); if (item?.status === 'ready' && (!kind || item.kind === kind)) result.push({ ...segment, itemKind: item.kind }); } return result; }

  async exportItems(ids: string[]): Promise<Blob> {
    if (!ids.length) throw error('INVALID_INPUT', 'Select at least one item to export.');
    const items = await Promise.all(ids.map((id) => this.database.items.get(id))); if (items.some((item) => !item)) throw error('SOURCE_UNAVAILABLE', 'An item selected for export is unavailable.');
    const manifest: ArchiveManifest = { format: 'campus-recall', version: 1, exportedAt: Date.now(), items: [] }; const files: Record<string, Uint8Array> = {};
    for (const item of items as LibraryItem[]) { const original = await this.getOriginal(item.id); if (!original) throw error('SOURCE_UNAVAILABLE', 'An item original is unavailable.'); const path = `originals/${item.id}`; manifest.items.push({ id: item.id, kind: item.kind, title: item.title, originalName: item.originalName, mimeType: item.mimeType, byteLength: item.byteLength, contentSha256: item.contentSha256, createdAt: item.createdAt, sourceUrl: item.sourceUrl, originalPath: path }); files[path] = new Uint8Array(await bytesFor(original)); }
    files['manifest.json'] = strToU8(JSON.stringify(manifest)); const archiveBytes = zipSync(files); const archiveBuffer = new ArrayBuffer(archiveBytes.byteLength); new Uint8Array(archiveBuffer).set(archiveBytes); return new Blob([archiveBuffer], { type: 'application/zip' });
  }
  async importArchive(archive: Blob): Promise<ImportReport> {
    let files: Record<string, Uint8Array>; let manifest: ArchiveManifest;
    try { files = unzipSync(new Uint8Array(await bytesFor(archive))); manifest = JSON.parse(strFromU8(files['manifest.json']!)) as ArchiveManifest; } catch { throw error('INVALID_ARCHIVE', 'Archive is not a valid Campus Recall export.'); }
    if (manifest.format !== 'campus-recall' || manifest.version !== 1 || !Array.isArray(manifest.items) || new Set(manifest.items.map((item) => item.id)).size !== manifest.items.length) throw error('INVALID_ARCHIVE', 'Archive manifest is invalid.');
    const prepared: Array<{ item: LibraryItem; original: OriginalRecord; job: JobRecord }> = []; const skippedDuplicateIds: string[] = [];
    const duplicateByKey = new Map<string, string>();
    for (const rawEntry of manifest.items) {
      const entry = validateArchiveEntry(rawEntry, files);
      const bytes = files[entry.originalPath]!;
      const blobBytes = new ArrayBuffer(bytes.byteLength); new Uint8Array(blobBytes).set(bytes); const blob = new Blob([blobBytes], { type: entry.mimeType });
      if (await sha256(blob) !== entry.contentSha256) throw error('INVALID_ARCHIVE', 'Archive hash does not match its original.');
      const duplicateKey = `${entry.kind}|${entry.contentSha256}|${entry.sourceUrl ?? ''}`;
      const existingDuplicate = await this.database.items.where('contentSha256').equals(entry.contentSha256).filter((item) => item.kind === entry.kind && item.sourceUrl === entry.sourceUrl).first();
      const pendingDuplicateId = duplicateByKey.get(duplicateKey);
      if (existingDuplicate) { skippedDuplicateIds.push(existingDuplicate.id); continue; }
      if (pendingDuplicateId) { skippedDuplicateIds.push(pendingDuplicateId); continue; }
      const id = crypto.randomUUID(); const originalBlobId = crypto.randomUUID(); const item: LibraryItem = { id, kind: entry.kind, title: entry.title, originalName: entry.originalName, mimeType: entry.mimeType, byteLength: entry.byteLength, contentSha256: entry.contentSha256, originalBlobId, createdAt: entry.createdAt, sourceUrl: entry.sourceUrl, status: 'queued', processingGeneration: 0 };
      prepared.push({ item, original: { id: originalBlobId, itemId: id, data: blobBytes, mimeType: entry.mimeType }, job: { itemId: id, generation: 0, queuedAt: Date.now() } });
      duplicateByKey.set(duplicateKey, id);
    }
    await this.database.transaction('rw', this.database.items, this.database.originals, this.database.jobs, async () => { await this.database.items.bulkAdd(prepared.map((entry) => entry.item)); await this.database.originals.bulkAdd(prepared.map((entry) => entry.original)); await this.database.jobs.bulkAdd(prepared.map((entry) => entry.job)); });
    return { importedIds: prepared.map((entry) => entry.item.id), skippedDuplicateIds };
  }
}