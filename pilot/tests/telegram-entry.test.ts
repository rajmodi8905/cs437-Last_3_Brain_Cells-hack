// T6 in the app: returning from a Telegram link (`?signin=telegram`) counts as an explicit
// Auto-sync activation only with a Telegram session, exactly as `signin=whatsapp` needs a WhatsApp
// one. The browser flow end to end is in pilot/e2e/telegram-link.spec.ts.
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
function loadAt(href: string) {
  const replaced: string[] = [];
  vi.stubGlobal('location', { href });
  vi.stubGlobal('history', {
    state: null,
    replaceState: (_state: unknown, _title: string, url: string) => replaced.push(url),
  });
  return replaced;
}
const session = (kind?: string) => ({
  csrf: 'c',
  email: kind === 'telegram' ? 'Telegram @student_a' : 'WhatsApp ••••3210',
  account: 'a'.repeat(32),
  vault: { epoch: 1 },
  ...(kind ? { kind } : {}),
});

describe('T6 Telegram link entry', () => {
  it('reads signin=telegram as a sign-in and removes it from the address; other values stay ignored', () => {
    expect(readEntry('https://recall.example/?signin=telegram#/settings')).toEqual({
      signedIn: 'telegram',
      cleanUrl: 'https://recall.example/#/settings',
      strippedCredentials: false,
    });
    expect(readEntry('https://recall.example/?signin=signal#/settings')).toEqual({
      cleanUrl: 'https://recall.example/#/settings',
      strippedCredentials: false,
    });
  });

  it('activates Auto-sync once the server confirms a Telegram session', async () => {
    const replaced = loadAt('https://recall.example/?signin=telegram#/settings');
    values.set('pilot-sign-out-pending', true);
    let calls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input).endsWith('/config')) return Response.json({ signIn: 'google' });
      if (calls++ === 0) return Response.json(session('telegram'));
      return Response.json({ error: { code: 'UNAUTHENTICATED' } }, { status: 401 });
    });
    const controller = new AutoSyncController(services());
    await controller.start();
    expect(replaced).toEqual(['https://recall.example/#/settings']);
    expect(values.get('pilot-auto-sync-activated')).toBe(true);
    expect(values.get('pilot-sign-out-pending')).toBe(false);
    expect(controller.getView().included).toBe(false);
    controller.dispose();
  });

  it.each([
    ['a WhatsApp session', 'whatsapp'],
    ['a Google session', undefined],
  ])('does not activate signin=telegram with %s', async (_name, kind) => {
    loadAt('https://recall.example/?signin=telegram#/settings');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json(session(kind)));
    const controller = new AutoSyncController(services());
    await controller.start();
    expect(values.get('pilot-auto-sync-activated')).toBeUndefined();
    controller.dispose();
  });

  it('does not activate signin=whatsapp with a Telegram session', async () => {
    loadAt('https://recall.example/?signin=whatsapp#/settings');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      Response.json(session('telegram')),
    );
    const controller = new AutoSyncController(services());
    await controller.start();
    expect(values.get('pilot-auto-sync-activated')).toBeUndefined();
    controller.dispose();
  });
});
