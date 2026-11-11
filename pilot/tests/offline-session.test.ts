import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnyRecallServices } from '../../src/app/services';
import { AutoSyncController } from '../client/autosync';
import { IndexedDbSyncStateStore } from '../client/idb';
import { emptySnapshot } from '../client/types';

const values = new Map<string, unknown>();
function services() {
  return {
    engine: { indexItem: async () => undefined },
    library: {
      listItems: async () => [],
      getItem: async () => undefined,
      getOriginal: async () => undefined,
      renameItem: async () => undefined,
      deleteItem: async () => undefined,
    },
    subscribeLibrary: () => () => undefined,
    preferences: {
      get: async <T>(key: string) => values.get(key) as T | undefined,
      set: async (key: string, value: unknown) => {
        values.set(key, value);
      },
    },
  } as unknown as AnyRecallServices;
}

/** A pilot server with one session; `online` switches the whole network off and on. */
function fakeServer(account: string) {
  const server = { online: true, sessionLive: true, calls: [] as string[] };
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    server.calls.push(`${method} ${url.replace(/^.*\/api\/v1/, '')}`);
    if (!server.online) throw new TypeError('Failed to fetch');
    if (url.endsWith('/config')) return Response.json({ signIn: 'dev' });
    if (url.endsWith('/session') && method === 'DELETE') {
      server.sessionLive = false;
      return new Response(null, { status: 204 });
    }
    if (url.endsWith('/session') && server.sessionLive)
      return Response.json({
        csrf: 'csrf',
        email: 'student@iitgn.ac.in',
        account,
        vault: { epoch: 1 },
      });
    return Response.json({ error: { code: 'UNAUTHENTICATED' } }, { status: 401 });
  });
  return server;
}
const unique = () => `acct${Math.random().toString(16).slice(2, 14)}`;

afterEach(() => {
  vi.restoreAllMocks();
  values.clear();
});

describe('P12 sign-out ends cloud access on this device', () => {
  it('does not report a clean sign-out when the server session could not be ended', async () => {
    const server = fakeServer(unique());
    const controller = new AutoSyncController(services());
    await controller.activate();
    expect(controller.getView().status).toBe('signed-in');

    server.online = false;
    await controller.signOut();
    const view = controller.getView();
    expect(view.signOutPending).toBe(true);
    expect(view.error).toMatch(/could not reach/i);
    // Nothing from the account stays on screen meanwhile.
    expect(view.email).toBeUndefined();
    expect(server.sessionLive).toBe(true);
    controller.dispose();

    // Back online, turning sync on again ends the old session instead of restoring it.
    server.online = true;
    const later = new AutoSyncController(services());
    await later.activate();
    expect(server.sessionLive).toBe(false);
    expect(later.getView()).toMatchObject({ status: 'signed-out', signOutPending: false });
    expect(later.getView().email).toBeUndefined();
    later.dispose();
  });

  it('finishes a pending sign-out on the next start once the network is back', async () => {
    const server = fakeServer(unique());
    const controller = new AutoSyncController(services());
    await controller.activate();
    server.online = false;
    await controller.signOut();
    controller.dispose();

    server.online = true;
    const later = new AutoSyncController(services());
    await later.start();
    expect(server.sessionLive).toBe(false);
    expect(later.getView()).toMatchObject({ status: 'local-only', signOutPending: false });
    later.dispose();
  });

  it('reports a clean sign-out when the server ends the session', async () => {
    const server = fakeServer(unique());
    const controller = new AutoSyncController(services());
    await controller.activate();
    await controller.signOut();
    expect(server.sessionLive).toBe(false);
    expect(controller.getView()).toMatchObject({ status: 'local-only', signOutPending: false });
    expect(controller.getView().error).toBeUndefined();
    controller.dispose();
  });
});

describe('P07 kept-offline originals after restarting without a network', () => {
  it('lists and opens an item kept offline when the app starts offline', async () => {
    const account = unique();
    const server = fakeServer(account);
    const bytes = new TextEncoder().encode('Mess menu for the week');
    const controller = new AutoSyncController(services());
    await controller.activate();
    controller.dispose();
    // What an earlier online run left in this account's store: the catalogue and a kept copy.
    const state = new IndexedDbSyncStateStore(account);
    await state.save({
      ...emptySnapshot(),
      included: true,
      epoch: 1,
      catalogue: {
        g1: {
          globalId: 'g1',
          revision: 1,
          deleted: false,
          kind: 'note',
          title: 'Mess menu',
          mimeType: 'text/plain;charset=utf-8',
          byteLength: bytes.length,
          contentSha256: 'abc',
        },
      },
    });
    await state.offline.put('g1', {
      bytes,
      contentSha256: 'abc',
      mimeType: 'text/plain;charset=utf-8',
    });
    state.close();

    server.online = false;
    const restarted = new AutoSyncController(services());
    await restarted.start();
    const view = restarted.getView();
    expect(view.status).toBe('offline');
    expect(view.email).toBe('student@iitgn.ac.in');
    expect(view.offlineIds).toEqual(['g1']);
    expect(view.cloudOnly.map((item) => item.title)).toEqual(['Mess menu']);
    const { blob, name } = await restarted.download('g1');
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
    expect(name).toBe('Mess menu.txt');

    // When the network returns, trying again signs back in normally.
    server.online = true;
    await restarted.activate();
    expect(restarted.getView().status).toBe('signed-in');
    restarted.dispose();
  });

  it('does not open an account that was signed out, even offline', async () => {
    const server = fakeServer(unique());
    const controller = new AutoSyncController(services());
    await controller.activate();
    await controller.signOut();
    controller.dispose();
    server.online = false;
    const restarted = new AutoSyncController(services());
    await restarted.activate();
    expect(restarted.getView().status).toBe('unavailable');
    expect(restarted.getView().email).toBeUndefined();
    restarted.dispose();
  });

  it('does not open an account whose session expired on the server, even offline', async () => {
    const server = fakeServer(unique());
    const controller = new AutoSyncController(services());
    await controller.activate();
    controller.dispose();

    // The session lapses without a sign-out; the next online start learns that.
    server.sessionLive = false;
    const online = new AutoSyncController(services());
    await online.start();
    expect(online.getView().status).toBe('signed-out');
    online.dispose();

    server.online = false;
    const offline = new AutoSyncController(services());
    await offline.start();
    expect(offline.getView().status).toBe('unavailable');
    expect(offline.getView().email).toBeUndefined();
    offline.dispose();
  });

  it('reports a server that answers with an error as unavailable, not offline', async () => {
    fakeServer(unique());
    const controller = new AutoSyncController(services());
    await controller.activate();
    controller.dispose();

    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response('Service Unavailable', { status: 503 }),
    );
    const restarted = new AutoSyncController(services());
    await restarted.start();
    expect(restarted.getView().status).toBe('unavailable');
    expect(restarted.getView().email).toBeUndefined();
    restarted.dispose();
  });
});

describe('P12 sign-out that removes local copies without a network', () => {
  it('says the copies were removed but the device may still be signed in', async () => {
    const server = fakeServer(unique());
    const controller = new AutoSyncController(services());
    await controller.activate();
    server.online = false;
    await controller.signOut(true);
    const view = controller.getView();
    expect(view.signOutPending).toBe(true);
    expect(view.error).toMatch(/copies were removed/i);
    expect(view.error).toMatch(/may still be signed in/i);
    controller.dispose();
  });
});
