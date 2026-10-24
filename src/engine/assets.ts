import { AppOperationError, type ProgressListener } from '../shared';
export const ASSET_CACHE = 'campus-recall-assets-v1';
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
export async function offlineStatus(manifest: AssetManifest): Promise<boolean> {
  const cache = await caches.open(ASSET_CACHE);
  const marker = await cache.match(localUrl(`./offline-${manifest.version}`));
  if (!marker) return false;
  for (const asset of manifest.assets) if (!(await cache.match(assetUrl(asset)))) return false;
  return true;
}
export async function setupAssets(
  manifest: AssetManifest,
  onProgress: ProgressListener,
  signal?: AbortSignal,
): Promise<void> {
  const cache = await caches.open(ASSET_CACHE);
  let completed = 0;
  const total = manifest.assets.reduce((n, a) => n + a.bytes, 0);
  const emit = (loaded = 0, message = 'Preparing offline search') =>
    onProgress({ stage: 'setup', loadedBytes: completed + loaded, totalBytes: total, message });
  for (const asset of manifest.assets) {
    const url = assetUrl(asset);
    const cached = await cache.match(url);
    // Verify existing entries as well; a previous interrupted setup is resumable.
    let bytes = cached ? await cached.arrayBuffer() : undefined;
    if (!bytes) {
      emit(0, asset.name);
      const response = await fetch(url, {
        credentials: 'omit',
        signal,
        headers: asset.url.startsWith('./') ? { 'X-Campus-Recall-Setup': '1' } : undefined,
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
        emit(loaded, asset.name);
      }
      bytes = new ArrayBuffer(loaded);
      const output = new Uint8Array(bytes);
      let offset = 0;
      for (const part of parts) {
        output.set(part, offset);
        offset += part.length;
      }
    }
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (x) =>
      x.toString(16).padStart(2, '0'),
    ).join('');
    if (bytes.byteLength !== asset.bytes || digest !== asset.sha256) {
      await cache.delete(url);
      throw new Error(`Integrity check failed for ${asset.name}. Please retry setup.`);
    }
    if (!cached)
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
  await cache.put(localUrl(`./offline-${manifest.version}`), new Response('verified'));
}
