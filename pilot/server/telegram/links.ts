// One-time links that open a Telegram vault in the app (T6): the same tokens, expiry, pages and
// session rules as WhatsApp's (../whatsapp/links.ts), kept in Telegram's own link table and path.
import type { BotStore } from '../whatsapp/store';
import { storeOpenLink } from '../whatsapp/links';
import type { TelegramSender } from './store';

export const TELEGRAM_OPEN_PREFIX = '/api/v1/telegram/open/';

/** The account name the app shows: the @username when Telegram gave one. */
export const telegramLabel = (sender: Pick<TelegramSender, 'waId'>) =>
  sender.waId ? `Telegram @${sender.waId}` : 'your Telegram account';

/** Says how to get a new link when one no longer works. */
export const TELEGRAM_LINK_AGAIN = 'Send /open to the Campus Recall Telegram bot for a new one.';

/** Stores a new link for the sender's vault and returns its URL. */
export function createTelegramLink(
  bot: BotStore,
  sender: TelegramSender,
  origin: string,
  now: number,
) {
  return storeOpenLink(
    bot,
    { ownerKey: sender.ownerKey, label: telegramLabel(sender) },
    `${origin.replace(/\/$/, '')}${TELEGRAM_OPEN_PREFIX}`,
    now,
  );
}
