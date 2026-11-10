// S16: EmbeddingGemma stays the default exactly. A student's own model is pinned, verified and
// calibrated before use, has its own vectors and threshold, and a switch re-indexes the library.
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import {
  GEMMA,
  activeSearchModel,
  customIndexVersion,
  customSearchModel,
  dimensionForIndex,
  saveSearchModel,
  type CustomModelConfig,
} from '../../src/shared/searchModels';
import { INDEX_VERSION, LocalEngine } from '../../src/engine/index';
import { THRESHOLDS, rankSegments } from '../../src/engine/ranking';
import { rankByThresholds, rankForModel } from '../../src/engine/modelRanking';
import { modelSettings, pinCustomModel } from '../../src/engine/customModel';
import {
  CALIBRATION_SET,
  CAMPUS_CHECK,
  calibrate,
  calibrationProblem,
  chooseThreshold,
} from '../../src/engine/calibration';
import { assetsFor, offlineStatus, setupAssets, type AssetManifest } from '../../src/engine/assets';
import { CampusRecallDatabase, DexieLibraryRepository } from '../../src/storage/index';
import type { IndexedSegment, SearchableSegment } from '../../src/shared';

afterEach(() => vi.unstubAllGlobals());

const bytes = (text: string) => new TextEncoder().encode(text);
const sha = async (data: Uint8Array<ArrayBuffer>) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), (x) =>
    x.toString(16).padStart(2, '0'),
  ).join('');
const REVISION = 'ea104dacec62c0de699686887e3f920caeb4f3e3';

async function config(extra: Partial<CustomModelConfig> = {}): Promise<CustomModelConfig> {
  return {
    repo: 'Example/text-model',
    revision: REVISION,
    dtype: 'q8',
    pooling: 'mean',
    queryPrefix: '',
    documentPrefix: '',
    files: [
      {
        name: 'onnx/model_quantized.onnx',
        url: `https://huggingface.co/Example/text-model/resolve/${REVISION}/onnx/model_quantized.onnx`,
        bytes: bytes('custom-model').length,
        sha256: await sha(bytes('custom-model')),
      },
    ],
    dimension: 384,
    threshold: 0.52,
    calibration: { correct: 8, total: 8, unrelatedMatched: 1, unrelatedTotal: 8 },
    ...extra,
  };
}
function memoryStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  });
  return store;
}

it('[S16] EmbeddingGemma stays the default search model exactly', () => {
  memoryStorage();
  expect(activeSearchModel()).toBe(GEMMA);
  expect(GEMMA.indexVersion).toBe(INDEX_VERSION);
  expect(GEMMA.dimension).toBe(768);
  expect(GEMMA.thresholds).toEqual(THRESHOLDS);
  expect(GEMMA.visual).toBe(true);
  expect(GEMMA.experimental).toBe(false);
  expect(dimensionForIndex(INDEX_VERSION)).toBe(768);
  vi.stubGlobal('localStorage', {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  });
  expect(activeSearchModel()).toBe(GEMMA);
  expect(() => saveSearchModel(GEMMA)).not.toThrow();
});

it("[S16] a student's own model is remembered only when it is well formed and calibrated", async () => {
  const store = memoryStorage();
  const custom = customSearchModel(await config());
  expect(custom.experimental).toBe(true);
  expect(custom.visual).toBe(false);
  expect(custom.thresholds.text).toBe(0.52);
  expect(custom.indexVersion).toBe(customIndexVersion(await config()));
  expect(custom.indexVersion).toMatch(/^custom-[0-9a-f]{8}-d384$/);
  expect(dimensionForIndex(custom.indexVersion)).toBe(384);
  expect(dimensionForIndex('custom-zz-d384')).toBeUndefined();
  // Anything that changes the vectors changes the index version.
  expect(customSearchModel(await config({ pooling: 'cls' })).indexVersion).not.toBe(
    custom.indexVersion,
  );
  saveSearchModel(custom);
  expect(activeSearchModel().indexVersion).toBe(custom.indexVersion);
  saveSearchModel(GEMMA);
  expect(activeSearchModel()).toBe(GEMMA);
  // A damaged or under-calibrated stored model is ignored.
  saveSearchModel(
    customSearchModel(
      await config({
        calibration: { correct: 5, total: 8, unrelatedMatched: 0, unrelatedTotal: 8 },
      }),
    ),
  );
  expect(activeSearchModel()).toBe(GEMMA);
  saveSearchModel(
    customSearchModel(
      await config({
        calibration: { correct: 8, total: 8, unrelatedMatched: 5, unrelatedTotal: 8 },
      }),
    ),
  );
  expect(activeSearchModel()).toBe(GEMMA);
  saveSearchModel(custom);
  for (const key of store.keys()) if (key.includes('custom')) store.set(key, '{"repo":1}');
  expect(activeSearchModel()).toBe(GEMMA);
});

