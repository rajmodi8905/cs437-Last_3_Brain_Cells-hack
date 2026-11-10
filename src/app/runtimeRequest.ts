// The service worker answers runtime asset requests (model, OCR and PDF files) from the asset
// cache. Only this app's own runtime folder counts: a captured page on another site whose path
// happens to contain /runtime/ must reach the network as usual.
export const isOwnRuntimeRequest = (requestUrl: string, ownOrigin: string): boolean => {
  const url = new URL(requestUrl);
  return url.origin === ownOrigin && url.pathname.includes('/runtime/');
};
