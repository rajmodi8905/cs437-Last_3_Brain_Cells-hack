// Removing an account's cloud library (P10), shared by `DELETE /vault` and the WhatsApp
// `DELETE ALL` command so both forget the same rows, delete the same objects and move the epoch.
import { stagingKey, type ObjectStore, type PilotStore } from './store';

/**
 * Resets the vault and deletes its originals, index bundles and abandoned upload chunks.
 * Callers hold the owner's lock. Returns the new epoch. With `later`, the object deletes are
 * handed to it to run after the lock's transaction commits, so one that fails cannot roll the
 * reset back; without it they run here.
 */
export async function resetOwnerVault(
  store: PilotStore,
  objects: ObjectStore,
  ownerKey: string,
  later?: (task: () => Promise<void>) => Promise<void> | void,
) {
  const { epoch, removed, abandoned } = await store.resetVault(ownerKey);
  const remove = async (key: string) => {
    if (later) await later(() => objects.delete(key));
    else await objects.delete(key);
  };
  for (const item of removed) {
    for (const key of [item.objectKey, item.indexObjectKey])
      if (key?.startsWith(`${ownerKey}/`)) await remove(key);
  }
  for (const upload of abandoned)
    for (const n of upload.chunks) await remove(stagingKey(upload.uploadId, n));
  return epoch;
}

/**
 * Runs tasks that were held back until a lock's transaction committed (see `resetOwnerVault`).
 * The change is already committed, so a failure cannot undo it: it is logged, and the
 * remaining tasks still run.
 */
export async function runAfterCommit(tasks: Array<() => Promise<void>>) {
  for (const task of tasks)
    await task().catch((cause: unknown) =>
      console.error('Cleanup after a committed change failed', cause),
    );
}
