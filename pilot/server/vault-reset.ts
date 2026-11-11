// Removing an account's cloud library (P10), shared by `DELETE /vault` and the WhatsApp
// `DELETE ALL` command so both forget the same rows, delete the same objects and move the epoch.
import { stagingKey, type ObjectStore, type PilotStore } from './store';

/**
 * Resets the vault and deletes its originals, index bundles and abandoned upload chunks.
 * Callers hold the owner's lock. Returns the new epoch.
 */
export async function resetOwnerVault(store: PilotStore, objects: ObjectStore, ownerKey: string) {
  const { epoch, removed, abandoned } = await store.resetVault(ownerKey);
  for (const item of removed) {
    for (const key of [item.objectKey, item.indexObjectKey])
      if (key?.startsWith(`${ownerKey}/`)) await objects.delete(key);
  }
  for (const upload of abandoned)
    for (const n of upload.chunks) await objects.delete(stagingKey(upload.uploadId, n));
  return epoch;
}
