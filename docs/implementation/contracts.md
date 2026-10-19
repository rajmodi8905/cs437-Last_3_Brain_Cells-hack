# Shared contracts, version 1

Status: implementation specification, not executable application code. Nakshatra creates the corresponding TypeScript exports in `src/shared/`. All packages implement these names and semantics. Agree on changes before dependent code diverges.

## 1. Constants and records

Use UUID strings, Unix epoch milliseconds, one-based PDF pages, and milliseconds for media locations. MB is decimal. Maximum text length counts Unicode code points. Input formats and limits come from the [plan](../../IMPLEMENTATION_PLAN.md#2-product-and-boundaries).

```ts
type ItemKind = 'image' | 'pdf' | 'note' | 'webpage' | 'audio' | 'video';
type ItemStatus = 'queued' | 'processing' | 'ready' | 'failed';
type SourceLocation =
  | { kind: 'whole' }
  | { kind: 'page'; page: number }
  | { kind: 'time'; startMs: number; endMs: number };

interface LibraryItem {
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

interface IndexedSegment {
  id: string;
  itemId: string;
  modality: 'text' | 'visual';
  location: SourceLocation;
  text?: string;
  vector: Float32Array;
  indexVersion: string;
}

interface SearchResult {
  itemId: string;
  segmentId: string;
  location: SourceLocation;
  matchKind: 'text' | 'visual';
  excerpt?: string;
  score: number;
}

interface AppError {
  code: ErrorCode;
  message: string;
  retryable: boolean;
}

type ErrorCode =
  | 'INVALID_INPUT' | 'UNSUPPORTED_FORMAT' | 'LIMIT_EXCEEDED'
  | 'STORAGE_FAILED' | 'SOURCE_UNAVAILABLE' | 'INVALID_ARCHIVE'
  | 'FETCH_BLOCKED' | 'MODEL_NOT_READY' | 'SETUP_FAILED'
  | 'EXTRACTION_FAILED' | 'INFERENCE_FAILED' | 'CANCELLED'
  | 'INDEX_INCOMPATIBLE' | 'ENGINE_UNAVAILABLE' | 'INTERNAL_ERROR';
```

Export an `AppOperationError extends Error` carrying an `AppError` as `detail`. Promise failures use it; uncaught library errors are mapped at adapter boundaries. `LibraryItem.error` is structured data, not a serialized exception/stack. Ordinary validation failures and absent sources must not expose stack traces in the UI.

Vectors contain 768 finite values and are L2-normalized; reject zero/invalid vectors before publication. All segments in a committed generation use one `indexVersion`. Text segments have nonempty extracted text; visual segments need no text. Result scores are internal ranking scores, never probabilities.

## 2. Public repository

```ts
type SaveInput =
  | { kind: 'file'; file: File; title?: string }
  | { kind: 'note'; text: string; title?: string }
  | { kind: 'webpage'; url: string; text: string; title?: string };

interface ItemFilters {
  kind?: ItemKind;
  status?: ItemStatus;
}

interface ImportReport {
  importedIds: string[];
  skippedDuplicateIds: string[];
}

interface LibraryRepository {
  save(input: SaveInput): Promise<LibraryItem>;
  getItem(id: string): Promise<LibraryItem | undefined>;
  getOriginal(id: string): Promise<Blob | undefined>;
  listItems(filters?: ItemFilters): Promise<LibraryItem[]>;
  renameItem(id: string, title: string): Promise<LibraryItem>;
  deleteItem(id: string): Promise<void>;
  exportItems(ids: string[]): Promise<Blob>;
  importArchive(archive: Blob): Promise<ImportReport>;
}
```

### Saving

- Check supported basic type/container, size, URL scheme, and text limits. Do not trust only an extension. Detailed decoding, PDF encryption/page limits, codecs, and duration are checked by processing before Ready.
- Original file bytes are retained unchanged. Notes and webpage text snapshots are encoded as UTF-8 Blobs. Original URLs and capture times remain metadata, not fetched during local search.
- Calculate SHA-256 before the save transaction. Store original, item record, and pending-job record together; resolve only after commit. Hashing failure is not a successful save.
- New records start queued, generation 0, without an error. Saving is independent of model readiness. The engine subsequently processes the queued job.
- A title is optional. Derive it from the filename, webpage title/host, or first note line; fall back to the item kind. Limit display titles to 120 code points. Preserve the full original filename separately.
- Do not create an item on a basic validation or storage error. Once stored, a deeper extraction/codec error leaves the original present and marks Failed.

### Reading, editing, deletion

- `getOriginal` accepts an item ID, resolves its Blob reference, and returns undefined if either record is absent. Do not substitute by title or filename.
- List newest `createdAt` first, using item ID as a stable tie-breaker. Include queued and failed items. Filters are optional and combined when both are present.
- Rename validates a nonempty title, retains ID/hash/Blob/capture time, increments the processing generation, and queues reindexing if indexed title input changes. It must invalidate any old in-flight publication.
- Delete is idempotent. Atomically remove item, original, related previews, segments, and jobs. Generation/existence checks make late publications fail. Do not wait for an engine callback before removing the item.
- React may observe Dexie live queries. UI callers use repository methods rather than creating another persistence implementation.

## 3. Engine persistence port

Nakshatra supplies this transactional port; Raj uses it without creating a second database/schema.

```ts
interface ProcessingClaim {
  item: LibraryItem;
  generation: number;
  claimId: string;
}

interface SearchableSegment extends IndexedSegment {
  itemKind: ItemKind;
}

interface ProcessingRepository {
  enqueueItem(itemId: string): Promise<void>;
  claimNextJob(): Promise<ProcessingClaim | undefined>;
  recoverInterruptedJobs(): Promise<void>;
  publishSegments(
    claim: ProcessingClaim,
    segments: IndexedSegment[],
    metadata?: { durationMs?: number; pageCount?: number }
  ): Promise<boolean>;
  failJob(claim: ProcessingClaim, error: AppError): Promise<boolean>;
  cancelItem(itemId: string): Promise<void>;
  listSearchableSegments(
    indexVersion: string,
    kind?: ItemKind
  ): Promise<SearchableSegment[]>;
}
```

- Enqueue is idempotent for an already queued/processing item. Retry of a failed item increments generation, clears its error, and queues it. It cannot recreate an absent item. Ready items with compatible indexes are not reindexed merely by reopening the app.
- Claim atomically takes the oldest queued job, assigns a unique claim ID, marks Processing, and returns the current generation/original metadata. Two claim calls cannot return the same claim.
- Raj holds an origin-wide Web Lock while operating the processing queue. Call recovery only after obtaining this lock, so another open tab's active work is not reset. A released/crashed lock permits recovery of unfinished Processing jobs to Queued.
- Publication checks item existence, generation, and claim ID inside the transaction. If stale, return false without writing anything. Otherwise replace that item's segments, apply derived metadata, clear its job/error, and mark Ready in one transaction.
- Failure is similarly guarded. On valid failure, keep the original, remove any partial published segments for the failed generation, and mark Failed with a reason. Return false for stale claims.
- Cancel increments generation, removes pending/active job records and stale segments, and marks Failed with `CANCELLED`; originals remain. Retry is explicit. Delete remains the public repository operation above.
- Searchable segments belong only to Ready items, match the requested index version, and respect the optional type filter. Never include partially processed or deleted records.
- Do not delete a different item's derived records while cleaning up one generation.

Raw Blob access and the public item reads may be shared with this port. Store implementation details remain inside `src/storage/`.

## 4. Engine client and worker messages

```ts
type ProcessingStage =
  | 'setup' | 'queued' | 'extracting' | 'transcribing'
  | 'embedding' | 'publishing' | 'ready' | 'failed' | 'cancelled';

interface EngineProgress {
  stage: ProcessingStage;
  itemId?: string;
  loadedBytes?: number;
  totalBytes?: number;
  completedUnits?: number;
  totalUnits?: number;
  message?: string;
}

type ProgressListener = (event: EngineProgress) => void;

interface EngineClient {
  setupModels(onProgress?: ProgressListener): Promise<void>;
  indexItem(itemId: string): Promise<void>;
  search(query: string, kindFilter?: ItemKind): Promise<SearchResult[]>;
  cancelItem(itemId: string): Promise<void>;
  subscribeProgress(listener: ProgressListener): () => void;
  dispose(): Promise<void>;
}
```

`setupModels` resolves only after all required runtime assets are verified. `indexItem` resolves after enqueuing, not after processing; use stored status/progress to observe completion. After setup/startup the engine discovers saved queued jobs, even if the tab closed before an explicit `indexItem` call.

Trimmed empty queries return `[]` without inference. A nonempty search without ready model assets rejects with `MODEL_NOT_READY`, not a fake empty result. `dispose` releases workers and heavyweight sessions, leaving durable jobs recoverable and originals/models intact. Consumers unsubscribe progress listeners on teardown.

Worker protocol version 1:

```ts
type EngineRequest =
  | { requestId: string; type: 'setupModels' }
  | { requestId: string; type: 'indexItem'; itemId: string }
  | { requestId: string; type: 'search'; query: string; kindFilter?: ItemKind }
  | { requestId: string; type: 'cancelItem'; itemId: string }
  | { requestId: string; type: 'dispose' };

type EngineResponse =
  | { requestId: string; type: 'success'; results?: SearchResult[] }
  | { requestId: string; type: 'error'; error: AppError }
  | { type: 'progress'; event: EngineProgress };
```

One request gets one terminal response; progress is a separate stream. No React components cross the worker boundary. Large originals are retrieved by ID from IndexedDB. Browser-only DOM/video/canvas operations may use a main-thread adapter, but heavy decoding/inference stays outside React rendering. Prioritize pending searches between processing stages while keeping a single heavyweight inference schedule.

Until Raj's adapter is merged, the production unavailable adapter rejects engine operations with `ENGINE_UNAVAILABLE`. Repository operations remain available independently; Raj builds the library UI and original viewers. Fixture adapters are imported only by tests/stories, not production routes.

## 5. Ranking and provenance

- Text query prefix: `task: search result | query: {query}`. Text documents: `title: {title} | text: {content}`. For absent source titles, use `none`. Apply the export's documented image processing rather than a text prefix to images.
- Index version includes the pinned embedding revision, q4 configuration, 768 dimensions, prefix policy, chunking version, and extraction version. Only matching indexes can be searched.
- Calculate cosine similarity locally. Eligibility is `cosine >= threshold[modality]`; it is not a probability. Choose thresholds with the separate calibration data in [acceptance.md](acceptance.md), then freeze them before acceptance evaluation.
- For eligible text segments, ranking score is cosine plus `0.08 * matchedQueryTokenFraction`. Lowercase Unicode word/number tokens, deduplicate query tokens, and count exact token matches in that segment's text. Visual segments get no lexical boost. Empty token sets contribute zero.
- Keep the highest-ranked segment per item; break score ties by item ID, then segment ID. Sort descending, return at most five. Preserve the selected segment/location.
- Extract excerpts as a contiguous substring of that text segment, up to 240 code points, centered on the first matching token where possible. Do not generate an answer or a visual caption. UI renders text safely.
- A PDF location is one-based. A time location satisfies `0 <= startMs < endMs <= durationMs`. For a sampled frame, use its sample time as start and the next five seconds, bounded by duration, as end.
- Source viewing loads by item ID, not by index text, filename, or title. Missing files produce `SOURCE_UNAVAILABLE` and no substitution. Excerpts are automated extraction, not verified human quotes.
- Detect incompatible Ready records, exclude their stale vectors, and queue reindexing. Do not fall back to another remote embedding provider.

## 6. Archive format

ZIP MIME type `application/zip`, with `manifest.json` and `originals/{itemId}` entries. Archive manifest:

```ts
interface ArchiveManifest {
  format: 'campus-recall';
  version: 1;
  exportedAt: number;
  items: Array<{
    id: string;
    kind: ItemKind;
    title: string;
    originalName?: string;
    mimeType: string;
    byteLength: number;
    contentSha256: string;
    createdAt: number;
    sourceUrl?: string;
    originalPath: string;
  }>;
}
```

Export only the selected originals and user metadata. Do not include jobs, error stacks, extracted text, embeddings, model weights, browser identifiers, or settings containing stale readiness claims. This is an unencrypted archive; explain that in the export screen.

Validate format/version, known kinds, safe allowed paths, unique manifest IDs, actual byte lengths, per-item limits, text/URL constraints, and recomputed SHA-256 before committing. Reject missing/tampered originals, traversal/extra executable entries, and unsupported versions. Reject an empty export selection explicitly. Corrupt import must not partially change the current library.

Restore all valid new items in a transaction with fresh item IDs, preserved titles/capture time/original bytes, queued status, and generation 0. An existing item with the same hash, kind, and source URL is a duplicate; skip it and report its existing ID without changing its title. The hash is necessary; matching titles alone are never duplicates. Do not trust imported derived duration/page information; recompute it. Quota/storage failure aborts the import and preserves the pre-import library.

## 7. Asset/network and UI contracts

Raj owns all UI consumers, source viewers, PWA caching, and engine integration below. Nakshatra supplies the persistence ports; Chaitanya supplies policy/user-documentation content only. Do not create parallel UI implementations in teammate packages.

- Explicit setup downloads only allowlisted, pinned model/runtime assets. Manifest entries include URL, revision/version, expected bytes, and integrity hash established before release. Readiness requires every needed asset, including PDF/OCR/media runtimes, not just weights.
- Cache only public application/model assets through runtime caching. Private originals, extracted text, and queries stay in IndexedDB/memory and are not URL query parameters or cache keys.
- No remote fetch on core import/index/search/view paths after setup. Missing/corrupt cached assets produce a repair/setup state; no automatic online fallback during a private operation.
- Explicit public webpage fetch/open and model setup are separate actions. Fetch snapshots with omitted credentials. Capture up to the agreed text limit, recording truncation when applicable. A blocked/failed fetch offers manual content; never pretend a URL-only bookmark contains page contents.
- Request storage persistence where supported; show actual storage estimates, not an invented remaining-capacity figure. Do not claim OS backup exclusion or at-rest encryption.
- UI reads metadata through the repository, model progress through `EngineClient`, and local source Blobs through `getOriginal`. Revoke temporary object URLs after viewer teardown.
- Audio/video loads seek only after metadata is available; pressing a result does not force autoplay. PDF page navigation is checked against actual page count.
- Production never auto-loads synthetic demo content. Tests can inject explicit fixture adapters. No confidence percentages, invented captions, fake counters, or generated answers.