const PUBLISHED: Record<string, unknown> = {
  '1_Pooling/config.json': { pooling_mode_cls_token: true, pooling_mode_mean_tokens: false },
  'config_sentence_transformers.json': {
    prompts: { query: 'Represent this sentence for searching relevant passages: ', document: '' },
  },
};
function hub(siblings: any[], options: { status?: number; gated?: boolean } = {}) {
  const fetched: string[] = [];
  const fetcher = vi.fn(async (url: string) => {
    fetched.push(url);
    if (url.includes('/api/models/'))
      return options.status
        ? new Response('', { status: options.status })
        : Response.json({ sha: REVISION, gated: options.gated ?? false, siblings });
    const name = url.split(`/resolve/${REVISION}/`)[1]!;
    if (name in PUBLISHED) return Response.json(PUBLISHED[name]);
    return new Response(bytes(`contents of ${name}`));
  }) as unknown as typeof fetch;
  return { fetcher, fetched };
}
const small = (name: string) => ({ rfilename: name, size: bytes(`contents of ${name}`).length });
const large = (name: string, size = 34_014_426) => ({
  rfilename: name,
  size,
  lfs: { sha256: 'a'.repeat(64), size },
});
const usable = [
  small('config.json'),
  small('tokenizer.json'),
  small('tokenizer_config.json'),
  large('onnx/model.onnx', 133_000_000),
  large('onnx/model_quantized.onnx'),
];

it('[S16] a Hugging Face listing becomes pinned files and published settings, or a plain refusal', async () => {
  const { fetcher, fetched } = hub(usable);
  const pinned = await pinCustomModel(' https://huggingface.co/Example/text-model/ ', fetcher);
  expect(fetched[0]).toBe(
    'https://huggingface.co/api/models/Example/text-model/revision/main?blobs=true',
  );
  expect(pinned.repo).toBe('Example/text-model');
  expect(pinned.revision).toBe(REVISION);
  expect(pinned.dtype).toBe('q8');
  expect(pinned.files.map((f) => f.name)).toEqual([
    'config.json',
    'tokenizer.json',
    'tokenizer_config.json',
    'onnx/model_quantized.onnx',
  ]);
  for (const file of pinned.files)
    expect(file.url).toBe(
      `https://huggingface.co/Example/text-model/resolve/${REVISION}/${file.name}`,
    );
  // Small files are hashed from their bytes; large ones carry Hugging Face's SHA-256.
  expect(pinned.files[0]!.sha256).toBe(await sha(bytes('contents of config.json')));
  expect(pinned.files[3]!.sha256).toBe('a'.repeat(64));
  // Nothing published: no settings are guessed here.
  expect(pinned.published).toEqual({});
  // Published sentence-transformers settings are read, and the student's choices still win.
  const withSettings = await pinCustomModel(
    'Example/text-model',
    hub([...usable, small('1_Pooling/config.json'), small('config_sentence_transformers.json')])
      .fetcher,
  );
  expect(withSettings.published).toEqual({
    pooling: 'cls',
    queryPrefix: 'Represent this sentence for searching relevant passages: ',
    documentPrefix: '',
  });
  expect(withSettings.files.map((f) => f.name)).not.toContain('1_Pooling/config.json');
  expect(modelSettings(withSettings.published, {})).toEqual(withSettings.published);
  expect(
    modelSettings(withSettings.published, { pooling: 'mean', queryPrefix: 'query: ' }),
  ).toEqual({
    pooling: 'mean',
    queryPrefix: 'query: ',
    documentPrefix: '',
  });
  expect(modelSettings({}, {})).toEqual({ pooling: 'mean', queryPrefix: '', documentPrefix: '' });
  // Without an 8-bit export, the full-precision file is used.
  const fp32 = await pinCustomModel('Example/text-model', hub(usable.slice(0, 4)).fetcher);
  expect(fp32.dtype).toBe('fp32');

  const refusal = async (input: string, siblings: any[], options = {}) => {
    try {
      await pinCustomModel(input, hub(siblings, options).fetcher);
    } catch (cause) {
      return (cause as Error).message;
    }
    throw new Error('expected a refusal');
  };
  expect(await refusal('not a model id', usable)).toMatch(/Enter a Hugging Face model ID/);
  expect(await refusal('Example/../secrets', usable)).toMatch(/Enter a Hugging Face model ID/);
  expect(await refusal('Example/missing', usable, { status: 404 })).toMatch(/no public model/);
  expect(await refusal('Example/private', usable, { status: 401 })).toMatch(/sign-in/);
  expect(await refusal('Example/gated', usable, { gated: true })).toMatch(/gated/);
  expect(await refusal('Example/text-model', usable.slice(0, 3))).toMatch(/no ONNX export/);
  expect(await refusal('Example/text-model', usable.slice(1))).toMatch(/no config\.json/);
  expect(
    await refusal('Example/text-model', [...usable, large('onnx/model_quantized.onnx_data')]),
  ).toMatch(/several files/);
  expect(
    await refusal('Example/text-model', [
      ...usable.slice(0, 3),
      large('onnx/model_quantized.onnx', 450_000_000),
    ]),
  ).toMatch(/up to 400 MB/);
});

