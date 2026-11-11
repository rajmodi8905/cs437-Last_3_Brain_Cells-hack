// Search (embedding) models (S16). EmbeddingGemma is the default and the only built-in model.
// A student may add their own text embedding model from Hugging Face: it is pinned, verified and
// calibrated on this device, labelled experimental, and kept on this device only. Each model has
// its own index version, so vectors from two models are never compared.

export type SearchModelId = 'gemma' | 'custom';

/** One pinned file of a student's own model. */
export interface CustomModelFile {
  name: string;
  url: string;
  bytes: number;
  sha256: string;
}

export interface CustomModelConfig {
  /** Hugging Face model ID, such as "Xenova/bge-small-en-v1.5". */
  repo: string;
  /** The exact commit the files were pinned at. */
  revision: string;
  dtype: 'q8' | 'fp32';
  pooling: 'mean' | 'cls';
  queryPrefix: string;
  documentPrefix: string;
  files: CustomModelFile[];
  dimension: number;
  threshold: number;
  /** Sample questions found, and unrelated campus questions wrongly matched (S16). */
  calibration: { correct: number; total: number; unrelatedMatched: number; unrelatedTotal: number };
}

export interface SearchModel {
  id: SearchModelId;
  /** What Settings calls it. */
  label: string;
  /** What it searches, in plain words. */
  summary: string;
  indexVersion: string;
  dimension: number;
  /** Minimum raw cosine similarity per modality; Infinity means the modality is not indexed. */
  thresholds: { text: number; visual: number };
  /** Whether it embeds pictures and video scenes as well as text. */
  visual: boolean;
  experimental: boolean;
  custom?: CustomModelConfig;
}

export const GEMMA: SearchModel = {
  id: 'gemma',
  label: 'EmbeddingGemma (default)',
  summary: 'Searches text, pictures and video scenes. Tested on our frozen search corpus.',
  // Unchanged from before S16, so existing indexes stay valid.
  indexVersion: 'gemma2-daa72c5-q4-768-ch256o48-img70-lowered1-notitledup1-asr2-ocrconf1-v8',
  dimension: 768,
  // Frozen after calibration; see docs/verification/retrieval.md.
  thresholds: { text: 0.7, visual: 0.69 },
  visual: true,
  experimental: false,
};

/** The fewest calibration questions (of eight) a student's model must find. */
export const MIN_CALIBRATION_CORRECT = 6;
/**
 * The most unrelated campus questions (of eight) a student's model may wrongly match: more than
 * half means most searches would show wrong results. The count is always shown to the student.
 */
export const MAX_UNRELATED_MATCHED = 4;
/** The largest model a student can add, all files together. */
export const MAX_CUSTOM_MODEL_BYTES = 400_000_000;

/** A short, stable hash, so a custom index version changes with anything that changes vectors. */
function fnv(text: string) {
  let hash = 0x811c9dc5;
  for (const char of text) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function customIndexVersion(config: CustomModelConfig) {
  const key = [
    config.repo,
    config.revision,
    config.dtype,
    config.pooling,
    config.queryPrefix,
    config.documentPrefix,
    config.threshold,
  ].join('\n');
  return `custom-${fnv(key)}-d${config.dimension}`;
}

export function customSearchModel(config: CustomModelConfig): SearchModel {
  return {
    id: 'custom',
    label: config.repo,
    summary:
      'Your own model (experimental). Searches text only, including text in screenshots, PDFs and recordings, but not what is in a picture or video. Items from your other devices are searched only with EmbeddingGemma.',
    indexVersion: customIndexVersion(config),
    dimension: config.dimension,
    thresholds: { text: config.threshold, visual: Number.POSITIVE_INFINITY },
    visual: false,
    experimental: true,
    custom: config,
  };
}

/** The vector size of an index version, or undefined for a version no model produces. */
export function dimensionForIndex(indexVersion: string) {
  if (indexVersion === GEMMA.indexVersion) return GEMMA.dimension;
  const custom = /^custom-[0-9a-f]{8}-d([1-9][0-9]{0,4})$/.exec(indexVersion);
  return custom ? Number(custom[1]) : undefined;
}

const ACTIVE_KEY = 'anyrecall:search-model';
const CUSTOM_KEY = 'anyrecall:custom-search-model';

const storage = () => {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
};

const isFile = (file: any): file is CustomModelFile =>
  !!file &&
  typeof file.name === 'string' &&
  typeof file.url === 'string' &&
  file.url.startsWith('https://huggingface.co/') &&
  Number.isSafeInteger(file.bytes) &&
  file.bytes > 0 &&
  typeof file.sha256 === 'string' &&
  /^[0-9a-f]{64}$/.test(file.sha256);

/** A stored custom model, only if every field is well formed. */
export function readCustomModel(value: unknown): CustomModelConfig | undefined {
  const c = value as CustomModelConfig;
  if (
    !c ||
    typeof c.repo !== 'string' ||
    !/^[0-9a-f]{40}$/.test(c.revision) ||
    !['q8', 'fp32'].includes(c.dtype) ||
    !['mean', 'cls'].includes(c.pooling) ||
    typeof c.queryPrefix !== 'string' ||
    typeof c.documentPrefix !== 'string' ||
    !Array.isArray(c.files) ||
    !c.files.length ||
    !c.files.every(isFile) ||
    !Number.isInteger(c.dimension) ||
    c.dimension < 1 ||
    typeof c.threshold !== 'number' ||
    !(c.threshold >= 0 && c.threshold <= 1) ||
    !c.calibration ||
    !(c.calibration.correct >= MIN_CALIBRATION_CORRECT) ||
    !Number.isInteger(c.calibration.unrelatedMatched) ||
    !Number.isInteger(c.calibration.unrelatedTotal) ||
    !(
      c.calibration.unrelatedMatched >= 0 && c.calibration.unrelatedMatched <= MAX_UNRELATED_MATCHED
    )
  )
    return undefined;
  return c;
}

export function savedCustomModel(): CustomModelConfig | undefined {
  try {
    const raw = storage()?.getItem(CUSTOM_KEY);
    return raw ? readCustomModel(JSON.parse(raw)) : undefined;
  } catch {
    return undefined;
  }
}

/** The model in use on this device; EmbeddingGemma when none was chosen or storage is blocked. */
export function activeSearchModel(): SearchModel {
  try {
    if (storage()?.getItem(ACTIVE_KEY) === 'custom') {
      const custom = savedCustomModel();
      if (custom) return customSearchModel(custom);
    }
  } catch {
    // Blocked storage: the default.
  }
  return GEMMA;
}

/** Remembers the model in use, and the student's own model when there is one. */
export function saveSearchModel(model: SearchModel) {
  try {
    if (model.custom) storage()?.setItem(CUSTOM_KEY, JSON.stringify(model.custom));
    storage()?.setItem(ACTIVE_KEY, model.id);
  } catch {
    // Blocked storage: the choice lasts until the page closes.
  }
}
