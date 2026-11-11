// Erasing everything a chat bot keeps for one person whose vault belongs to the bot (WhatsApp
// DELETE ALL): the same vault reset as `DELETE /vault`, every session of the vault, and the bot's
// own records of that person except the message IDs that dedupe needs. Telegram saves into the
// student's own account instead, so its /delete erases only what was saved there
// (../telegram/erase.ts).
import type { ObjectStore, PilotStore } from '../store';
import { resetOwnerVault } from '../vault-reset';
import type { BotStore } from '../whatsapp/store';

export async function eraseOwner(input: {
  store: PilotStore;
  objects: ObjectStore;
  bot: BotStore;
  userId: string;
  ownerKey: string;
  /** Anything else the channel keeps for this owner, removed under the same lock. */
  more?: () => Promise<void>;
}) {
  const { store, objects, bot, userId, ownerKey } = input;
  // Under the owner's lock, so a save or a link being opened meanwhile waits and then finds
  // nothing to add to.
  await store.withOwnerLock(ownerKey, async () => {
    await resetOwnerVault(store, objects, ownerKey);
    await store.deleteOwnerSessions(ownerKey);
    await bot.forgetSender(userId, ownerKey);
    await input.more?.();
  });
}
