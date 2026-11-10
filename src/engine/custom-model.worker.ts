/// <reference lib="webworker" />
// S16: a student's own text embedding model, in its own worker so the frozen EmbeddingGemma
// worker is unchanged. Like that worker, it reads only pinned files that setup downloaded and
// verified into the offline asset cache, and never fetches from the network.
import { env, pipeline } from '@huggingface/transformers';
import { normalize } from './ranking';
import { chunkTokenIds } from './chunks';
import { ASSET_CACHE } from './assets';
import type {
  CustomWorkerModel,
  DocumentEmbedding,
  ModelRequest,
  ModelResponse,
} from '../app/model-protocol';

let extractor: any;
let loaded = '';
let current: CustomWorkerModel | undefined;
let configured = false;
function configure(appBase: string) {
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
      const prefix = current && `https://huggingface.co/${current.repo}/`;
      // Local paths omit resolve/revision in Transformers.js. Resolve only the pinned revision.
      const url =
        prefix && key.startsWith(prefix) && !key.includes('/resolve/')
          ? key.replace(prefix, `${prefix}resolve/${current!.revision}/`)
          : key;
      return (await (await caches.open(ASSET_CACHE)).match(url)) ?? undefined;
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
}

async function model(spec: CustomWorkerModel) {
  const key = `${spec.repo}@${spec.revision}:${spec.dtype}`;
  if (extractor && loaded !== key) {
    await extractor.dispose();
    extractor = undefined;
  }
  current = spec;
  if (!extractor) {
    extractor = await pipeline('feature-extraction', spec.repo, {
      revision: spec.revision,
      dtype: spec.dtype,
      device: 'wasm',
    });
    loaded = key;
  }
  return extractor;
}
async function embed(spec: CustomWorkerModel, text: string) {
  const output = await (await model(spec))(text, { pooling: spec.pooling, normalize: true });
  return normalize(Float32Array.from(output.data as Float32Array));
}
// A real title goes on its own line; a derived title ("none") adds nothing.
async function documents(
  spec: CustomWorkerModel,
  text: string,
  title: string,
): Promise<DocumentEmbedding[]> {
  const tokenizer = (await model(spec)).tokenizer;
  const ids = tokenizer.encode(text, { add_special_tokens: false }) as number[];
  const results = [];
  for (const chunk of chunkTokenIds(ids)) {
    const source = tokenizer.decode(chunk, { skip_special_tokens: true });
    const body = title === 'none' ? source : `${title}\n${source}`;
    results.push({ text: source, vector: await embed(spec, `${spec.documentPrefix}${body}`) });
  }
  return results;
}

let serial = Promise.resolve();
self.onmessage = ({ data }: MessageEvent<ModelRequest>) => {
  serial = serial.then(async () => {
    try {
      configure(data.base);
      const spec = data.customModel;
      let value: unknown;
      if (data.method === 'dispose') {
        await extractor?.dispose();
        extractor = undefined;
        loaded = '';
      } else if (!spec) throw new Error('No search model was chosen.');
      else if (data.method === 'documents')
        value = await documents(spec, data.args.text, data.args.title);
      else if (data.method === 'query')
        value = await embed(spec, `${spec.queryPrefix}${data.args.text.trim()}`);
      else throw new Error('Your own search model reads only text.');
      self.postMessage({ id: data.id, value, device: 'wasm' } satisfies ModelResponse);
    } catch (cause) {
      self.postMessage({
        id: data.id,
        error: cause instanceof Error ? cause.message : String(cause),
        retryWasm: false,
      } satisfies ModelResponse);
    }
  });
};