it('[S16] calibration uses the separate set and the same grid rule as EmbeddingGemma', async () => {
  const fixture = JSON.parse(await readFile('tests/fixtures/calibration.json', 'utf8'));
  expect(CALIBRATION_SET.texts).toEqual(fixture.texts);
  expect(CALIBRATION_SET.negatives).toEqual(fixture.negatives);
  // Two questions; a negative scores 0.5 against document 1.
  const scores = [
    [0.8, 0.3],
    [0.2, 0.55],
  ];
  // 0.51 to 0.55 find both; the highest such threshold is kept.
  expect(chooseThreshold(scores, [[0.1, 0.5]])).toEqual({ threshold: 0.55, correct: 2 });
  // If every threshold that finds question 2 admits a negative, question 2 is given up.
  expect(chooseThreshold(scores, [[0.1, 0.6]])).toEqual({ threshold: 0.8, correct: 1 });
});

it('[S16] calibration counts unrelated campus questions a model wrongly matches, and refuses most', async () => {
  // The campus check is separate from the frozen calibration set and from itself.
  const fixed = new Set([
    ...CALIBRATION_SET.texts.flatMap((t) => [t.text, t.query]),
    ...CALIBRATION_SET.negatives,
  ]);
  for (const text of [
    ...CAMPUS_CHECK.selectionNegatives,
    ...CAMPUS_CHECK.notes,
    ...CAMPUS_CHECK.unrelated,
  ])
    expect(fixed.has(text)).toBe(false);
  expect(CAMPUS_CHECK.unrelated).toHaveLength(8);
  // A fake model: each text gets its own direction, except that every question in
  // "matching" shares a direction with the first campus note.
  const names = new Map<string, number>();
  const axis = (text: string) => names.get(text) ?? names.set(text, names.size).get(text)!;
  const fake = (matching: string[]) => {
    const vector = (text: string) => {
      const v = new Float32Array(64);
      v[matching.includes(text) ? axis(CAMPUS_CHECK.notes[0]!) : axis(text)] = 1;
      const pair = CALIBRATION_SET.texts.find((t) => t.query === text);
      if (pair) {
        v.fill(0);
        v[axis(pair.text)] = 1;
      }
      return v;
    };
    return {
      documents: async (text: string) => [{ vector: vector(text) }],
      query: async (text: string) => vector(text),
    };
  };
  const clean = await calibrate(fake([]));
  expect(clean).toMatchObject({ correct: 8, total: 8, unrelatedMatched: 0, unrelatedTotal: 8 });
  const loose = await calibrate(fake(CAMPUS_CHECK.unrelated.slice(0, 5)));
  expect(loose.unrelatedMatched).toBe(5);
  expect(calibrationProblem('Example/loose', loose)).toMatch(/matched 5 of 8 unrelated questions/);
  expect(calibrationProblem('Example/clean', clean)).toBeUndefined();
  expect(calibrationProblem('Example/weak', { ...clean, correct: 5 })).toMatch(/found only 5 of 8/);
  // The campus negatives take part in choosing the threshold: one that points exactly at a
  // calibration note is admitted at every threshold, so nothing can be found safely.
  const target = CALIBRATION_SET.texts[0]!.text;
  const poisoned = {
    documents: async (text: string) => await fake([]).documents(text),
    query: async (text: string) =>
      text === CAMPUS_CHECK.selectionNegatives[0]
        ? (await fake([]).documents(target))[0]!.vector
        : fake([]).query(text),
  };
  expect((await calibrate(poisoned)).correct).toBe(0);
});

