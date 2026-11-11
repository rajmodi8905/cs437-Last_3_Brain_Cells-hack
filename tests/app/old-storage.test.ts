// The app's storage names changed with its name. At start it deletes, once, what it kept under
// the old names (the library database, the search-model cache, a waiting share and Auto-sync's
// per-account databases) and nothing else. Runs on fake-indexeddb with an in-memory stand-in
// for Cache Storage and localStorage.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  OLD_CACHES,
  OLD_DATABASES,
  OLD_STORAGE_REMOVED,
  OLD_SYNC_DATABASE,
  removeOldStorage,
} from '../../src/app/oldStorage';
import { SHARE_CACHE } from '../../src/app/shareTarget';
import { ASSET_CACHE } from '../../src/engine/assets';
import { AnyRecallDatabase } from '../../src/storage';

const OLD_SYNC = 'campus-recall-pilot-sync-Account0123456789';
const NEW_SYNC = 'anyrecall-pilot-sync-Account0123456789';
const OTHERS = ['keyval-store', 'campus-recall-notes', 'campus-recall-pilot-sync-', NEW_SYNC];

const createDatabase = (name: string) =>
  new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onupgradeneeded = () => request.result.createObjectStore('rows');
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
const databaseNames = async () => (await indexedDB.databases()).map((entry) => entry.name).sort();

let cacheNames: Set<string>;
let deletedCaches: string[];
let local: Map<string, string>;

beforeEach(async () => {
  for (const { name } of await indexedDB.databases())
    await new Promise<void>((resolve) => {
      indexedDB.deleteDatabase(name!).onsuccess = () => resolve();
    });
  cacheNames = new Set([...OLD_CACHES, ASSET_CACHE, SHARE_CACHE, 'workbox-precache-v2-app']);
  deletedCaches = [];
  local = new Map();
  vi.stubGlobal('caches', {
    delete: async (name: string) => {
      deletedCaches.push(name);
      return cacheNames.delete(name);
    },
    keys: async () => [...cacheNames],
  });
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => local.get(key) ?? null,
    setItem: (key: string, value: string) => void local.set(key, value),
  });
});
afterEach(() => vi.unstubAllGlobals());

it('names exactly the old storage, and none of the names the app uses now', () => {
  expect(OLD_CACHES).toEqual(['campus-recall-assets-v1', 'campus-recall-share']);
  expect(OLD_DATABASES).toEqual(['campus-recall']);
  expect(OLD_SYNC_DATABASE.test(OLD_SYNC)).toBe(true);
  for (const name of [...OTHERS, 'campus-recall', `x${OLD_SYNC}`, `${OLD_SYNC}/x`])
    expect(OLD_SYNC_DATABASE.test(name)).toBe(false);
  const current = new AnyRecallDatabase();
  expect(current.name).toBe('anyrecall');
  current.close();
  expect([...OLD_CACHES] as string[]).not.toContain(ASSET_CACHE);
  expect([...OLD_CACHES] as string[]).not.toContain(SHARE_CACHE);
  expect([...OLD_DATABASES] as string[]).not.toContain(current.name);
});

it('deletes the old caches and databases at start and leaves everything else', async () => {
  for (const name of [...OLD_DATABASES, OLD_SYNC, 'anyrecall', ...OTHERS])
    await createDatabase(name);

  expect(await removeOldStorage()).toBe(true);

  expect(await databaseNames()).toEqual(['anyrecall', ...OTHERS].sort());
  expect(deletedCaches).toEqual([...OLD_CACHES]);
  expect([...cacheNames].sort()).toEqual(
    [ASSET_CACHE, SHARE_CACHE, 'workbox-precache-v2-app'].sort(),
  );
  expect(local.get(OLD_STORAGE_REMOVED)).toBe('1');
});

it('runs once: a later start deletes nothing, even a database with an old name', async () => {
  expect(await removeOldStorage()).toBe(true);
  deletedCaches = [];
  await createDatabase('campus-recall');

  expect(await removeOldStorage()).toBe(true);

  expect(deletedCaches).toEqual([]);
  expect(await databaseNames()).toEqual(['campus-recall']);
});

it('tries again at the next start when an old database is still open elsewhere', async () => {
  // Another tab still running the old version keeps the old library open.
  const open = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('campus-recall');
    request.onupgradeneeded = () => request.result.createObjectStore('rows');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  expect(await removeOldStorage()).toBe(false);
  expect(local.has(OLD_STORAGE_REMOVED)).toBe(false);

  open.close();
  expect(await removeOldStorage()).toBe(true);
  expect(await databaseNames()).toEqual([]);
  expect(local.get(OLD_STORAGE_REMOVED)).toBe('1');
});

it('still removes the library database where databases cannot be listed, and never throws', async () => {
  await createDatabase('campus-recall');
  await createDatabase('keyval-store');
  const real = indexedDB.databases.bind(indexedDB);
  const spy = vi.spyOn(indexedDB, 'databases').mockRejectedValue(new Error('not supported'));
  vi.stubGlobal('caches', {
    delete: async () => {
      throw new Error('Cache Storage is unavailable');
    },
  });

  expect(await removeOldStorage()).toBe(false);

  spy.mockRestore();
  expect((await real()).map((entry) => entry.name)).toEqual(['keyval-store']);
  expect(local.has(OLD_STORAGE_REMOVED)).toBe(false);
});
