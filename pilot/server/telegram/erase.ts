// Unlinking a Telegram user (/logout) and erasing what they saved through Telegram (/delete). The
// linked account is the student's own cloud library, which the app also syncs into, so /delete
// never resets it: it deletes only the items saved through Telegram, each the way
// `DELETE /items/{id}` does (a tombstone at the next revision in the change feed, so other devices
// remove it too, then its original and index objects).
import { decideWrite } from '../../contract';
import type { ObjectStore, PilotStore } from '../store';
import type { BotStore } from '../whatsapp/store';
import { telegramUserLock, type TelegramLink, type TelegramStateStore } from './store';

/** Deletes one item as `DELETE /items/{id}` does; false when it was already gone. */
export async function deleteItemAsOwner(
  store: PilotStore,
  objects: ObjectStore,
  ownerKey: string,
  globalId: string,
) {
  const current = await store.getItem(ownerKey, globalId);
  if (!current || current.deleted) return false;
  const decision = decideWrite(current, { type: 'delete', expectedRevision: current.revision });
  if (decision.action === 'reject') return false;
  const { epoch } = await store.vault(ownerKey);
  await store.publish(
    ownerKey,
    {
      ...current,
      revision: decision.nextRevision,
      deleted: true,
      objectKey: undefined,
      indexObjectKey: undefined,
      indexBytes: undefined,
      index: undefined,
    },
    epoch,
  );
  // Objects go only after the tombstone is written, as for the API.
  for (const key of [current.objectKey, current.indexObjectKey])
    if (key?.startsWith(`${ownerKey}/`)) await objects.delete(key);
  return true;
}

export interface UnlinkInput {
  store: PilotStore;
  objects: ObjectStore;
  bot: BotStore;
  state: TelegramStateStore;
  userId: string;
  /** The user's `tg:<id>` key, under which their messages and jobs are filed. */
  identityKey: string;
}

/** Unlinks the user; the caller holds the user's lock. */
async function unlink(input: UnlinkInput) {
  const { bot, state, userId } = input;
  const account = await state.getAccount(userId);
  await state.unlinkAccount(userId);
  const links: TelegramLink[] = await state.revokeLinks(userId);
  await bot.forgetSender(userId, input.identityKey);
  return { account, links };
}

/**
 * /logout: unlinks the user, revokes their unused login and app links, and forgets their
 * messages' content, consent, /stop and username. Returns the account that was linked and the
 * revoked links (so their buttons can be removed).
 */
export const unlinkTelegramUser = (input: UnlinkInput) =>
  input.store.withOwnerLock(telegramUserLock(input.userId), () => unlink(input));

/**
 * /delete: unlinks the user as /logout does, then deletes every item saved through Telegram into
 * the account they were linked to, its result buttons and the record of those items. Items the
 * app synced stay. The account's lock is taken after the unlink, so a save still being stored
 * either finished first (and is deleted here) or finds the user unlinked and stores nothing.
 */
export async function eraseTelegramItems(input: UnlinkInput) {
  const { store, objects, state } = input;
  return store.withOwnerLock(telegramUserLock(input.userId), async () => {
    const { account, links } = await unlink(input);
    if (!account) return { account, links, erased: 0 };
    const erased = await store.withOwnerLock(account.ownerKey, async () => {
      const ids = await state.savedItems(account.ownerKey);
      let count = 0;
      for (const globalId of ids)
        if (await deleteItemAsOwner(store, objects, account.ownerKey, globalId)) count++;
      await state.forgetSaved(account.ownerKey, ids);
      await state.forgetOwner(account.ownerKey);
      return count;
    });
    return { account, links, erased };
  });
}
