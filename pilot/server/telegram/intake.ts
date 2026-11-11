// Records Telegram updates for the worker, whichever transport brought them (long polling or the
// webhook). Each message or button tap is recorded once with its job; only private chats with
// people are taken, and while the bot is limited to some users, nothing from anyone else is kept.
import type { BotStore } from '../whatsapp/store';
import type { TgUpdate, TgUser } from './api';
import {
  callbackKey,
  messageKey,
  telegramSender,
  type TelegramInbound,
  type TelegramSender,
} from './store';

/** Who may use the bot during the demo; absent, everyone may. */
export interface AllowedUsers {
  /** Numeric user IDs. */
  ids: ReadonlySet<string>;
  /** Usernames in lowercase, without `@`. */
  usernames: ReadonlySet<string>;
}

export const isAllowed = (allowed: AllowedUsers | undefined, user: TgUser) =>
  !allowed ||
  allowed.ids.has(String(user.id)) ||
  (typeof user.username === 'string' && allowed.usernames.has(user.username.toLowerCase()));

/** One update as the worker sees it, or undefined when the bot does not take it. */
export function readUpdate(
  update: unknown,
): { sender: TelegramSender; inbound: TelegramInbound; user: TgUser } | undefined {
  if (!update || typeof update !== 'object') return undefined;
  const { message, callback_query: callback } = update as TgUpdate;
  if (message && typeof message === 'object') {
    const { chat } = message;
    if (
      !Number.isSafeInteger(message.message_id) ||
      !chat ||
      chat.type !== 'private' ||
      chat.id !== message.from?.id
    )
      return undefined;
    const sender = telegramSender(message.from);
    if (!sender) return undefined;
    return {
      sender,
      user: message.from!,
      inbound: { id: messageKey(message), type: 'message', message },
    };
  }
  if (callback && typeof callback === 'object') {
    if (typeof callback.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(callback.id))
      return undefined;
    // A button in a private chat with this person; anything else is not this bot's to answer.
    const chat = callback.message?.chat;
    if (chat && (chat.type !== 'private' || chat.id !== callback.from?.id)) return undefined;
    const sender = telegramSender(callback.from);
    if (!sender) return undefined;
    return {
      sender,
      user: callback.from,
      inbound: { id: callbackKey(callback), type: 'callback_query', callback_query: callback },
    };
  }
  return undefined;
}

export interface TelegramIntakeOptions {
  bot: BotStore;
  allowed?: AllowedUsers;
  /**
   * Someone outside `allowed` wrote or tapped: nothing of theirs is stored, and this answers
   * them (without waiting) that the bot is not open yet.
   */
  onRefused?: (input: { chatId: number; callbackQueryId?: string }) => void;
  nowSeconds?: () => number;
}

/** Returns a function that records one update; true when it was new. */
export function createTelegramIntake(options: TelegramIntakeOptions) {
  const now = options.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  // Refusals are not stored, so a redelivered update is recognised here instead, for a while.
  const refused = new Set<string>();
  return async function intake(update: unknown) {
    const read = readUpdate(update);
    if (!read) return false;
    const { sender, inbound, user } = read;
    if (!isAllowed(options.allowed, user)) {
      if (refused.has(inbound.id)) return false;
      refused.add(inbound.id);
      if (refused.size > 2000) refused.delete(refused.values().next().value!);
      options.onRefused?.({
        chatId: user.id,
        ...(inbound.callback_query ? { callbackQueryId: inbound.callback_query.id } : {}),
      });
      return false;
    }
    return options.bot.recordInbound(sender, {
      wamid: inbound.id,
      senderId: sender.userId,
      ownerKey: sender.ownerKey,
      receivedAt: now(),
      message: inbound,
    });
  };
}
