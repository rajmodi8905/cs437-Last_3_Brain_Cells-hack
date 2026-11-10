import {
  AppOperationError,
  type EngineClient,
  type EngineProgress,
  type IndexedSegment,
  type ItemKind,
  type ProgressListener,
  type SearchableSegment,
  type SourceLocation,
} from '../shared';
import { DexieLibraryRepository } from '../storage';
import { ModelClient } from '../app/model-client';
import { assetsFor, getManifest, offlineStatus, setupAssets, type AssetManifest } from './assets';
import {
  GEMMA,
  activeSearchModel,
  customSearchModel,
  saveSearchModel,
  savedCustomModel,
  type CustomModelConfig,
  type SearchModel,
} from '../shared/searchModels';
import { pinCustomModel } from './customModel';
import { calibrate, calibrationProblem } from './calibration';
import {
  assertDecodableImage,
  extractMedia,
  extractPdf,
  imageOcr,
  type Extracted,
} from './extract';
import { rankForModel } from './modelRanking';
import { embeddingTitle } from './documents';
import { isSearchableQuery } from './text-guards';
export const INDEX_VERSION =
  'gemma2-daa72c5-q4-768-ch256o48-img70-lowered1-notitledup1-asr2-ocrconf1-v8';
export class LocalEngine implements EngineClient {
  readonly models = new ModelClient();
  /** S16: the student's own model's worker. Speech and pictures always use `models`. */
  readonly customModels = new ModelClient('custom');
  private listeners = new Set<ProgressListener>();
  private manifest?: AssetManifest;
  private running?: Promise<void>;
  private disposed = false;
  private wakeTimer?: ReturnType<typeof setInterval>;
  private active?: { id: string; cancelled: boolean };
  /** The search model in use on this device (S16). */
  private model: SearchModel = activeSearchModel();
  ready = false;
  /** Pilot Auto-sync: cloud items' segments, searched on this device with the local ones. */
  extraSegments?: (kind?: ItemKind) => Promise<SearchableSegment[]>;
  constructor(readonly repository: DexieLibraryRepository) {}
  emit(event: EngineProgress) {
    for (const listener of this.listeners) listener(event);
  }
  subscribeProgress(listener: ProgressListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private embedder(model: SearchModel) {
    if (!model.custom) return this.models;
    const { repo, revision, dtype, pooling, queryPrefix, documentPrefix } = model.custom;
    this.customModels.customModel = { repo, revision, dtype, pooling, queryPrefix, documentPrefix };
    return this.customModels;
  }
  get searchModel(): SearchModel {
    return this.model;
  }
  /** The student's own model, when one was added on this device. */
  get customModel(): SearchModel | undefined {
    const saved = this.model.custom ?? savedCustomModel();
    return saved && customSearchModel(saved);
  }
  /** The setup size of a search model's files, shared files included. */
  downloadBytesFor(model: SearchModel) {
    return this.manifest
      ? assetsFor(this.manifest, model).reduce((sum, asset) => sum + asset.bytes, 0)
      : 0;
  }
  get downloadBytes() {
    return this.downloadBytesFor(this.model);
  }
  async initialize() {
    this.manifest = await getManifest();
    this.ready = await offlineStatus(this.manifest, this.model);
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
    await setupAssets(
      this.manifest,
      (event) => {
        this.emit(event);
        onProgress?.(event);
      },
      undefined,
      this.model,
    );
    this.ready = true;
    this.startWake();
    this.emit({
      stage: 'setup',
      message: 'Offline assets verified',
      loadedBytes: this.downloadBytes,
      totalBytes: this.downloadBytes,
    });
    void this.drain();
  }
  /**
   * Adds a student's own model (S16): pins it on Hugging Face, downloads and verifies its files,
   * and calibrates its threshold here. Search keeps using the current model; nothing switches.
   */
  async addCustomModel(
    repo: string,
    options: Pick<CustomModelConfig, 'pooling' | 'queryPrefix' | 'documentPrefix'>,
    onProgress?: ProgressListener,
  ): Promise<SearchModel> {
    const pinned = await pinCustomModel(repo);
    this.manifest ??= await getManifest();
    const spec = { ...pinned, ...options };
    const draft = customSearchModel({
      ...spec,
      dimension: 1,
      threshold: 0,
      calibration: { correct: 0, total: 0, unrelatedMatched: 0, unrelatedTotal: 0 },
    });
    await setupAssets(
      this.manifest,
      (event) => {
        this.emit(event);
        onProgress?.(event);
      },
      undefined,
      draft,
    );
    onProgress?.({ stage: 'setup', message: 'Testing the model with sample questions' });
    const tester = new ModelClient('custom');
    tester.customModel = {
      repo: spec.repo,
      revision: spec.revision,
      dtype: spec.dtype,
      pooling: spec.pooling,
      queryPrefix: spec.queryPrefix,
      documentPrefix: spec.documentPrefix,
    };
    let result;
    try {
      result = await calibrate(tester);
    } finally {
      await tester.dispose();
    }
    const problem = calibrationProblem(spec.repo, result);
    if (problem)
      throw new AppOperationError({ code: 'INVALID_INPUT', message: problem, retryable: false });
    return customSearchModel({
      ...spec,
      dimension: result.dimension,
      threshold: result.threshold,
      calibration: {
        correct: result.correct,
        total: result.total,
        unrelatedMatched: result.unrelatedMatched,
        unrelatedTotal: result.unrelatedTotal,
      },
    });
  }
  /**
   * Switches the search model (S16). The model's files are downloaded and verified first, while
   * search keeps working with the current one. Then every saved item is queued for re-indexing,
   * and each becomes searchable again as soon as it is done.
   */
  async setSearchModel(next: SearchModel, onProgress?: ProgressListener) {
    if (next.indexVersion === this.model.indexVersion) return;
    this.manifest ??= await getManifest();
    if (!(await offlineStatus(this.manifest, next)))
      await setupAssets(
        this.manifest,
        (event) => {
          this.emit(event);
          onProgress?.(event);
        },
        undefined,
        next,
      );
    this.model = next;
    saveSearchModel(next);
    this.ready = true;
    await this.invalidateOldIndexes();
    this.startWake();
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
        if (!segments.length || segments.some((s) => s.indexVersion !== this.model.indexVersion)) {
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
            // The whole job uses the model it started with, even if the student switches.
            const model = this.model;
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
              progress('extracting', 'Getting it ready to search');
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
                progress('transcribing', 'Turning speech into text on this device');
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
              let pictureOnly = false;
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
                  indexVersion: model.indexVersion,
                });
              for (let i = 0; i < extracted.parts.length; i++) {
                check();
                const part = extracted.parts[i];
                progress(
                  'embedding',
                  `Getting it ready to search (${i + 1} of ${extracted.parts.length})`,
                  i,
                  extracted.parts.length,
                );
                if (part.text?.trim())
                  for (const chunk of await this.embedder(model).documents(
                    part.text,
                    embeddingTitle(claim.item, part.text),
                  )) {
                    check();
                    add('text', part.location, chunk.vector, chunk.text);
                  }
                if (part.image && !model.visual) {
                  pictureOnly = true;
                  part.image = undefined;
                }
                if (part.image) {
                  const vector = await this.models.image(part.image);
                  check();
                  add('visual', part.location, vector);
                  part.image = undefined;
                }
              }
              if (!segments.length && pictureOnly)
                throw new Error(
                  `There is no text or speech to search here, and your own search model cannot search what is in a picture or video. Switch to ${GEMMA.label} in Settings to search it. The original is still saved and can be opened.`,
                );
              if (!segments.length)
                throw new Error(
                  'No searchable content was extracted. The original is still saved and can be opened.',
                );
              check();
              progress('publishing', 'Finishing up');
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
    const model = this.model;
    const vector = await this.embedder(model).query(query.trim());
    const local = await this.repository.listSearchableSegments(model.indexVersion, kind);
    // A failing cloud source never blocks local search.
    const extra = (await this.extraSegments?.(kind).catch(() => [])) ?? [];
    const cloud = extra.filter((segment) => segment.indexVersion === model.indexVersion);
    return rankForModel(vector, [...local, ...cloud], query, model.thresholds);
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
    await this.customModels.dispose();
    this.listeners.clear();
  }
}
