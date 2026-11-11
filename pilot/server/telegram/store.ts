// Storage for the Telegram channel (docs/pilot/telegram.md). Messages, jobs and sender state use
// the same BotStore as WhatsApp on Telegram's own tables (`tg_*`, migration 5), so the two channels
// never share a queue. This file adds what only Telegram needs: the long polling offset, the short
// tokens behind search result buttons, the IITGN account each Telegram user linked, one-time login
// and app links (migration 6), and which items of an account were saved through Telegram.
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
 *
 * `tg:<id>` is only the key the bot files this user's messages and jobs under. It is never a
 * vault: items go to the IITGN account the user linked (`TelegramAccount`).
 */
export type TelegramSender = WhatsAppSender;

/** Telegram user IDs are positive whole numbers (up to 52 bits); anything else is refused. */
const USER_ID = /^[1-9]\d{0,19}$/;
const USERNAME = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;

export const telegramOwnerKey = (userId: string) => `tg:${userId}`;
/** The lock that orders linking, opening, /logout and /delete for one Telegram user. */
export const telegramUserLock = (userId: string) => `telegram-user:${userId}`;

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

/** The IITGN account a Telegram user linked; their saves and searches use its vault. */
export interface TelegramAccount {
  userId: string;
  /** The vault: `google:<sub>`, from the account's own Google sign-in. */
  ownerKey: string;
  /** The account's verified email, shown on app links and (masked) in the chat. */
  email: string;
  /** Seconds. */
  linkedAt: number;
}

/**
 * A one-time link the bot sends; only the token's SHA-256 is kept. A `login` link links the
 * Telegram user to the account signed in on the page; an `open` link opens the linked account
 * in the app.
 */
export interface TelegramLink {
  tokenHash: string;
  purpose: 'login' | 'open';
  userId: string;
  /** `login`: the user's `tg:<id>` key. `open`: the linked vault (`google:<sub>`). */
  ownerKey: string;
  /** `login`: the Telegram name the page shows. `open`: the account's email. */
  label: string;
  /** Seconds. */
  createdAt: number;
  expiresAt: number;
  /** The chat message carrying a login button, so the button can be removed once used. */
  messageId?: number;
}

/** An item saved through Telegram into an account, so /delete can erase only those. */
export interface TelegramSaved {
  ownerKey: string;
  globalId: string;
  userId: string;
  /** Seconds. */
  savedAt: number;
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

  /** The account this Telegram user linked, if any. */
  getAccount(userId: string): Promise<TelegramAccount | undefined>;
  /** Links the user to an account, replacing a link to the same account. */
  linkAccount(account: TelegramAccount): Promise<void>;
  unlinkAccount(userId: string): Promise<void>;

  createLink(link: TelegramLink): Promise<void>;
  /** Notes the message that carries a login link's button. */
  setLinkMessage(tokenHash: string, messageId: number): Promise<void>;
  /** The link if it exists for this purpose and has not expired by `now`; does not use it up. */
  peekLink(
    tokenHash: string,
    purpose: TelegramLink['purpose'],
    now: number,
  ): Promise<TelegramLink | undefined>;
  /** Returns and removes the link in one step, so it is used at most once. */
  takeLink(
    tokenHash: string,
    purpose: TelegramLink['purpose'],
    now: number,
  ): Promise<TelegramLink | undefined>;
  /** Removes the user's links (of one purpose, or all) and returns what was removed. */
  revokeLinks(userId: string, purpose?: TelegramLink['purpose']): Promise<TelegramLink[]>;

  /** Records an item saved through Telegram; recording it again changes nothing. */
  recordSaved(saved: TelegramSaved): Promise<void>;
  /** The global IDs of the account's items saved through Telegram. */
  savedItems(ownerKey: string): Promise<string[]>;
  forgetSaved(ownerKey: string, globalIds: string[]): Promise<void>;
}

/** In-memory TelegramStateStore for tests and local trials. Not durable. */
export class MemoryTelegramStore implements TelegramStateStore {
  private offset: number | undefined;
  private picks = new Map<string, ResultPick>();
  private accounts = new Map<string, TelegramAccount>();
  private links = new Map<string, TelegramLink>();
  private saved = new Map<string, TelegramSaved>();

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

  async getAccount(userId: string) {
    const account = this.accounts.get(userId);
    return account && { ...account };
  }
  async linkAccount(account: TelegramAccount) {
    this.accounts.set(account.userId, { ...account });
  }
  async unlinkAccount(userId: string) {
    this.accounts.delete(userId);
  }

  async createLink(link: TelegramLink) {
    this.links.set(link.tokenHash, { ...link });
  }
  async setLinkMessage(tokenHash: string, messageId: number) {
    const link = this.links.get(tokenHash);
    if (link) link.messageId = messageId;
  }
  async peekLink(tokenHash: string, purpose: TelegramLink['purpose'], now: number) {
    const link = this.links.get(tokenHash);
    return link && link.purpose === purpose && link.expiresAt > now ? { ...link } : undefined;
  }
  async takeLink(tokenHash: string, purpose: TelegramLink['purpose'], now: number) {
    const link = this.links.get(tokenHash);
    if (!link || link.purpose !== purpose) return undefined;
    this.links.delete(tokenHash);
    return link.expiresAt > now ? link : undefined;
  }
  async revokeLinks(userId: string, purpose?: TelegramLink['purpose']) {
    const removed: TelegramLink[] = [];
    for (const [hash, link] of this.links)
      if (link.userId === userId && (!purpose || link.purpose === purpose)) {
        this.links.delete(hash);
        removed.push(link);
      }
    return removed;
  }

  async recordSaved(saved: TelegramSaved) {
    const key = `${saved.ownerKey} ${saved.globalId}`;
    if (!this.saved.has(key)) this.saved.set(key, { ...saved });
  }
  async savedItems(ownerKey: string) {
    return [...this.saved.values()]
      .filter((saved) => saved.ownerKey === ownerKey)
      .map((saved) => saved.globalId);
  }
  async forgetSaved(ownerKey: string, globalIds: string[]) {
    for (const globalId of globalIds) this.saved.delete(`${ownerKey} ${globalId}`);
  }
}
