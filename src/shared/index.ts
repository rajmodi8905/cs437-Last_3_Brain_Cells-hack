export type ItemKind = 'image' | 'pdf' | 'note' | 'webpage' | 'audio' | 'video';
export type ItemStatus = 'queued' | 'processing' | 'ready' | 'failed';
export type SourceLocation =
  | { kind: 'whole' }
  | { kind: 'page'; page: number }
  | { kind: 'time'; startMs: number; endMs: number };

export interface AppError {
  code: ErrorCode;
  message: string;
  retryable: boolean;
}

export type ErrorCode =
  | 'INVALID_INPUT'
  | 'UNSUPPORTED_FORMAT'
  | 'LIMIT_EXCEEDED'
  | 'STORAGE_FAILED'
  | 'SOURCE_UNAVAILABLE'
  | 'INVALID_ARCHIVE'
  | 'FETCH_BLOCKED'
  | 'MODEL_NOT_READY'
  | 'SETUP_FAILED'
  | 'EXTRACTION_FAILED'
  | 'INFERENCE_FAILED'
  | 'CANCELLED'
  | 'INDEX_INCOMPATIBLE'
  | 'ENGINE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export class AppOperationError extends Error {
  constructor(public readonly detail: AppError) {
    super(detail.message);
    this.name = 'AppOperationError';
  }
}

export interface LibraryItem {
  id: string;
  kind: ItemKind;
  title: string;
  originalName?: string;
  mimeType: string;
  byteLength: number;
  contentSha256: string;
  originalBlobId: string;
  createdAt: number;
  sourceUrl?: string;
  durationMs?: number;
  pageCount?: number;
  status: ItemStatus;
  error?: AppError;
  processingGeneration: number;
}

export interface IndexedSegment {
  id: string;
  itemId: string;
  modality: 'text' | 'visual';
  location: SourceLocation;
  text?: string;
  vector: Float32Array;
  indexVersion: string;
}

export interface SearchResult {
  itemId: string;
  segmentId: string;
  location: SourceLocation;
  matchKind: 'text' | 'visual';
  excerpt?: string;
  score: number;
}

export type SaveInput =
  | { kind: 'file'; file: File; title?: string }
  | { kind: 'note'; text: string; title?: string }
  | { kind: 'webpage'; url: string; text: string; title?: string };

export interface ItemFilters {
  kind?: ItemKind;
  status?: ItemStatus;
}
export interface ImportReport {
  importedIds: string[];
  skippedDuplicateIds: string[];
}

export interface LibraryRepository {
  save(input: SaveInput): Promise<LibraryItem>;
  getItem(id: string): Promise<LibraryItem | undefined>;
  getOriginal(id: string): Promise<Blob | undefined>;
  listItems(filters?: ItemFilters): Promise<LibraryItem[]>;
  renameItem(id: string, title: string): Promise<LibraryItem>;
  deleteItem(id: string): Promise<void>;
  /**
   * One ZIP for a selection that fits the import limits; larger selections are refused.
   * Whole-library backups split the library with `planArchiveParts` first.
   */
  exportItems(ids: string[]): Promise<Blob>;
  importArchive(archive: Blob): Promise<ImportReport>;
}

export interface ProcessingClaim {
  item: LibraryItem;
  generation: number;
  claimId: string;
}
export interface SearchableSegment extends IndexedSegment {
  itemKind: ItemKind;
}
export interface ProcessingRepository {
  enqueueItem(itemId: string): Promise<void>;
  claimNextJob(): Promise<ProcessingClaim | undefined>;
  recoverInterruptedJobs(): Promise<void>;
  publishSegments(
    claim: ProcessingClaim,
    segments: IndexedSegment[],
    metadata?: { durationMs?: number; pageCount?: number },
  ): Promise<boolean>;
  failJob(claim: ProcessingClaim, error: AppError): Promise<boolean>;
  cancelItem(itemId: string): Promise<void>;
  listSearchableSegments(indexVersion: string, kind?: ItemKind): Promise<SearchableSegment[]>;
}

export type ProcessingStage =
  | 'setup'
  | 'queued'
  | 'extracting'
  | 'transcribing'
  | 'embedding'
  | 'publishing'
  | 'ready'
  | 'failed'
  | 'cancelled';
export interface EngineProgress {
  stage: ProcessingStage;
  itemId?: string;
  loadedBytes?: number;
  totalBytes?: number;
  completedUnits?: number;
  totalUnits?: number;
  message?: string;
}
export type ProgressListener = (event: EngineProgress) => void;
export interface EngineClient {
  setupModels(onProgress?: ProgressListener): Promise<void>;
  indexItem(itemId: string): Promise<void>;
  search(query: string, kindFilter?: ItemKind): Promise<SearchResult[]>;
  cancelItem(itemId: string): Promise<void>;
  subscribeProgress(listener: ProgressListener): () => void;
  dispose(): Promise<void>;
}

export const LIMITS = {
  maxTextCodePoints: 20_000,
  maxTitleCodePoints: 120,
  maxImageBytes: 20_000_000,
  maxPdfBytes: 20_000_000,
  maxAudioBytes: 50_000_000,
  maxVideoBytes: 100_000_000,
  maxPdfPages: 50,
  maxAudioDurationMs: 5 * 60 * 1000,
  maxVideoDurationMs: 2 * 60 * 1000,
} as const;

/** What one backup ZIP may hold; export splits a library so that every part imports. */
export const ARCHIVE_LIMITS = {
  maxItems: 500,
  maxArchiveBytes: 250_000_000,
  maxUnpackedBytes: 500_000_000,
  maxEntryBytes: 100_000_000,
  /** Originals per exported part, leaving room for ZIP headers and the manifest. */
  partBytes: 200_000_000,
} as const;

/** Groups items, in order, into the fewest parts that each fit one importable ZIP. */
export function planArchiveParts<T extends { byteLength: number }>(items: T[]): T[][] {
  const parts: T[][] = [];
  let current: T[] = [];
  let bytes = 0;
  for (const item of items) {
    if (
      current.length &&
      (current.length >= ARCHIVE_LIMITS.maxItems ||
        bytes + item.byteLength > ARCHIVE_LIMITS.partBytes)
    ) {
      parts.push(current);
      current = [];
      bytes = 0;
    }
    current.push(item);
    bytes += item.byteLength;
  }
  if (current.length) parts.push(current);
  return parts;
}

export const SUPPORTED_MIME_TYPES: Record<string, ItemKind> = {
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/webp': 'image',
  'application/pdf': 'pdf',
  'audio/mpeg': 'audio',
  'audio/wav': 'audio',
  'audio/x-wav': 'audio',
  'audio/x-m4a': 'audio',
  'audio/mp4': 'audio',
  'video/mp4': 'video',
};
