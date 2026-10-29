import { expect, it, vi, afterEach } from 'vitest';
import { offlineStatus, setupAssets, type AssetManifest } from '../../src/engine/assets';
const content = new TextEncoder().encode('model fixture');
async function fixture() {
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', content)), (x) =>
    x.toString(16).padStart(2, '0'),
  ).join('');
  return {
    version: 'test-v1',
    assets: [
      {
        url: 'https://example.test/model',
        bytes: content.length,
        sha256,
        name: 'model',
        group: 'test',
      },
    ],
  } as AssetManifest;
}
function cache() {
  const entries = new Map<string, Response>();
  const key = (input: any) => (typeof input === 'string' ? input : (input.href ?? input.url));
  const value = {
    match: async (input: any) => entries.get(key(input))?.clone(),
    put: async (input: any, response: Response) => {
      entries.set(key(input), response.clone());
    },
    delete: async (input: any) => entries.delete(key(input)),
  };
  vi.stubGlobal('location', { href: 'https://app.test/' });
  vi.stubGlobal('caches', { open: async () => value });
  return value;
}
afterEach(() => vi.unstubAllGlobals());
it('reports actual bytes, verifies integrity and only then marks offline ready', async () => {
  cache();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(content)),
  );
  const manifest = await fixture();
  expect(await offlineStatus(manifest)).toBe(false);
  const events: any[] = [];
  await setupAssets(manifest, (e) => events.push(e));
  expect(await offlineStatus(manifest)).toBe(true);
  expect(events.at(-1)).toMatchObject({ loadedBytes: content.length, totalBytes: content.length });
});
it('rejects corrupt bytes, never marks ready, and reuses complete verified assets', async () => {
  const store = cache();
  const manifest = await fixture();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('corrupt')),
  );
  await expect(setupAssets(manifest, () => {})).rejects.toThrow(/Integrity/);
  expect(await offlineStatus(manifest)).toBe(false);
  await store.put(manifest.assets[0].url, new Response(content));
  const fetch = vi.fn(() => {
    throw Error('Must reuse cache');
  });
  vi.stubGlobal('fetch', fetch);
  await setupAssets(manifest, () => {});
  expect(fetch).not.toHaveBeenCalled();
  expect(await offlineStatus(manifest)).toBe(true);
  await store.delete(manifest.assets[0].url);
  expect(await offlineStatus(manifest)).toBe(false);
});
it('withdraws readiness when a cached asset was replaced after setup (#11)', async () => {
  const store = cache();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(content)),
  );
  const manifest = await fixture();
  await setupAssets(manifest, () => {});
  expect(await offlineStatus(manifest)).toBe(true);
  await store.put(manifest.assets[0].url, new Response('corrupted by QA'));
  expect(await offlineStatus(manifest)).toBe(false);
});
it('repairs a damaged cached asset in one verification run (#11)', async () => {
  const store = cache();
  const manifest = await fixture();
  await store.put(manifest.assets[0].url, new Response('corrupted by QA'));
  const fetch = vi.fn(async () => new Response(content));
  vi.stubGlobal('fetch', fetch);
  await setupAssets(manifest, () => {});
  expect(fetch).toHaveBeenCalledOnce();
  expect(await offlineStatus(manifest)).toBe(true);
  expect(new Uint8Array(await (await store.match(manifest.assets[0].url))!.arrayBuffer())).toEqual(
    content,
  );
});
