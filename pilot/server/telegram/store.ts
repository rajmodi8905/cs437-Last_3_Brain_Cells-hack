// Storage for the Telegram channel (docs/pilot/telegram.md). Messages, jobs, sender state and app
// links use the same BotStore as WhatsApp on Telegram's own tables (`tg_*`, migration 5), so the
// two channels never share a queue or a link. This file adds what only Telegram needs: the long
// polling offset and the short tokens behind search result buttons.
import type { SourceLocation } from '../../../src/shared';
import { chatGlobalId } from '../chat/items';
import type { BotTables } from '../whatsapp/postgres';
import type { TgCallbackQuery, TgMessage, TgUser } from './api';
import type { WhatsAppSender } from '../whatsapp/store';

export const TELEGRAM_TABLES: BotTables = {
  senders: 'tg_senders',
  inbound: 'tg_inbound',
  jobs: 'tg_jobs',
  links: 'tg_links',
};

/**
 * A Telegram user in the shared BotStore shape: `userId` is the numeric user ID, `ownerKey`
 * `tg:<id>`, and the display field (`waId`, a phone number for WhatsApp) holds the @username when
 * there is one. In a private chat the chat ID equals the user ID, so replies go to `userId`.
 */
export type TelegramSender = WhatsAppSender;

/** Telegram user IDs are positive whole numbers (up to 52 bits); anything else is refused. */
const USER_ID = /^[1-9]\d{0,19}$/;
const USERNAME = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;

export const telegramOwnerKey = (userId: string) => `tg:${userId}`;

/** The sender for a Telegram user, or undefined for bots and malformed IDs. */
export function telegramSender(user: TgUser | undefined): TelegramSender | undefined {
  if (!user || user.is_bot) return undefined;
  if (!Number.isSafeInteger(user.id) || !USER_ID.test(String(user.id))) return undefined;
  const userId = String(user.id);
  const username =
    typeof user.username === 'string' && USERNAME.test(user.username) ? user.username : undefined;
  return { userId, ownerKey: telegramOwnerKey(userId), ...(username ? { waId: username } : {}) };
}

/** What is stored for one update: a message or a button tap, under its own key. */
export interface TelegramInbound {
  /** `m:<chat>:<message>` or `c:<callback query ID>`. */
  id: string;
  type: 'message' | 'callback_query';
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
  [field: string]: unknown;
}

/**
 * The key a message or button tap is recorded and deduplicated under. Telegram sends the same
 * update again with the same message (chat ID and message ID, unique for good within a chat) or
 * the same callback query ID. The update ID is not used for this: it orders updates for polling,
 * and Telegram may start it again from a random number after a week without updates.
 */
export const messageKey = (message: TgMessage) => `m:${message.chat.id}:${message.message_id}`;
export const callbackKey = (callback: TgCallbackQuery) => `c:${callback.id}`;

/** The item's global ID for a Telegram message key. */
export const telegramGlobalId = (key: string) => chatGlobalId('telegram', key);

/** A search result button: the picked item and place, for one owner, until it expires. */
export interface ResultPick {
  token: string;
  ownerKey: string;
  globalId: string;
  location: SourceLocation;
  /** Seconds. */
  expiresAt: number;
}

export interface TelegramStateStore {
  /** The next `getUpdates` offset; undefined before the first update. */
  getOffset(): Promise<number | undefined>;
  setOffset(offset: number): Promise<void>;
  /** Stores result buttons and removes expired ones. */
  createPicks(picks: ResultPick[], now: number): Promise<void>;
  /** The button if it exists and has not expired by `now`. */
  getPick(token: string, now: number): Promise<ResultPick | undefined>;
  /** Removes every button of an owner (on erase). */
  forgetOwner(ownerKey: string): Promise<void>;
}

/** In-memory TelegramStateStore for tests and local trials. Not durable. */
export class MemoryTelegramStore implements TelegramStateStore {
  private offset: number | undefined;
  private picks = new Map<string, ResultPick>();

  async getOffset() {
    return this.offset;
  }
  async setOffset(offset: number) {
    this.offset = offset;
  }
  async createPicks(picks: ResultPick[], now: number) {
    for (const [token, pick] of this.picks) if (pick.expiresAt <= now) this.picks.delete(token);
    for (const pick of picks) this.picks.set(pick.token, structuredClone(pick));
  }
  async getPick(token: string, now: number) {
    const pick = this.picks.get(token);
    return pick && pick.expiresAt > now ? structuredClone(pick) : undefined;
  }
  async forgetOwner(ownerKey: string) {
    for (const [token, pick] of this.picks)
      if (pick.ownerKey === ownerKey) this.picks.delete(token);
  }
}
