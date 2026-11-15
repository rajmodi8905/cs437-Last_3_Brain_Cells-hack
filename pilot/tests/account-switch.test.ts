/// <reference types="node" />
// Every tab shares one session cookie. When another tab signs in as a different account, a tab
// still bound to the first account must not receive the second account's library (#65).
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnyRecallServices } from '../../src/app/services';
import { createApiClient, type ApiClient } from '../client/api';
import { AutoSyncController } from '../client/autosync';
import { IndexedDbSyncStateStore } from '../client/idb';
import { MemoryLocalLibrary, MemoryOfflineStore, MemorySyncStateStore } from '../client/memory';
import { SyncEngine } from '../client/sync';
import { devSigner, idToken, origin, startPilotServer } from './helpers';

const EMAIL_A = 'student.a@iitgn.ac.in';
const EMAIL_B = 'student.b@iitgn.ac.in';
const note = new TextEncoder().encode('B’s room allotment for next semester.');
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
  vi.restoreAllMocks();
});

/** One browser's cookie jar, shared by every tab of it. */
function browser(realFetch: typeof fetch = globalThis.fetch) {
  let cookie = '';
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set('origin', origin);
    if (cookie) headers.set('cookie', cookie);
    const res = await realFetch(String(input), { ...init, headers });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return res;
  };
  return fetchImpl;
}

/** The app's services as the auto-sync controller uses them, with an empty device library. */
function appServices() {
  const values = new Map<string, unknown>();
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

/** Tab 2 signs out and signs in as B, who then saves a note through B's own engine. */
async function switchToB(tab2: ApiClient) {
  await tab2.restoreSession();
  await tab2.signOut();
  const b = await tab2.signIn(idToken({ sub: 'subject-b', email: EMAIL_B }));
  const library = new MemoryLocalLibrary();
  library.add(
    { kind: 'note', title: 'Room allotment', mimeType: 'text/plain;charset=utf-8' },
    note,
  );
  const engine = new SyncEngine({
    api: tab2.forAccount(b.account),
    library,
    state: new MemorySyncStateStore(),
    libraryId: 'b-library',
  });
  await engine.include(b.vault.epoch);
  expect(await engine.runOnce()).toMatchObject({ uploaded: 1, failed: 0 });
  const [item] = await engine.catalogue();
  return { b, item };
}

describe('a second account signed in in another tab', () => {
  it('reaches nothing of an engine still bound to the first account: not its catalogue, not its offline copies', async () => {
    const pilot = await startPilotServer();
    cleanups.push(pilot.close);
    const jar = browser();
    const tab1 = createApiClient({ base: pilot.base, fetch: jar });
    const tab2 = createApiClient({ base: pilot.base, fetch: jar });
    const a = await tab1.signIn(idToken());
    const state = new MemorySyncStateStore();
    const offline = new MemoryOfflineStore();
    const engineA = new SyncEngine({
      api: tab1.forAccount(a.account),
      library: new MemoryLocalLibrary(),
      state,
      offline,
      libraryId: 'a-library',
    });
    await engineA.include(a.vault.epoch);
    await engineA.runOnce();

    const { b, item } = await switchToB(tab2);
    expect(b.account).not.toBe(a.account);

    // A's engine keeps running, as tab 1's sync loop does.
    await expect(engineA.runOnce()).rejects.toMatchObject({ code: 'ACCOUNT_CHANGED' });
    expect(await engineA.catalogue()).toEqual([]);
    expect((await state.load()).catalogue).toEqual({});
    await expect(engineA.keepOffline(item.globalId)).rejects.toThrow();
    // Even asked for directly, B's original is refused to a client bound to A.
    await expect(tab1.forAccount(a.account).original(item.globalId)).rejects.toMatchObject({
      code: 'ACCOUNT_CHANGED',
    });
    expect(await offline.keys()).toEqual([]);
  });

  it('the server refuses a request whose stated account is not the session’s, before anything else', async () => {
    const pilot = await startPilotServer();
    cleanups.push(pilot.close);
    const jar = browser();
    const tab1 = createApiClient({ base: pilot.base, fetch: jar });
    const a = await tab1.signIn(idToken());
    await switchToB(createApiClient({ base: pilot.base, fetch: jar }));
    const res = await jar(`${pilot.base}/changes?epoch=1&after=0`, {
      headers: { 'x-recall-account': a.account },
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('ACCOUNT_CHANGED');
    // Writes are refused the same way, rather than with a CSRF error.
    await expect(
      tab1
        .forAccount(a.account)
        .remove('anything', { opId: crypto.randomUUID(), epoch: 1, expectedRevision: 1 }),
    ).rejects.toMatchObject({ code: 'ACCOUNT_CHANGED' });
    // Without the header (or with B's own account) the session works as before.
    expect((await jar(`${pilot.base}/changes?epoch=1&after=0`)).status).toBe(200);
  });

  it('the app in tab 1 keeps B’s items out of A’s local state and follows the switch to B', async () => {
    const pilot = await startPilotServer(5_000_000, { devSigner });
    cleanups.push(pilot.close);
    const jar = browser();
    // The controller uses the global fetch, as in the browser.
    vi.spyOn(globalThis, 'fetch').mockImplementation(jar);
    const tab1 = new AutoSyncController(appServices(), pilot.base);
    cleanups.push(() => tab1.dispose());
    await tab1.activate();
    await tab1.signInDev(EMAIL_A);
    expect(tab1.getView()).toMatchObject({ status: 'signed-in', email: EMAIL_A });
    expect(await tab1.include()).toBe(true);
    const tab2 = createApiClient({ base: pilot.base, fetch: jar });
    const accountA = (await tab2.restoreSession())!.account;

    const { item } = await switchToB(tab2);
    await tab1.syncNow();

    const stateA = new IndexedDbSyncStateStore(accountA);
    cleanups.push(() => stateA.close());
    const savedA = await stateA.load();
    expect(Object.keys(savedA.catalogue)).not.toContain(item.globalId);
    expect(await stateA.offline.keys()).toEqual([]);
    // Tab 1 now shows the account the browser is signed in to, like tab 2.
    expect(tab1.getView()).toMatchObject({ status: 'signed-in', email: EMAIL_B });
    expect(tab1.getView().error).toBeUndefined();
  });

  it('signing out in tab 1 after the switch is a finished sign-out for A and leaves B signed in', async () => {
    const pilot = await startPilotServer(5_000_000, { devSigner });
    cleanups.push(pilot.close);
    const jar = browser();
    vi.spyOn(globalThis, 'fetch').mockImplementation(jar);
    const tab1 = new AutoSyncController(appServices(), pilot.base);
    cleanups.push(() => tab1.dispose());
    await tab1.activate();
    await tab1.signInDev(EMAIL_A);
    const tab2 = createApiClient({ base: pilot.base, fetch: jar });
    const { b } = await switchToB(tab2);

    await tab1.signOut();
    // A's session is gone from this browser; the one there now is B's, not tab 1's to end.
    expect(tab1.getView()).toMatchObject({ status: 'local-only', signOutPending: false });
    expect(tab1.getView().email).toBeUndefined();
    expect((await tab2.restoreSession())?.account).toBe(b.account);
  });
});
