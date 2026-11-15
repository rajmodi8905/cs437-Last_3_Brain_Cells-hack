// The bot erase paths remove blobs only after the owner lock's transaction commits, like
// `DELETE /vault` and `DELETE /items/{id}` (#71, item 2): a blob delete that fails inside the
// transaction would roll the erase back after the original is already gone.
import { expect, it } from 'vitest';
import { eraseOwner } from '../server/chat/erase';
import { MemoryObjectStore, MemoryPilotStore } from '../server/memory';
import { deleteItemAsOwner } from '../server/telegram/erase';
import { MemoryBotStore } from '../server/whatsapp/store';
import type { StoredItem } from '../server/store';

const OWNER = 'whatsapp:owner-a';

/** Counts the owner locks held, as the store's transaction is while a bot handler runs. */
class LockWatchingStore extends MemoryPilotStore {
  held = 0;
  override async withOwnerLock<T>(ownerKey: string, run: () => Promise<T>): Promise<T> {
    return super.withOwnerLock(ownerKey, async () => {
      this.held++;
      try {
        return await run();
      } finally {
        this.held--;
      }
    });
  }
}
class WatchedObjects extends MemoryObjectStore {
  failDeletes = false;
  heldWhenDeleted: boolean[] = [];
  constructor(private store: LockWatchingStore) {
    super();
  }
  override async delete(key: string) {
    this.heldWhenDeleted.push(this.store.held > 0);
    if (this.failDeletes) throw new Error('object storage unavailable');
    return super.delete(key);
  }
}

async function withOneItem() {
  const store = new LockWatchingStore();
  const objects = new WatchedObjects(store);
  const { epoch } = await store.vault(OWNER);
  const objectKey = `${OWNER}/${epoch}/item-1/original`;
  await objects.put(objectKey, new Uint8Array([1, 2, 3]));
  const item: StoredItem = {
    globalId: 'item-1',
    kind: 'pdf',
    title: 'Notes',
    mimeType: 'application/pdf',
    byteLength: 3,
    contentSha256: 'a'.repeat(64),
    createdAt: 1_762_000_000_000,
    revision: 1,
    deleted: false,
    objectKey,
  };
  await store.publish(OWNER, item, epoch);
  return { store, objects };
}

it('DELETE ALL on WhatsApp removes blobs only after the owner lock is released', async () => {
  const { store, objects } = await withOneItem();
  await eraseOwner({ store, objects, bot: new MemoryBotStore(), userId: 'u1', ownerKey: OWNER });
  expect(objects.heldWhenDeleted.length).toBeGreaterThan(0);
  expect(objects.heldWhenDeleted.every((held) => !held)).toBe(true);
});

it('DELETE ALL still finishes when a blob cannot be removed after the commit', async () => {
  const { store, objects } = await withOneItem();
  objects.failDeletes = true;
  await expect(
    eraseOwner({ store, objects, bot: new MemoryBotStore(), userId: 'u1', ownerKey: OWNER }),
  ).resolves.toBeUndefined();
  expect((await store.getItem(OWNER, 'item-1'))?.deleted).not.toBe(false);
});

it("Telegram /delete hands an item's blob deletes to the caller to run after the commit", async () => {
  const { store, objects } = await withOneItem();
  const later: Array<() => Promise<void>> = [];
  expect(
    await deleteItemAsOwner(store, objects, OWNER, 'item-1', (task) => void later.push(task)),
  ).toBe(true);
  expect(objects.heldWhenDeleted).toEqual([]);
  expect(later.length).toBeGreaterThan(0);
  for (const task of later) await task();
  expect(objects.heldWhenDeleted.length).toBe(later.length);
});
