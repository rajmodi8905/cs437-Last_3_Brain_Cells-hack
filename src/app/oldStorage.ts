// One-time removal of what the app kept on this device under its earlier name, Campus Recall.
// The library, the search models and the Auto-sync state now use new names, so the old ones
// would only take up space (about 445 MB with the search models). Only the names listed here
// are ever deleted; anything else on the device is left alone.

/** Cache Storage caches under the old name: the search models and a share waiting for Add. */
export const OLD_CACHES = ['campus-recall-assets-v1', 'campus-recall-share'] as const;
/** The old library database. */
export const OLD_DATABASES = ['campus-recall'] as const;
/** Auto-sync kept one database per signed-in account: this prefix and the account's ID. */
export const OLD_SYNC_DATABASE = /^campus-recall-pilot-sync-[A-Za-z0-9]{8,64}$/;
/** Set in localStorage once everything above is gone, so the removal runs once. */
export const OLD_STORAGE_REMOVED = 'anyrecall:old-storage-removed';

const deleteDatabase = (name: string) =>
  new Promise<boolean>((resolve) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve(true);
    request.onerror = () => resolve(false);
    // Still open in another tab running the old version: tried again at the next start.
    request.onblocked = () => resolve(false);
  });

const flag = () => {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
};

/** Deletes the old-named caches and databases. True once nothing of them is left. */
export async function removeOldStorage(): Promise<boolean> {
  if (flag()?.getItem(OLD_STORAGE_REMOVED) === '1') return true;
  let done = true;
  try {
    if (typeof caches !== 'undefined') for (const name of OLD_CACHES) await caches.delete(name);
  } catch {
    done = false;
  }
  if (typeof indexedDB !== 'undefined') {
    const names: string[] = [...OLD_DATABASES];
    try {
      // Not in every browser; without it only the library database can be named.
      const listed = (await indexedDB.databases?.()) ?? [];
      for (const { name } of listed) if (name && OLD_SYNC_DATABASE.test(name)) names.push(name);
    } catch {
      done = false;
    }
    for (const name of names) if (!(await deleteDatabase(name))) done = false;
  }
  if (done)
    try {
      flag()?.setItem(OLD_STORAGE_REMOVED, '1');
    } catch {
      // Storage is unavailable: the removal simply runs again next time.
    }
  return done;
}
