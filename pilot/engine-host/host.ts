// The engine host's browser side (docs/pilot/whatsapp.md): the app's own LocalEngine, its default
// search model and a library database of its own, driven by the pilot server through Playwright.
// It indexes one original the way the app does and searches cloud index bundles the way the app
// searches synced items.
import {
  AppOperationError,
  type ItemKind,
  type SaveInput,
  type SearchableSegment,
  type SourceLocation,
} from '../../src/shared';
import { pdfjs } from '../../src/shared/browser-assets';
import { GEMMA, saveSearchModel } from '../../src/shared/searchModels';
import { INDEX_VERSION, LocalEngine } from '../../src/engine';
import { AnyRecallDatabase, DexieLibraryRepository } from '../../src/storage';
import { repositoryLibrary } from '../client/library';
import type { IndexSegment } from '../contract';

/** The engine host's own library database; never the app's `anyrecall`. */
export const ENGINE_HOST_DATABASE = 'anyrecall-engine-host';

export interface HostIndexInput {
  bytes: Uint8Array;
  kind: ItemKind;
  mimeType: string;
  title: string;
  /** Milliseconds; kept on the temporary item like a saved item's capture time. */
  createdAt: number;
  sourceUrl?: string;
}

export type HostIndexOutcome =
  | {
      ok: true;
      indexVersion: string;
      /** SHA-256 of the original as the app's library computed it. */
      contentSha256: string;
      /** In `IndexBundle.segments` form. */
      segments: IndexSegment[];
      /** Time spent from save to a ready index, in milliseconds. */
      ms: number;
    }
  | {
      ok: false;
      /** The app's own reason; `pageCount` is a refused PDF's number of pages, when readable. */
      error: { code: string; message: string; pageCount?: number };
    };

/** One cloud item's bundle, as search reads it. */
export interface HostSearchItem {
  globalId: string;
  kind: ItemKind;
  /** The bundle's index version; segments of another version are not compared. */
  indexVersion: string;
  segments: IndexSegment[];
}

export interface HostSearchHit {
  globalId: string;
  /** `cloud:<globalId>`, as the app names synced items. */
  itemId: string;
  segmentId: string;
  location: SourceLocation;
  matchKind: 'text' | 'visual';
  excerpt?: string;
  score: number;
}

const NOTE_KINDS = new Set<ItemKind>(['note', 'webpage']);

/** What the app's Add screen would pass to `repository.save` for this original. */
export function saveInputFor(input: HostIndexInput): SaveInput {
  if (NOTE_KINDS.has(input.kind)) {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(input.bytes);
    if (input.kind === 'webpage' && input.sourceUrl)
      return { kind: 'webpage', url: input.sourceUrl, text, title: input.title };
    return { kind: 'note', text, title: input.title };
  }
  const file = new File([input.bytes as BlobPart], 'original', { type: input.mimeType });
  return { kind: 'file', file, title: input.title };
}

/**
 * Cloud items' segments in the shape the app's search ranks, mapped exactly as the app's sync
 * engine maps synced bundles (`SyncEngine.cloudSegments` in pilot/client/sync.ts).
 */
export function cloudSearchSegments(items: HostSearchItem[]): SearchableSegment[] {
  const segments: SearchableSegment[] = [];
  for (const entry of items)
    entry.segments.forEach((segment, i) =>
      segments.push({
        id: `cloud:${entry.globalId}:${i}`,
        itemId: `cloud:${entry.globalId}`,
        itemKind: entry.kind,
        modality: segment.modality,
        location: segment.location,
        text: segment.text,
        vector: Float32Array.from(segment.vector),
        indexVersion: entry.indexVersion,
      }),
    );
  return segments;
}

const failure = (cause: unknown): HostIndexOutcome => ({
  ok: false,
  error:
    cause instanceof AppOperationError
      ? { code: cause.detail.code, message: cause.detail.message }
      : {
          code: 'EXTRACTION_FAILED',
          message: cause instanceof Error ? cause.message : String(cause),
        },
});

/** A PDF's number of pages, or undefined when it cannot be opened (damaged, password-protected). */
export async function pdfPageCount(bytes: Uint8Array) {
  try {
    const task = (await pdfjs()).getDocument({ data: bytes.slice(), useWasm: false });
    try {
      return (await task.promise).numPages;
    } finally {
      await task.destroy();
    }
  } catch {
    return undefined;
  }
}

