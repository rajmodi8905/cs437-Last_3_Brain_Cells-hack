import {
  AppOperationError,
  type EngineClient,
  type EngineProgress,
  type IndexedSegment,
  type ItemKind,
  type ProgressListener,
  type SourceLocation,
} from '../shared';
import { DexieLibraryRepository } from '../storage';
import { ModelClient } from '../app/model-client';
import { getManifest, offlineStatus, setupAssets, type AssetManifest } from './assets';
import {
  assertDecodableImage,
  extractMedia,
  extractPdf,
  imageOcr,
  type Extracted,
} from './extract';
import { rankSegments } from './ranking';
import { embeddingTitle } from './documents';
import { isSearchableQuery } from './text-guards';
export const INDEX_VERSION =
  'gemma2-daa72c5-q4-768-ch256o48-img70-lowered1-notitledup1-asr2-ocrconf1-v8';
export class LocalEngine implements EngineClient {
  readonly models = new ModelClient();
  private listeners = new Set<ProgressListener>();
  private manifest?: AssetManifest;
  private running?: Promise<void>;
  private disposed = false;
  private wakeTimer?: ReturnType<typeof setInterval>;
  private active?: { id: string; cancelled: boolean };
  ready = false;
  constructor(readonly repository: DexieLibraryRepository) {}
  emit(event: EngineProgress) {
    for (const listener of this.listeners) listener(event);
  }
  subscribeProgress(listener: ProgressListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  get downloadBytes() {
    return this.manifest?.assets.reduce((sum, asset) => sum + asset.bytes, 0) ?? 0;
  }
  async initialize() {
    this.manifest = await getManifest();
    this.ready = await offlineStatus(this.manifest);
    if (this.ready) {
      this.startWake();
      void this.drain();
    }
  }
  private startWake() {
    if (!this.wakeTimer)
      this.wakeTimer = setInterval(() => {
        if (this.ready && !this.disposed) void this.drain();
      }, 3000);
  }
  async setupModels(onProgress?: ProgressListener) {
    this.ready = false;
    this.manifest ??= await getManifest();
    await setupAssets(this.manifest, (event) => {
      this.emit(event);
      onProgress?.(event);
    });
    this.ready = true;
    this.startWake();
    this.emit({
      stage: 'setup',
      message: 'Offline assets verified',
      loadedBytes: this.manifest.assets.reduce((n, a) => n + a.bytes, 0),
      totalBytes: this.manifest.assets.reduce((n, a) => n + a.bytes, 0),
    });
    void this.drain();
  }
  async indexItem(itemId: string) {
    await this.repository.enqueueItem(itemId);
    if (this.ready) void this.drain();
  }
  private async invalidateOldIndexes() {
    const db = this.repository.database;
    await db.transaction('rw', db.items, db.segments, db.jobs, async () => {
      for (const item of await db.items.where('status').equals('ready').toArray()) {
        const segments = await db.segments.where('itemId').equals(item.id).toArray();
        if (!segments.length || segments.some((s) => s.indexVersion !== INDEX_VERSION)) {
          const generation = item.processingGeneration + 1;
          await db.items.put({ ...item, status: 'queued', processingGeneration: generation });
          await db.segments.where('itemId').equals(item.id).delete();
          await db.jobs.put({ itemId: item.id, generation, queuedAt: Date.now() });
        }
      }
    });
  }
  private drain(): Promise<void> {
    if (this.running) return this.running;
    this.running = (async () => {
      if (!navigator.locks)
        throw new Error(
          'This browser does not support safe processing locks. Use a current Safari, Chrome or Firefox.',
        );
      await navigator.locks.request(
        'campus-recall-processor',
        { ifAvailable: true },
        async (lock) => {
          if (!lock) return;
          await this.repository.recoverInterruptedJobs();
          await this.invalidateOldIndexes();
          for (;;) {
            if (this.disposed || !this.ready) break;
            const claim = await this.repository.claimNextJob();
            if (!claim) break;
            const active = (this.active = { id: claim.item.id, cancelled: false });
            const check = () => {
              if (active.cancelled || this.disposed) throw new Error('Processing cancelled.');
            };
            const progress = (
              stage: EngineProgress['stage'],
              message: string,
              completedUnits?: number,
              totalUnits?: number,
            ) => this.emit({ stage, message, itemId: claim.item.id, completedUnits, totalUnits });
            try {
              const original = await this.repository.getOriginal(claim.item.id);
              if (!original) throw new Error('The original file is unavailable.');
              progress('extracting', 'Reading the saved original');
              let extracted: Extracted;
              switch (claim.item.kind) {
                case 'note':
                case 'webpage':
                  extracted = {
                    parts: [{ text: await original.text(), location: { kind: 'whole' } }],
                  };
                  break;
                case 'image':
                  await assertDecodableImage(original);
                  extracted = {
                    parts: [
                      {
                        image: original,
                        text: await imageOcr(original),
                        location: { kind: 'whole' },
                      },
                    ],
                  };
                  break;
                case 'pdf':
                  extracted = await extractPdf(original, check, (n, total) =>
                    progress('extracting', `Reading page ${n} of ${total}`, n, total),
                  );
                  break;
                default:
                  extracted = await extractMedia(claim.item, original, check);
              }
              check();
              if (extracted.samples) {
                progress('transcribing', 'Transcribing speech on this device');
                const speech = await this.models.transcribe(extracted.samples);
                check();
                for (const chunk of speech.chunks ?? [])
                  if (chunk.text.trim()) {
                    const startMs = Math.max(0, chunk.timestamp[0] * 1000);
                    const endMs = Math.min(
                      extracted.durationMs!,
                      Math.max(
                        startMs + 1,
                        (chunk.timestamp[1] ?? extracted.durationMs! / 1000) * 1000,
                      ),
                    );
                    extracted.parts.push({
                      text: chunk.text.trim(),
                      location: { kind: 'time', startMs, endMs },
                    });
                  }
                extracted.samples = undefined;
              }
              const segments: IndexedSegment[] = [];
              const add = (
                modality: 'text' | 'visual',
                location: SourceLocation,
                vector: Float32Array,
                text?: string,
              ) =>
                segments.push({
                  id: crypto.randomUUID(),
                  itemId: claim.item.id,
                  modality,
                  location,
                  vector,
                  text,
                  indexVersion: INDEX_VERSION,
                });
              for (let i = 0; i < extracted.parts.length; i++) {
                check();
                const part = extracted.parts[i];
                progress(
                  'embedding',
                  `Indexing part ${i + 1} of ${extracted.parts.length}`,
                  i,
                  extracted.parts.length,
                );
                if (part.text?.trim())
                  for (const chunk of await this.models.documents(
                    part.text,
                    embeddingTitle(claim.item, part.text),
                  )) {
                    check();
                    add('text', part.location, chunk.vector, chunk.text);
                  }
                if (part.image) {
                  const vector = await this.models.image(part.image);
                  check();
                  add('visual', part.location, vector);
                  part.image = undefined;
                }
              }
              if (!segments.length)
                throw new Error(
                  'No searchable content was extracted. The original is still saved and can be opened.',
                );
              check();
              progress('publishing', 'Saving the search index');
              const published = await this.repository.publishSegments(claim, segments, {
                durationMs: extracted.durationMs,
                pageCount: extracted.pageCount,
              });
              if (published) progress('ready', 'Ready to search');
              else
                await this.repository.failJob(claim, {
                  code: 'INDEX_INCOMPATIBLE',
                  message: 'The search index did not pass validation. The original is still saved.',
                  retryable: true,
                });
            } catch (cause) {
              const message = cause instanceof Error ? cause.message : String(cause);
              await this.repository.failJob(claim, {
                code: 'EXTRACTION_FAILED',
                message,
                retryable: true,
              });
              progress('failed', message);
            } finally {
              this.active = undefined;
            }
          }
        },
      );
    })()
      .catch((cause) =>
        this.emit({
          stage: 'failed',
          message: cause instanceof Error ? cause.message : String(cause),
        }),
      )
      .finally(() => {
        this.running = undefined;
      });
    return this.running;
  }
  async search(query: string, kind?: ItemKind) {
    if (!query.trim()) return [];
    if (!this.ready)
      throw new AppOperationError({
        code: 'MODEL_NOT_READY',
        message:
          'Set up offline search in Settings first. Saved originals are available in Library.',
        retryable: false,
      });
    if (!isSearchableQuery(query)) return [];
    if (Array.from(query).length > 1000)
      throw new Error('Keep your search under 1,000 characters.');
    const vector = await this.models.query(query.trim());
    return rankSegments(
      vector,
      await this.repository.listSearchableSegments(INDEX_VERSION, kind),
      query,
    );
  }
  async cancelItem(id: string) {
    if (this.active?.id === id) this.active.cancelled = true;
    await this.repository.cancelItem(id);
    this.emit({ stage: 'cancelled', itemId: id, message: 'Processing cancelled. Original kept.' });
  }
  async dispose() {
    this.disposed = true;
    clearInterval(this.wakeTimer);
    if (this.active) this.active.cancelled = true;
    await this.models.dispose();
    this.listeners.clear();
  }
}
