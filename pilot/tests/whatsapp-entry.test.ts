// W6 in the app: returning from a WhatsApp link (`?signin=whatsapp`) counts as an explicit
// Auto-sync activation, like returning from Google, and the address is cleaned. The browser
// flow end to end is in pilot/e2e/whatsapp-link.spec.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CampusRecallServices } from '../../src/app/services';
import { AutoSyncController } from '../client/autosync';
import { readEntry } from '../client/entry';

const values = new Map<string, unknown>();
function services() {
  return {
    engine: {},
    preferences: {
      get: async <T>(key: string) => values.get(key) as T | undefined,
      set: async (key: string, value: unknown) => {
        values.set(key, value);
      },
    },
  } as unknown as CampusRecallServices;
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  values.clear();
});

/** A page loaded at `href`, with history that records replacements. */
function loadAt(href: string) {
  const replaced: string[] = [];
  vi.stubGlobal('location', { href });
  vi.stubGlobal('history', {
    state: null,
    replaceState: (_state: unknown, _title: string, url: string) => replaced.push(url),
  });
  return replaced;
}

describe('W6 WhatsApp link entry', () => {
  it('reads signin=whatsapp as a sign-in, not a failure, and removes it from the address', () => {
    expect(readEntry('https://recall.example/?signin=whatsapp#/settings')).toEqual({
      signedIn: 'whatsapp',
      cleanUrl: 'https://recall.example/#/settings',
      strippedCredentials: false,
    });
    // A token in a query string is still never kept.
    expect(readEntry('https://recall.example/?signin=whatsapp&token=abc#/settings')).toEqual({
      signedIn: 'whatsapp',
      cleanUrl: 'https://recall.example/#/settings',
      strippedCredentials: true,
    });
  });

  it('activates Auto-sync and asks the server for the session the link opened', async () => {
    const replaced = loadAt('https://recall.example/?signin=whatsapp#/settings');
    const network = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) =>
        String(input).endsWith('/config')
          ? Response.json({ signIn: 'google' })
          : Response.json({ error: { code: 'UNAUTHENTICATED' } }, { status: 401 }),
      );
    const controller = new AutoSyncController(services());
    await controller.start();
    expect(replaced).toEqual(['https://recall.example/#/settings']);
    expect(values.get('pilot-auto-sync-activated')).toBe(true);
    expect(network.mock.calls.map(([input]) => String(input))).toEqual([
      expect.stringMatching(/\/config$/),
      expect.stringMatching(/\/session$/),
    ]);
    expect(controller.getView().signInResult).toBeUndefined();
    // Including this device's library is still a separate choice.
    expect(controller.getView().included).toBe(false);
    controller.dispose();
  });

  it('without the link parameter nothing is contacted (P01)', async () => {
    loadAt('https://recall.example/#/settings');
    const network = vi.spyOn(globalThis, 'fetch');
    const controller = new AutoSyncController(services());
    await controller.start();
    expect(network).not.toHaveBeenCalled();
    expect(controller.getView().status).toBe('local-only');
    controller.dispose();
  });
});
