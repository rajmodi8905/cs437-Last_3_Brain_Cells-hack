// The service worker serves model, OCR and PDF runtime files from the asset cache. A captured
// page on another site whose path contains /runtime/ must not get its "Offline asset missing"
// answer (issue #44).
import { expect, it } from 'vitest';
import { isOwnRuntimeRequest } from '../../src/app/runtimeRequest';

const origin = 'https://anyrecall.example';

it("serves only this app's own runtime files from the asset cache", () => {
  expect(isOwnRuntimeRequest(`${origin}/runtime/ort/ort-wasm-simd-threaded.wasm`, origin)).toBe(
    true,
  );
  expect(isOwnRuntimeRequest(`${origin}/campus/runtime/ocr/eng.traineddata.gz`, origin)).toBe(true);
  expect(isOwnRuntimeRequest('https://example.org/runtime/notes.html', origin)).toBe(false);
  expect(isOwnRuntimeRequest(`${origin}/assets/index.js`, origin)).toBe(false);
});
