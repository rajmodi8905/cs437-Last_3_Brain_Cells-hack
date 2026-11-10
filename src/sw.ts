/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches, getCacheKeyForURL } from 'workbox-precaching';
import { ASSET_CACHE } from './engine/assets';
import { SHARE_PATH, sharedAddHash, storeShare } from './app/shareTarget';
import { isOwnRuntimeRequest } from './app/runtimeRequest';
declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: any };
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});
// Android's share sheet posts shared files and text to the manifest's share_target. They are
// kept on this device for Add to pick up; nothing is forwarded to the network.
self.addEventListener('fetch', (event) => {
  const scope = self.registration.scope;
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || `${url.origin}${url.pathname}` !== `${scope}${SHARE_PATH}`)
    return;
  event.respondWith(
    (async () => {
      const id = await event.request
        .formData()
        .then((form) => storeShare(form, scope))
        .catch(() => 'unavailable');
      return Response.redirect(new URL(sharedAddHash(id), scope).href, 303);
    })(),
  );
});
// Explicit setup owns the asset cache. Ordinary use can only read cached assets.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  // App-shell runtime files, such as the PDF viewer worker, are served by the precache route.
  if (getCacheKeyForURL(event.request.url)) return;
  if (isOwnRuntimeRequest(event.request.url, self.location.origin))
    event.respondWith(
      (async () => {
        const lookup = new URL(event.request.url).pathname.endsWith(
          '/runtime/ocr/eng.traineddata.gz',
        )
          ? 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int/eng.traineddata.gz'
          : event.request.url;
        const cached = await (await caches.open(ASSET_CACHE)).match(lookup);
        return (
          cached ??
          (event.request.headers.get('X-Campus-Recall-Setup') === '1'
            ? fetch(event.request)
            : new Response('Offline asset missing. Repair setup in Settings.', { status: 503 }))
        );
      })(),
    );
});
