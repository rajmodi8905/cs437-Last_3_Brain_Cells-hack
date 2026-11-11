// W6 in the app: returning from a WhatsApp link (`?signin=whatsapp`) counts as an explicit
// Auto-sync activation, like returning from Google, and the address is cleaned. The browser
// flow end to end is in pilot/e2e/whatsapp-link.spec.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnyRecallServices } from '../../src/app/services';
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
  } as unknown as AnyRecallServices;
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

  it('activates Auto-sync only once the server confirms the WhatsApp session', async () => {
    const replaced = loadAt('https://recall.example/?signin=whatsapp#/settings');
    values.set('pilot-sign-out-pending', true);
    // The link's session, then (as if it ended meanwhile) none, so nothing is attached here.
    let sessions = 0;
    const network = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input).endsWith('/config')) return Response.json({ signIn: 'google' });
      if (sessions++ === 0)
        return Response.json({
          csrf: 'c',
          email: 'WhatsApp ••••3210',
          account: 'a'.repeat(32),
          vault: { epoch: 1 },
          kind: 'whatsapp',
        });
      return Response.json({ error: { code: 'UNAUTHENTICATED' } }, { status: 401 });
    });
    const controller = new AutoSyncController(services());
    await controller.start();
    expect(replaced).toEqual(['https://recall.example/#/settings']);
    expect(values.get('pilot-auto-sync-activated')).toBe(true);
    // The server replaced the earlier session, so the pending sign-out is done.
    expect(values.get('pilot-sign-out-pending')).toBe(false);
    expect(network.mock.calls.map(([input]) => String(input))[0]).toMatch(/\/session$/);
    expect(controller.getView().signInResult).toBeUndefined();
    // Including this device's library is still a separate choice.
    expect(controller.getView().included).toBe(false);
    controller.dispose();
  });

  it('the parameter alone, without a WhatsApp session, changes nothing (P01)', async () => {
    loadAt('https://recall.example/?signin=whatsapp#/settings');
    const network = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () =>
        Response.json({ error: { code: 'UNAUTHENTICATED' } }, { status: 401 }),
      );
    const controller = new AutoSyncController(services());
    await controller.start();
    expect(values.get('pilot-auto-sync-activated')).toBeUndefined();
    expect(network.mock.calls.map(([input]) => String(input))).toEqual([
      expect.stringMatching(/\/session$/),
    ]);
    expect(controller.getView().status).toBe('local-only');
    controller.dispose();
    // The next start contacts nothing.
    loadAt('https://recall.example/#/settings');
    await new AutoSyncController(services()).start();
    expect(network).toHaveBeenCalledTimes(1);
  });

  it('a Google session with the parameter neither activates nor forgets a pending sign-out', async () => {
    loadAt('https://recall.example/?signin=whatsapp#/settings');
    values.set('pilot-sign-out-pending', true);
    const network = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (!String(input).endsWith('/session'))
        return Response.json({ error: { code: 'NOT_FOUND' } }, { status: 404 });
      if (init?.method === 'DELETE') return new Response(null, { status: 204 });
      return Response.json({
        csrf: 'c',
        email: 'student@iitgn.ac.in',
        account: 'b'.repeat(32),
        vault: { epoch: 1 },
      });
    });
    const controller = new AutoSyncController(services());
    await controller.start();
    expect(values.get('pilot-auto-sync-activated')).toBeUndefined();
    // The earlier sign-out is carried out on the server, as on any start, not just dropped.
    expect(network.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true);
    expect(values.get('pilot-sign-out-pending')).toBe(false);
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
