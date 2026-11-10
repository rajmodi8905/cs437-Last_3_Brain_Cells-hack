// Entry of the engine host page (pilot/engine-host/index.html). Built with the app but never
// linked from it; the pilot server opens it in headless Chromium and calls `window.engineHost`.
import type { ItemKind } from '../../src/shared';
import { INDEX_VERSION } from '../../src/engine';
import { openEngineHost, type HostIndexInput, type HostSearchItem } from './host';

/** `HostIndexInput` as it crosses from Playwright: the bytes as base64. */
export type WireIndexInput = Omit<HostIndexInput, 'bytes'> & { bytesBase64: string };

const fromBase64 = (value: string) => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const opened = openEngineHost();
// Reported through `ready`; keeps an early failure from being an unhandled rejection.
opened.catch(() => undefined);

const api = {
  /** Resolves once models are set up, with the index version every bundle will carry. */
  ready: async () => {
    await opened;
    return { indexVersion: INDEX_VERSION };
  },
  index: async ({ bytesBase64, ...input }: WireIndexInput) =>
    (await opened).index({ ...input, bytes: fromBase64(bytesBase64) }),
  search: async (query: string, items: HostSearchItem[], kind?: ItemKind) =>
    (await opened).search(query, items, kind),
};

declare global {
  interface Window {
    engineHost: typeof api;
  }
}
window.engineHost = api;