async function manifest(): Promise<AssetManifest> {
  const asset = async (name: string, group: string) => ({
    url: `https://example.test/${name}`,
    bytes: bytes(name).length,
    sha256: await sha(bytes(name)),
    name,
    group,
  });
  return {
    version: 'gemma-version',
    assets: [await asset('gemma-model', 'embeddings'), await asset('speech-model', 'speech')],
  };
}
function stubCache() {
  const entries = new Map<string, Response>();
  const key = (input: any) => (typeof input === 'string' ? input : (input.href ?? input.url));
  vi.stubGlobal('location', { href: 'https://app.test/' });
  vi.stubGlobal('caches', {
    open: async () => ({
      match: async (input: any) => entries.get(key(input))?.clone(),
      put: async (input: any, response: Response) => void entries.set(key(input), response.clone()),
      delete: async (input: any) => entries.delete(key(input)),
    }),
  });
  return entries;
}
const serve = () =>
  vi.fn(
    async (url: string) =>
      new Response(bytes(url.includes('/resolve/') ? 'custom-model' : url.split('/').at(-1)!)),
  );

it('[S16] each model downloads and verifies only its own files and has its own readiness', async () => {
  const entries = stubCache();
  const fetcher = serve();
  vi.stubGlobal('fetch', fetcher);
  const list = await manifest();
  const custom = customSearchModel(await config());
  expect(assetsFor(list, GEMMA).map((a) => a.name)).toEqual(['gemma-model', 'speech-model']);
  expect(assetsFor(list, custom).map((a) => a.name)).toEqual([
    'speech-model',
    'onnx/model_quantized.onnx',
  ]);
  await setupAssets(list, () => {}, undefined, custom);
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
    'https://example.test/speech-model',
    custom.custom!.files[0]!.url,
  ]);
  expect(await offlineStatus(list, custom)).toBe(true);
  expect(await offlineStatus(list, GEMMA)).toBe(false);
  // EmbeddingGemma's readiness marker is unchanged, so existing installs stay ready.
  await setupAssets(list, () => {}, undefined, GEMMA);
  expect(entries.has('https://app.test/offline-gemma-version')).toBe(true);
  expect(await offlineStatus(list)).toBe(true);
  // A tampered file of the student's model fails verification.
  entries.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(bytes('tampered'))),
  );
  await expect(setupAssets(list, () => {}, undefined, custom)).rejects.toThrow(/Integrity/);
  expect(await offlineStatus(list, custom)).toBe(false);
});

const segment = (vector: number[], modality: 'text' | 'visual' = 'text'): SearchableSegment => ({
  id: crypto.randomUUID(),
  itemId: crypto.randomUUID(),
  itemKind: 'note',
  modality,
  location: { kind: 'whole' },
  vector: Float32Array.from(vector),
  text: 'Lab moved to room 204',
  indexVersion: INDEX_VERSION,
});

it('[S16] each model ranks with its own calibrated threshold', async () => {
  const custom = customSearchModel(await config());
  const query = Float32Array.from([1, 0]);
  const near = segment([0.6, 0.8]); // cosine 0.6
  expect(rankForModel(query, [near], 'lab', GEMMA.thresholds)).toEqual([]);
  expect(rankForModel(query, [near], 'lab', custom.thresholds).map((r) => r.itemId)).toEqual([
    near.itemId,
  ]);
  // A student's model has no picture vectors, so a visual segment never counts for it.
  expect(rankForModel(query, [segment([1, 0], 'visual')], 'lab', custom.thresholds)).toEqual([]);
});

