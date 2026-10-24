/// <reference lib="webworker" />
import {
  AutoConfig,
  AutoModel,
  AutoProcessor,
  RawImage,
  env,
  pipeline,
} from '@huggingface/transformers';
import { normalize } from './ranking';
import type {
  ModelRequest,
  ModelResponse,
  DocumentEmbedding,
  Transcript,
} from '../app/model-protocol';
import { hasAudibleSamples, audibleRange } from './audio';
import { chunkTokenIds } from './chunks';
import { formatQuery } from './query';
import { ASSET_CACHE } from './assets';
import { lowerQuantizedGather } from './onnx-q4';
const GEMMA = 'onnx-community/embeddinggemma-2-ONNX';
const REVISION = 'daa72c51243991dfcaf9f9137d2c573d8f7790c0';
const SPEECH = 'onnx-community/whisper-tiny.en';
const SPEECH_REVISION = '2575352d61be1bf7225cf8f8b268a4678025fc58';
// Worker bundle URLs live in assets/. The main thread supplies the application base.
let model: any, processor: any, speech: any;
let device: 'webgpu' | 'wasm' = 'wasm';
let configured = false;
async function configure(appBase: string, forceWasm = false) {
  if (configured) return;
  configured = true;
  const browserFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('blob:') || url.startsWith('data:')) return browserFetch(input, init);
    return (
      (await (await caches.open(ASSET_CACHE)).match(url)) ??
      new Response('Missing offline asset. Repair setup in Settings.', { status: 404 })
    );
  };
  env.fetch = globalThis.fetch;
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.useBrowserCache = false;
  env.useCustomCache = true;
  env.localModelPath = 'https://huggingface.co/';
  env.remotePathTemplate = '{model}/resolve/{revision}/';
  env.customCache = {
    async match(key: string) {
      const cache = await caches.open(ASSET_CACHE);
      let url = key;
      // Local paths omit resolve/revision in Transformers.js. Resolve only known pinned repositories.
      for (const [repo, revision] of [
        [GEMMA, REVISION],
        [SPEECH, SPEECH_REVISION],
      ]) {
        const prefix = `https://huggingface.co/${repo}/`;
        if (url.startsWith(prefix) && !url.includes('/resolve/'))
          url = url.replace(prefix, `${prefix}resolve/${revision}/`);
      }
      const response = await cache.match(url);
      if (response && device === 'wasm' && /\/(model|vision_encoder)_q4\.onnx$/.test(url))
        return new Response(
          lowerQuantizedGather(new Uint8Array(await response.arrayBuffer())) as BlobPart,
        );
      return response ?? undefined;
    },
    async put() {
      throw new Error('Models must be downloaded using Settings.');
    },
  };
  const safari = /Version\/(\d+).*Safari/.exec(navigator.userAgent);
  const suffix = safari && Number(safari[1]) < 26 ? '' : '.asyncify';
  env.backends.onnx.wasm!.wasmPaths = {
    mjs: new URL(`runtime/ort/ort-wasm-simd-threaded${suffix}.mjs`, appBase).href,
    wasm: new URL(`runtime/ort/ort-wasm-simd-threaded${suffix}.wasm`, appBase).href,
  };
  env.backends.onnx.wasm!.numThreads = 1;
  env.backends.onnx.wasm!.proxy = false;
  const adapter = forceWasm
    ? null
    : await (navigator as any).gpu?.requestAdapter().catch(() => null);
  device = adapter ? 'webgpu' : 'wasm';
}
async function release() {
  if (model) {
    await model.dispose();
    model = undefined;
  }
  if (speech) {
    await speech.dispose();
    speech = undefined;
  }
}
async function embeddingModel() {
  if (speech) {
    await speech.dispose();
    speech = undefined;
  }
  if (!processor) {
    processor = await AutoProcessor.from_pretrained(GEMMA, { revision: REVISION });
    processor.image_processor.max_soft_tokens = 70;
  }
  if (!model) {
    const config = await AutoConfig.from_pretrained(GEMMA, { revision: REVISION });
    (config as any).audio_config = null;
    model = await AutoModel.from_pretrained(GEMMA, {
      revision: REVISION,
      config,
      dtype: 'q4',
      device,
    });
  }
  return model;
}
async function embed(text: string, query = false) {
  const current = await embeddingModel();
  const inputs = await processor(query ? formatQuery(text) : text);
  const output = await current(inputs);
  return normalize(Float32Array.from(output.sentence_embedding.data as Float32Array));
}
async function documents(text: string, title: string): Promise<DocumentEmbedding[]> {
  await embeddingModel();
  const ids = processor.tokenizer.encode(text, { add_special_tokens: false }) as number[];
  // The content window is 256 tokens. Prefix/title are metadata, not part of source excerpts.
  const chunks = chunkTokenIds(ids);
  const results = [];
  for (const chunk of chunks) {
    const source = processor.tokenizer.decode(chunk, { skip_special_tokens: true });
    results.push({ text: source, vector: await embed(`title: ${title} | text: ${source}`) });
  }
  return results;
}
async function image(blob: Blob) {
  const current = await embeddingModel();
  const raw = await RawImage.fromBlob(blob);
  const output = await current(await processor(null, raw));
  return normalize(Float32Array.from(output.sentence_embedding.data as Float32Array));
}
async function transcribe(samples: Float32Array): Promise<Transcript> {
  const range = audibleRange(samples);
  if (!range) return { text: '', chunks: [] };
  const offset = range.start / 16000;
  if (model) {
    await model.dispose();
    model = undefined;
  }
  if (!speech)
    speech = await pipeline('automatic-speech-recognition', SPEECH, {
      revision: SPEECH_REVISION,
      dtype: 'q8',
      device: 'wasm',
    });
  const result = await speech(samples.slice(range.start, range.end), {
    return_timestamps: true,
    chunk_length_s: 30,
    stride_length_s: 5,
  });
  const chunks = (result.chunks ?? [])
    .map((chunk: any) => ({
      ...chunk,
      timestamp: [
        (chunk.timestamp[0] ?? 0) + offset,
        chunk.timestamp[1] === null ? null : chunk.timestamp[1] + offset,
      ],
    }))
    .filter((chunk: any) =>
      hasAudibleSamples(
        samples,
        (chunk.timestamp[0] ?? 0) * 16000,
        (chunk.timestamp[1] ?? samples.length / 16000) * 16000,
      ),
    );
  return { text: chunks.map((chunk: any) => chunk.text.trim()).join(' '), chunks };
}
let serial = Promise.resolve();
self.onmessage = ({ data }: MessageEvent<ModelRequest>) => {
  serial = serial.then(async () => {
    try {
      await configure(data.base, data.forceWasm);
      let value: unknown;
      switch (data.method) {
        case 'documents':
          value = await documents(data.args.text, data.args.title);
          break;
        case 'query':
          value = await embed(data.args.text, true);
          break;
        case 'image':
          value = await image(data.args.blob);
          break;
        case 'transcribe':
          value = await transcribe(data.args.samples);
          break;
        case 'dispose':
          await release();
          value = undefined;
          break;
        default:
          throw new Error('Unknown model operation.');
      }
      self.postMessage({ id: data.id, value, device } satisfies ModelResponse);
    } catch (cause) {
      self.postMessage({
        id: data.id,
        error: cause instanceof Error ? cause.message : String(cause),
        retryWasm: device === 'webgpu',
      } satisfies ModelResponse);
    }
  });
};