/** Index and search over an engine whose models are set up. One call runs at a time. */
export function createEngineHost(
  engine: LocalEngine,
  options: { pollMs?: number; now?: () => number } = {},
) {
  const repository = engine.repository;
  const pollMs = options.pollMs ?? 100;
  const now = options.now ?? (() => performance.now());
  // Read exactly as Auto-sync reads a device's segments before publishing them.
  const library = repositoryLibrary(repository, (id) =>
    repository.database.segments.where('itemId').equals(id).toArray(),
  );
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>) => {
    const next = queue.then(work, work);
    queue = next.catch(() => undefined);
    return next;
  };

  function checkModel() {
    // Server bundles are always made with the default model; a student's own model never syncs.
    const model = engine.searchModel;
    if (model.custom || model.indexVersion !== INDEX_VERSION)
      throw new Error('The engine host must use the default search model.');
    if (!engine.ready) throw new Error('The engine host has no models set up.');
  }

  /** Adds a refused PDF's page count, so a chat can say how far it is over the page limit. */
  async function index(input: HostIndexInput): Promise<HostIndexOutcome> {
    const outcome = await indexOnce(input);
    if (outcome.ok || input.kind !== 'pdf') return outcome;
    const pageCount = await pdfPageCount(input.bytes);
    return pageCount === undefined
      ? outcome
      : { ok: false, error: { ...outcome.error, pageCount } };
  }

  async function indexOnce(input: HostIndexInput): Promise<HostIndexOutcome> {
    checkModel();
    const started = now();
    let id: string | undefined;
    try {
      const item = await repository.save(saveInputFor(input));
      id = item.id;
      if (Number.isSafeInteger(input.createdAt) && input.createdAt > 0)
        await repository.database.items.update(item.id, { createdAt: input.createdAt });
      await engine.indexItem(item.id);
      for (;;) {
        const current = await repository.getItem(item.id);
        if (!current) throw new Error('The item disappeared while it was being indexed.');
        if (current.status === 'failed')
          return {
            ok: false,
            error: {
              code: current.error?.code ?? 'EXTRACTION_FAILED',
              message: current.error?.message ?? 'The item could not be indexed.',
            },
          };
        if (current.status === 'ready') {
          const stored = await library.getIndex!(item.id);
          if (!stored) throw new Error('The ready item has no complete index.');
          return {
            ok: true,
            indexVersion: stored.indexVersion,
            contentSha256: current.contentSha256,
            segments: stored.segments.map((segment) => ({
              modality: segment.modality,
              location: segment.location,
              ...(segment.text !== undefined ? { text: segment.text } : {}),
              vector: Array.from(segment.vector),
            })),
            ms: Math.round(now() - started),
          };
        }
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
    } catch (cause) {
      return failure(cause);
    } finally {
      if (id) await repository.deleteItem(id);
    }
  }

  async function search(query: string, items: HostSearchItem[], kind?: ItemKind) {
    checkModel();
    const segments = cloudSearchSegments(items);
    engine.extraSegments = async (filter) =>
      segments.filter((segment) => !filter || segment.itemKind === filter);
    try {
      const results = await engine.search(query, kind);
      return results
        .filter((result) => result.itemId.startsWith('cloud:'))
        .map((result): HostSearchHit => ({
          globalId: result.itemId.slice('cloud:'.length),
          itemId: result.itemId,
          segmentId: result.segmentId,
          location: result.location,
          matchKind: result.matchKind,
          ...(result.excerpt !== undefined ? { excerpt: result.excerpt } : {}),
          score: result.score,
        }));
    } finally {
      engine.extraSegments = undefined;
    }
  }

  return {
    index: (input: HostIndexInput) => serial(() => index(input)),
    search: (query: string, items: HostSearchItem[], kind?: ItemKind) =>
      serial(() => search(query, items, kind)),
  };
}

/** Opens the host's library, removes anything left by an interrupted run and sets up models. */
export async function openEngineHost() {
  // The default model only, whatever an earlier run of this profile chose.
  saveSearchModel(GEMMA);
  const repository = new DexieLibraryRepository(new AnyRecallDatabase(ENGINE_HOST_DATABASE));
  await repository.open();
  for (const item of await repository.listItems()) await repository.deleteItem(item.id);
  const engine = new LocalEngine(repository);
  // The app's own setup: every pinned file is fetched once, checked against its SHA-256 and
  // kept in the asset cache the model worker reads.
  await engine.setupModels();
  return { engine, ...createEngineHost(engine) };
}