it('[S16] ranking with explicit thresholds matches the frozen ranking exactly', () => {
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const unit = (n: number) => {
    const v = Array.from({ length: n }, () => random() - 0.5);
    const norm = Math.hypot(...v);
    return Float32Array.from(v, (x) => x / norm);
  };
  const words = ['lab', 'moved', 'room', 'mess', 'closes', 'card'];
  for (let round = 0; round < 50; round++) {
    const query = unit(4);
    const segments: SearchableSegment[] = Array.from({ length: 12 }, (_, i) => {
      const noise = unit(4);
      const mixed = query.map((q, k) => q * random() * 1.5 + noise[k]!);
      const norm = Math.hypot(...mixed);
      return {
        id: `s${round}-${i}`,
        itemId: `item-${i % 5}`,
        itemKind: 'note',
        modality: random() < 0.3 ? 'visual' : 'text',
        location: { kind: 'whole' },
        vector: mixed.map((x) => x / norm),
        text: words.filter(() => random() < 0.5).join(' '),
        indexVersion: INDEX_VERSION,
      };
    });
    const text = words.filter(() => random() < 0.4).join(' ');
    expect(rankByThresholds(query, segments, text, THRESHOLDS)).toEqual(
      rankSegments(query, segments, text),
    );
  }
});

async function claimedNote() {
  const repository = new DexieLibraryRepository(
    new CampusRecallDatabase(`s16-${crypto.randomUUID()}`),
  );
  await repository.open();
  const item = await repository.save({ kind: 'note', text: 'Lab moved to room 204.' });
  const claim = (await repository.claimNextJob())!;
  return { repository, item, claim };
}
const indexed = (itemId: string, dimension: number, indexVersion: string): IndexedSegment[] => [
  {
    id: crypto.randomUUID(),
    itemId,
    modality: 'text',
    location: { kind: 'whole' },
    vector: Float32Array.from({ length: dimension }, (_, i) => (i === 0 ? 1 : 0)),
    text: 'Lab moved to room 204.',
    indexVersion,
  },
];

it("[S16] the library stores only vectors of the size the segment's model produces", async () => {
  const custom = customSearchModel(await config());
  for (const [dimension, version, ok] of [
    [384, INDEX_VERSION, false],
    [768, custom.indexVersion, false],
    [384, custom.indexVersion, true],
    [768, INDEX_VERSION, true],
  ] as const) {
    const { repository, item, claim } = await claimedNote();
    expect(await repository.publishSegments(claim, indexed(item.id, dimension, version))).toBe(ok);
  }
});

it('[S16] switching models re-queues every saved item, and switching back restores the default', async () => {
  memoryStorage();
  const { repository, item, claim } = await claimedNote();
  expect(await repository.publishSegments(claim, indexed(item.id, 768, INDEX_VERSION))).toBe(true);
  stubCache();
  const list = await manifest();
  const custom = customSearchModel(await config());
  // Both models' files are already verified on this device.
  vi.stubGlobal('fetch', serve());
  await setupAssets(list, () => {}, undefined, custom);
  await setupAssets(list, () => {}, undefined, GEMMA);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(list)),
  );
  const engine = new LocalEngine(repository);
  // Processing itself needs the model workers; this test checks only the hand-over.
  (engine as any).drain = vi.fn(async () => {});
  await engine.initialize();
  expect(engine.searchModel).toBe(GEMMA);
  await engine.setSearchModel(custom);
  expect(engine.searchModel.indexVersion).toBe(custom.indexVersion);
  expect(engine.ready).toBe(true);
  expect(activeSearchModel().indexVersion).toBe(custom.indexVersion);
  expect((await repository.getItem(item.id))?.status).toBe('queued');
  expect(await repository.listSearchableSegments(INDEX_VERSION)).toEqual([]);
  expect(engine.downloadBytes).toBe(assetsFor(list, custom).reduce((n, a) => n + a.bytes, 0));
  // Back to the default: the student's model stays available, EmbeddingGemma is in use again.
  await engine.setSearchModel(GEMMA);
  expect(engine.searchModel).toBe(GEMMA);
  expect(activeSearchModel()).toBe(GEMMA);
  expect(engine.customModel?.indexVersion).toBe(custom.indexVersion);
});
