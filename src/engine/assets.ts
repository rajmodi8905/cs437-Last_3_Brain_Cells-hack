import { AppOperationError, type ProgressListener } from '../shared';
import { GEMMA, type SearchModel } from '../shared/searchModels';
export const ASSET_CACHE = 'anyrecall-assets-v1';
export interface Asset {
  url: string;
  bytes: number;
  sha256: string;
  group: string;
  name: string;
}
export interface AssetManifest {
  version: string;
  assets: Asset[];
}
/** EmbeddingGemma's own files in the manifest; a student's model replaces them (S16). */
const GEMMA_GROUP = 'embeddings';
/** The files one search model needs: the shared files plus that model's own files. */
export function assetsFor(manifest: AssetManifest, model: SearchModel = GEMMA): Asset[] {
  if (!model.custom) return manifest.assets;
  return [
    ...manifest.assets.filter((asset) => asset.group !== GEMMA_GROUP),
    ...model.custom.files.map((file) => ({ ...file, group: 'custom-model' })),
  ];
}
// EmbeddingGemma's marker is unchanged, so devices that are already set up stay ready.
const readyMarker = (manifest: AssetManifest, model: SearchModel) =>
  localUrl(
    model.custom
      ? `./offline-${manifest.version}-${model.indexVersion}`
      : `./offline-${manifest.version}`,
  );
export const localUrl = (path: string) =>
  new URL(path, new URL(import.meta.env.BASE_URL, globalThis.location.href)).href;
export async function getManifest(): Promise<AssetManifest> {
  const response = await fetch(localUrl('./asset-manifest.json'), {
    cache: 'no-cache',
    credentials: 'omit',
  });
  if (!response.ok)
    throw new Error('Offline asset manifest is unavailable. Rebuild the application.');
  return response.json();
}
export function assetUrl(asset: Asset): string {
  return new URL(asset.url, new URL(import.meta.env.BASE_URL, globalThis.location.href)).href;
}
export async function offlineStatus(
  manifest: AssetManifest,
  model: SearchModel = GEMMA,
): Promise<boolean> {
  const cache = await caches.open(ASSET_CACHE);
  const marker = await cache.match(readyMarker(manifest, model));
  if (!marker) return false;
  // Every start checks presence and exact size. Setup and Verify offline assets check SHA-256.
  for (const asset of assetsFor(manifest, model)) {
    const cached = await cache.match(assetUrl(asset));
    if (!cached || (await cached.blob()).size !== asset.bytes) return false;
  }
  return true;
}
async function verified(bytes: ArrayBuffer, asset: Asset): Promise<boolean> {
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (x) =>
    x.toString(16).padStart(2, '0'),
  ).join('');
  return bytes.byteLength === asset.bytes && digest === asset.sha256;
}
async function download(
  url: string,
  asset: Asset,
  onBytes: (loaded: number) => void,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const response = await fetch(url, {
    credentials: 'omit',
    signal,
    headers: asset.url.startsWith('./') ? { 'X-AnyRecall-Setup': '1' } : undefined,
  });
  if (!response.ok || !response.body)
    throw new AppOperationError({
      code: 'SETUP_FAILED',
      message: `Could not download ${asset.name}. Retry when connected.`,
      retryable: true,
    });
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    parts.push(value);
    loaded += value.byteLength;
    onBytes(loaded);
  }
  const bytes = new ArrayBuffer(loaded);
  const output = new Uint8Array(bytes);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return bytes;
}
export async function setupAssets(
  manifest: AssetManifest,
  onProgress: ProgressListener,
  signal?: AbortSignal,
  model: SearchModel = GEMMA,
): Promise<void> {
  const cache = await caches.open(ASSET_CACHE);
  const assets = assetsFor(manifest, model);
  let completed = 0;
  const total = assets.reduce((n, a) => n + a.bytes, 0);
  const emit = (loaded = 0, message = 'Preparing offline search') =>
    onProgress({ stage: 'setup', loadedBytes: completed + loaded, totalBytes: total, message });
  for (const asset of assets) {
    const url = assetUrl(asset);
    const cached = await cache.match(url);
    // Verify existing entries as well; a previous interrupted setup is resumable.
    if (cached && (await verified(await cached.arrayBuffer(), asset))) {
      completed += asset.bytes;
      emit(0, asset.name);
      continue;
    }
    // A damaged cached entry is downloaded again in this run, so one Verify repairs it.
    if (cached) await cache.delete(url);
    emit(0, asset.name);
    const bytes = await download(url, asset, (loaded) => emit(loaded, asset.name), signal);
    if (!(await verified(bytes, asset)))
      throw new Error(`Integrity check failed for ${asset.name}. Please retry setup.`);
    await cache.put(
      url,
      new Response(bytes, {
        headers: {
          'Content-Type':
            url.endsWith('.mjs') || url.endsWith('.js')
              ? 'text/javascript'
              : url.endsWith('.wasm')
                ? 'application/wasm'
                : 'application/octet-stream',
        },
      }),
    );
    completed += asset.bytes;
    emit(0, asset.name);
  }
  await cache.put(readyMarker(manifest, model), new Response('verified'));
}
