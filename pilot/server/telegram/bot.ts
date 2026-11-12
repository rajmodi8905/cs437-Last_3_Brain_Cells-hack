/// <reference types="node" />
// The Telegram bot (docs/pilot/telegram.md): nothing is stored or searched until the Telegram user
// links their IITGN Google account (T1, T6); then files and notes are saved into that account's
// own cloud library (T2, T5), at most one item and one reply per message (T3), searches are
// answered with result buttons that send the original back (T8), one-time links open the account
// in the app (T6), and /logout and /delete unlink and erase only what was saved here (T9). The
// queue, saving, search, sending back and batching are the shared chat core (../chat/), as for
// WhatsApp; this file holds what differs: Telegram's messages, commands, buttons and downloads.
import { createHash, randomBytes } from 'node:crypto';
import { LIMITS } from '../../../src/shared';
import { validateCloudItem } from '../../contract';
import { createSaveBatches, realSchedule } from '../chat/batch';
import { classifyIndexFailure } from '../chat/index-failure';
import { clip, type ChatChannel } from '../chat/channel';
import { NOTE_MIME, storeChatItem } from '../chat/items';
import { createJobRunner, defaultRetryDelay, startJobLoop } from '../chat/jobs';
import { searchOwner } from '../chat/search';
import { sendBack } from '../chat/send-back';
import { RateLimiter } from '../limits';
import type { ObjectStore, PilotStore, StoredItem } from '../store';
import type { EngineHost } from '../whatsapp/engine-host';
import { MediaTooLargeError } from '../whatsapp/graph';
import { createWhatsAppIndexer, type WhatsAppIndexerOptions } from '../whatsapp/indexer';
import { REPLIES } from '../whatsapp/ingest';
import type { BotJob, BotStore, JobKind } from '../whatsapp/store';
import {
  TelegramError,
  type InlineKeyboard,
  type TelegramApi,
  type TgCallbackQuery,
  type TgMessage,
  type TgUser,
} from './api';
import { eraseTelegramItems, unlinkTelegramUser } from './erase';
import { createLoginLink, createOpenLink, telegramName } from './links';
import { createdAtOf, planTelegramMessage, commandOf, type TelegramPlan } from './plan';
import { describeFailure } from './poller';
import { TELEGRAM_REPLIES } from './replies';
import {
  telegramGlobalId,
  type TelegramAccount,
  type TelegramInbound,
  type TelegramLink,
  type TelegramSender,
  type TelegramStateStore,
} from './store';

/** The delete button works for this many seconds after /delete. */
export const DELETE_CONFIRM_SECONDS = 600;
/** Telegram's limits: message text and captions, counted in UTF-16 code units. */
export const TELEGRAM_LIMITS = { text: 4096, caption: 1024, callbackData: 64 };
/** Telegram sends photos up to 10 MB with sendPhoto; larger ones go as documents. */
const MAX_PHOTO_SEND_BYTES = 10 * 1024 * 1024;
const SEND_AS_PHOTO = new Set(['image/jpeg', 'image/png']);

export { TELEGRAM_REPLIES } from './replies';

/** Button data: the delete confirmation and a search result (`p:<token>`). */
const DELETE = 'delete';
const PICK = /^p:([A-Za-z0-9_-]{12})$/;

/** Cut to `max` UTF-16 code units (how Telegram counts) between whole code points. */
export function fitTelegram(text: string, max: number) {
  if (text.length <= max) return text;
  let kept = '';
  for (const point of text) {
    if (kept.length + point.length > max - 1) break;
    kept += point;
  }
  return `${kept}…`;
}

/** A Telegram reply address: the private chat (the user's ID) and the vault it belongs to. */
export interface TelegramAddress {
  chatId: number;
  /** The linked account's vault (`google:<sub>`). */
  ownerKey: string;
}

/**
 * Telegram's renderer for the shared conversation parts: results as a numbered message with one
 * button per result, a JPEG or PNG up to 10 MB as a photo and anything else as a document, and a
 * URL button for app links. Result buttons carry a short random token (`callback_data` holds at
 * most 64 bytes); the token is stored with the item, place and owner, and expires.
 */
export function createTelegramChannel(input: {
  api: TelegramApi;
  state: TelegramStateStore;
  now: () => number;
  /** How long a result button works, in seconds. */
  pickSeconds: number;
}): ChatChannel<TelegramAddress> {
  const { api, state, now } = input;
  return {
    textLimit: TELEGRAM_LIMITS.text,
    captionLimit: TELEGRAM_LIMITS.caption,
    async sendText(to, text) {
      await api.sendMessage(to.chatId, fitTelegram(text, TELEGRAM_LIMITS.text));
    },
    async sendResults(to, query, rows, keywordOnly) {
      const at = now();
      const picks = rows.map((row) => ({
        token: randomBytes(9).toString('base64url'),
        ownerKey: to.ownerKey,
        globalId: row.globalId,
        location: row.location,
        expiresAt: at + input.pickSeconds,
      }));
      await state.createPicks(picks, at);
      const text = [
        TELEGRAM_REPLIES.results(query),
        '',
        ...rows.map((row, i) => `${i + 1}. ${clip(row.title, 80)} (${row.description})`),
        ...(keywordOnly ? ['', TELEGRAM_REPLIES.keywordOnly] : []),
        ...(!keywordOnly && rows.some((row) => row.description.endsWith('still indexing'))
          ? ['', TELEGRAM_REPLIES.stillIndexing]
          : []),
      ].join('\n');
      const keyboard: InlineKeyboard = {
        inline_keyboard: rows.map((row, i) => [
          { text: clip(`${i + 1}. ${row.title}`, 40), callback_data: `p:${picks[i].token}` },
        ]),
      };
      await api.sendMessage(to.chatId, fitTelegram(text, TELEGRAM_LIMITS.text), keyboard);
    },
    async sendFile(to, { item, bytes, caption, filename }) {
      const file = { bytes, filename, mimeType: item.mimeType };
      const text = fitTelegram(caption, TELEGRAM_LIMITS.caption);
      const asPhoto =
        item.kind === 'image' &&
        SEND_AS_PHOTO.has(item.mimeType) &&
        bytes.length <= MAX_PHOTO_SEND_BYTES;
      if (asPhoto) await api.sendPhoto(to.chatId, file, text);
      else await api.sendDocument(to.chatId, file, text);
    },
    async sendOpenButton(to, url) {
      await api.sendMessage(to.chatId, TELEGRAM_REPLIES.openCta, {
        inline_keyboard: [[{ text: TELEGRAM_REPLIES.openButton, url }]],
      });
    },
  };
}

/** Removes the buttons of messages whose one-time action is done; failures are only logged. */
async function removeButtons(
  api: TelegramApi,
  chatId: number,
  messageIds: (number | undefined)[],
  log: (message: string, detail?: unknown) => void,
) {
  for (const id of new Set(messageIds))
    if (id !== undefined)
      await api
        .removeButtons(chatId, id)
        .catch((cause: unknown) => log('Telegram button removal failed', describeFailure(cause)));
}

/** A Telegram user just linked an account on the link page (`/api/v1/telegram/link/…`). */
export interface TelegramLinked {
  userId: string;
  email: string;
  /** Messages whose login buttons are now used up. */
  messageIds: number[];
}

/**
 * Tells the user in the chat that the link worked, and removes the login buttons it used up.
 * Called by the server after the link page, outside the bot's queue.
 */
export async function announceTelegramLink(
  api: TelegramApi,
  linked: TelegramLinked,
  log: (message: string, detail?: unknown) => void = (message, detail) =>
    console.error(message, detail),
) {
  const chatId = Number(linked.userId);
  await removeButtons(api, chatId, linked.messageIds, log);
  await api
    .sendMessage(chatId, TELEGRAM_REPLIES.linked(linked.email))
    .catch((cause: unknown) => log('Telegram reply failed', describeFailure(cause)));
}

export interface TelegramBotOptions {
  bot: BotStore;
  /** The polling offset, result buttons, linked accounts, links and Telegram-saved items. */
  state: TelegramStateStore;
  store: PilotStore;
  objects: ObjectStore;
  api: TelegramApi;
  /** The same account quota as uploads from the app. */
  quotaBytes: number;
  /** Searches by meaning when set; otherwise search is by keyword only, and says so. */
  engine?: EngineHost;
  /** Handles index jobs (`createTelegramIndexer`); without one they stay queued. */
  onIndexJob?: (job: BotJob) => Promise<void>;
  /** The pilot site, for login and app links: `https://…`, no trailing path. */
  origin: string;
  /**
   * False when the origin cannot be opened from a phone (a local trial without a tunnel): /login
   * and /open then say so, and no link button is sent.
   */
  appLinks?: boolean;
  privacyUrl: string;
  contactEmail: string;
  batchMs?: number;
  batchMax?: number;
  schedule?: (run: () => void, ms: number) => () => void;
  /** How long a result button works; a day. */
  pickSeconds?: number;
  supportedIndexVersions?: readonly string[];
  nowSeconds?: () => number;
  leaseSeconds?: number;
  maxAttempts?: number;
  retryDelaySeconds?: (attempt: number) => number;
  senderBurst?: number;
  senderPerMinute?: number;
  /** "typing…" is sent again this often while a search or an index job runs; 4 seconds. */
  typingEveryMs?: number;
  /**
   * A search still waiting for the engine after this long, while a file is being indexed, first
   * gets a short "still processing" message; 5 seconds.
   */
  waitNoticeMs?: number;
  log?: (message: string, detail?: unknown) => void;
}

/** A message the bot will not save, with the reason it gives. */
class Refusal extends Error {
  constructor(readonly reply: string) {
    super(reply);
  }
}

/** Getting a file from Telegram failed; retried, and then the user is asked to send it again. */
class TelegramDownloadError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'TelegramDownloadError';
  }
}

type SavePlan = Extract<TelegramPlan, { action: 'save' }>;

/** The indexer for Telegram items, whose global IDs come from Telegram message keys. */
export const createTelegramIndexer = (options: Omit<WhatsAppIndexerOptions, 'globalIdOf'>) =>
  createWhatsAppIndexer({ ...options, globalIdOf: (job) => telegramGlobalId(job.wamid) });

const errorText = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));
/** Seconds with one decimal, for log lines. */
const seconds = (ms: number) => (ms / 1000).toFixed(1);

export function createTelegramBot(options: TelegramBotOptions) {
  const { bot, state, store, objects, api } = options;
  const now = options.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  const log =
    options.log ??
    ((message, detail) =>
      detail === undefined ? console.error(message) : console.error(message, detail));
  const appLinks = options.appLinks ?? true;
  const channel = createTelegramChannel({
    api,
    state,
    now,
    pickSeconds: options.pickSeconds ?? 86_400,
  });
  const senders = new RateLimiter(
    options.senderBurst ?? 30,
    (options.senderPerMinute ?? 30) / 60,
    now,
  );
  const kinds: JobKind[] = options.onIndexJob ? ['ingest', 'index'] : ['ingest'];
  const addressOf = (sender: TelegramSender, account: TelegramAccount): TelegramAddress => ({
    chatId: Number(sender.userId),
    ownerKey: account.ownerKey,
  });
  const failed = (cause: unknown) => log('Telegram reply failed', describeFailure(cause));
  const typingEveryMs = options.typingEveryMs ?? 4000;
  const waitNoticeMs = options.waitNoticeMs ?? 5000;
  /**
   * Per account: index jobs running in this process now, and when the last one ended
   * (performance.now). A search is told it is waiting only for a file of its own account.
   */
  const indexingNow = new Map<string, number>();
  const lastIndexEnd = new Map<string, number>();

  /**
   * Shows "typing…" in a chat now and every `typingEveryMs` until the returned stop is called.
   * A failing chat action is logged once and never thrown. One is sent at a time, and stop waits
   * for the one still being sent, so "typing…" can never arrive after the reply.
   */
  function typing(chatId: number) {
    let inFlight: Promise<void> | undefined;
    let logged = false;
    const send = () => {
      if (inFlight) return;
      inFlight = api
        .sendChatAction(chatId, 'typing')
        .catch((cause: unknown) => {
          if (!logged) log('Telegram chat action failed', describeFailure(cause));
          logged = true;
        })
        .finally(() => (inFlight = undefined));
    };
    send();
    const timer = setInterval(send, typingEveryMs);
    return async () => {
      clearInterval(timer);
      await inFlight;
    };
  }
  const unlinkInput = (sender: TelegramSender) => ({
    store,
    objects,
    bot,
    state,
    userId: sender.userId,
    identityKey: sender.ownerKey,
  });

  /**
   * Answers a message or tap at most once, whoever processes it: the answer is claimed before it
   * is sent, so a crash right after can lose it but nothing ever sends it twice.
   */
  async function answer(key: string, send: () => Promise<unknown>) {
    if (!(await bot.claimReply(key))) return;
    await send().catch(failed);
  }
  const say = (sender: TelegramSender, text: string, keyboard?: InlineKeyboard) => () =>
    api.sendMessage(
      Number(sender.userId),
      fitTelegram(text, TELEGRAM_LIMITS.text),
      ...(keyboard ? [keyboard] : []),
    );
  /** Every button tap is acknowledged, so the app stops showing it as loading. */
  const acknowledge = (callback: TgCallbackQuery | undefined, text?: string) =>
    callback
      ? api
          .answerCallbackQuery(callback.id, text)
          .catch((cause: unknown) => log('Telegram button answer failed', describeFailure(cause)))
      : Promise.resolve();

  const batches = createSaveBatches<TelegramSender>({
    send: async (sender, titles) => {
      await say(
        sender,
        titles.length === 1 ? REPLIES.saved(titles[0]) : TELEGRAM_REPLIES.savedMany(titles),
      )();
    },
    batchMs: options.batchMs ?? 3000,
    batchMax: options.batchMax ?? 10,
    schedule: options.schedule ?? realSchedule,
    log,
    failedMessage: 'Telegram reply failed',
  });

  /** Saving needs the same linked account and no /stop; checked again under the account's lock. */
  async function canStore(sender: TelegramSender, ownerKey: string) {
    const [account, current] = await Promise.all([
      state.getAccount(sender.userId),
      bot.senderState(sender.userId),
    ]);
    return account?.ownerKey === ownerKey && current.stoppedAt === undefined;
  }

  /** The notice with a one-time login button (or, without an HTTPS origin, why there is none). */
  async function sendLogin(sender: TelegramSender, key: string, from: TgUser | undefined) {
    await answer(key, async () => {
      const notice = TELEGRAM_REPLIES.notice(options.privacyUrl);
      if (!appLinks) return say(sender, `${notice}\n\n${TELEGRAM_REPLIES.noLinks}`)();
      // The link is made only once the reply is claimed, so a retried job leaves no spare one.
      const { url, tokenHash } = await createLoginLink(
        state,
        {
          userId: sender.userId,
          ownerKey: sender.ownerKey,
          name: telegramName({ username: sender.waId, firstName: from?.first_name }),
        },
        options.origin,
        now(),
      );
      const messageId = await say(sender, notice, {
        inline_keyboard: [[{ text: TELEGRAM_REPLIES.loginButton, url }]],
      })();
      if (messageId !== undefined) await state.setLinkMessage(tokenHash, messageId);
    });
  }

  /** /logout: unlinks, revokes unused links and removes their buttons. */
  async function logout(sender: TelegramSender, key: string) {
    const { account, links } = await unlinkTelegramUser(unlinkInput(sender));
    await removeButtons(api, Number(sender.userId), loginMessages(links), log);
    batches.drop(sender.ownerKey);
    await answer(
      key,
      say(
        sender,
        account ? TELEGRAM_REPLIES.loggedOut(account.email) : TELEGRAM_REPLIES.loginFirst,
      ),
    );
  }
  const loginMessages = (links: TelegramLink[]) =>
    links.filter((link) => link.purpose === 'login').map((link) => link.messageId);

  /**
   * /stop, the login gate, commands and buttons. Returns the linked account when the message is
   * still to be saved or searched; undefined when it was dealt with here.
   */
  async function gate(
    sender: TelegramSender,
    key: string,
    inbound: TelegramInbound,
  ): Promise<TelegramAccount | undefined> {
    const current = await bot.senderState(sender.userId);
    const account = await state.getAccount(sender.userId);
    const callback = inbound.callback_query;
    const message = inbound.message;
    const from = message?.from ?? callback?.from;
    const command = message ? commandOf(message) : undefined;
    const data = callback?.data;
    const reply = (text: string, keyboard?: InlineKeyboard) =>
      answer(key, say(sender, text, keyboard));

    if (current.stoppedAt !== undefined) {
      // Stopped: nothing is saved or answered except /resume (or /start).
      if (command?.name === 'resume' || command?.name === 'start') {
        await bot.setStopped(sender.userId, undefined);
        if (account) await reply(TELEGRAM_REPLIES.started);
        else {
          await bot.forgetMessage(key);
          await sendLogin(sender, key, from);
        }
      } else {
        await bot.forgetMessage(key);
        await acknowledge(callback, TELEGRAM_REPLIES.resumeFirst);
      }
      return undefined;
    }

    if (!account) {
      // Before login nothing is kept: not the item, and not the message's content.
      await bot.forgetMessage(key);
      if (callback) {
        if (data === DELETE)
          await removeButtons(api, Number(sender.userId), [callback.message?.message_id], log);
        await acknowledge(callback, TELEGRAM_REPLIES.loginFirst);
        return undefined;
      }
      switch (command?.name) {
        case 'start':
        case 'login':
          await sendLogin(sender, key, from);
          return undefined;
        case 'help':
          await reply(TELEGRAM_REPLIES.help(options.contactEmail));
          return undefined;
        case 'privacy':
          await reply(TELEGRAM_REPLIES.privacy(options.privacyUrl));
          return undefined;
        case 'stop':
          await bot.setStopped(sender.userId, now());
          await reply(TELEGRAM_REPLIES.stopped);
          return undefined;
        case 'logout': {
          // Not linked, but unused login links stop working, and their buttons go.
          const links = await state.revokeLinks(sender.userId);
          await removeButtons(api, Number(sender.userId), loginMessages(links), log);
          break;
        }
      }
      await reply(TELEGRAM_REPLIES.loginFirst);
      return undefined;
    }

    if (callback) {
      await acknowledge(callback);
      if (data === DELETE) {
        await confirmDelete(sender, key, current.deleteRequestedAt, callback);
        return undefined;
      }
      const token = data && PICK.exec(data)?.[1];
      if (token) await pick(sender, account, key, token);
      return undefined;
    }

    if (!command) return account;
    switch (command.name) {
      case 'start':
        await reply(TELEGRAM_REPLIES.alreadyLinked(account.email));
        return undefined;
      case 'login':
        await reply(TELEGRAM_REPLIES.loginWhileLinked(account.email));
        return undefined;
      case 'resume':
        await reply(TELEGRAM_REPLIES.alreadyOn);
        return undefined;
      case 'help':
        await reply(TELEGRAM_REPLIES.help(options.contactEmail));
        return undefined;
      case 'privacy':
        await reply(TELEGRAM_REPLIES.privacy(options.privacyUrl));
        return undefined;
      case 'stop':
        await bot.setStopped(sender.userId, now());
        await reply(TELEGRAM_REPLIES.stopped);
        return undefined;
      case 'logout':
        await logout(sender, key);
        return undefined;
      case 'open':
        // The link is made only once the reply is claimed, so a retried job leaves no spare one.
        await answer(key, async () => {
          if (!appLinks) return say(sender, TELEGRAM_REPLIES.noLinks)();
          const url = await createOpenLink(state, account, options.origin, now());
          await say(sender, TELEGRAM_REPLIES.open, {
            inline_keyboard: [[{ text: TELEGRAM_REPLIES.openButton, url }]],
          })();
        });
        return undefined;
      case 'delete':
        await bot.setDeleteRequest(sender.userId, now());
        await reply(TELEGRAM_REPLIES.deleteAsk, {
          inline_keyboard: [[{ text: TELEGRAM_REPLIES.deleteButton, callback_data: DELETE }]],
        });
        return undefined;
      default:
        await reply(TELEGRAM_REPLIES.unknownCommand(`/${command.name}`));
        return undefined;
    }
  }

  /**
   * The delete button: within 10 minutes of /delete it erases what was saved here and unlinks
   * (T9). The button is removed whatever happens, so it never looks tappable again.
   */
  async function confirmDelete(
    sender: TelegramSender,
    key: string,
    asked: number | undefined,
    callback: TgCallbackQuery,
  ) {
    const chatId = Number(sender.userId);
    await removeButtons(api, chatId, [callback.message?.message_id], log);
    if (asked === undefined) return answer(key, say(sender, TELEGRAM_REPLIES.deleteNotAsked));
    if (now() - asked > DELETE_CONFIRM_SECONDS) {
      await bot.setDeleteRequest(sender.userId, undefined);
      return answer(key, say(sender, TELEGRAM_REPLIES.deleteExpired));
    }
    batches.drop(sender.ownerKey);
    const { links, erased } = await eraseTelegramItems(unlinkInput(sender));
    await removeButtons(api, chatId, loginMessages(links), log);
    await answer(key, say(sender, TELEGRAM_REPLIES.deleted(erased)));
  }

  /** A result button: the original back in the chat, then a link to open the app. */
  async function pick(
    sender: TelegramSender,
    account: TelegramAccount,
    key: string,
    token: string,
  ) {
    const found = await state.getPick(token, now());
    if (!found) return answer(key, say(sender, TELEGRAM_REPLIES.expired));
    await sendBack({
      store,
      objects,
      channel,
      replies: TELEGRAM_REPLIES,
      ownerKey: account.ownerKey,
      // Only buttons for this account count; another account's token finds nothing here.
      picked:
        found.ownerKey === account.ownerKey
          ? { globalId: found.globalId, location: found.location }
          : undefined,
      to: addressOf(sender, account),
      answer: (send) => answer(key, send),
      link: async () =>
        appLinks ? createOpenLink(state, account, options.origin, now()) : undefined,
    });
  }

  /** Search results for an owner: by meaning when the engine is there, plus keyword matches. */
  const search = (ownerKey: string, query: string, engine = options.engine) =>
    searchOwner(
      {
        store,
        objects,
        engine,
        supportedIndexVersions: options.supportedIndexVersions,
        log,
        fallbackMessage: 'Telegram search fell back to keywords',
      },
      ownerKey,
      query,
    );

  async function onText(
    sender: TelegramSender,
    account: TelegramAccount,
    key: string,
    query: string,
  ) {
    const started = performance.now();
    const stopTyping = typing(Number(sender.userId));
    let engineMs = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let notice: Promise<unknown> | undefined;
    // The engine host runs one job at a time, so a search can wait behind a file being indexed;
    // the time spent in the engine is measured, and a long wait for a file of this account is
    // explained once.
    const base = options.engine;
    const engine: EngineHost | undefined = base && {
      index: (input) => base.index(input),
      close: () => base.close(),
      search: async (text, items, kind) => {
        const asked = performance.now();
        timer ??= setTimeout(() => {
          const own =
            (indexingNow.get(account.ownerKey) ?? 0) > 0 ||
            (lastIndexEnd.get(account.ownerKey) ?? -Infinity) > asked;
          if (own) notice = say(sender, TELEGRAM_REPLIES.searchWaiting)().catch(failed);
        }, waitNoticeMs);
        try {
          return await base.search(text, items, kind);
        } finally {
          clearTimeout(timer);
          engineMs += performance.now() - asked;
        }
      },
    };
    try {
      const { rows, keywordOnly } = await search(account.ownerKey, clip(query, 500), engine);
      // The "still processing" message and the last "typing…" are out before the results.
      await notice;
      await stopTyping();
      await answer(key, async () => {
        if (!rows.length) return say(sender, TELEGRAM_REPLIES.noResults(query, keywordOnly))();
        await channel.sendResults(addressOf(sender, account), query, rows, keywordOnly);
      });
    } finally {
      clearTimeout(timer);
      await stopTyping();
      // No query text and no user: only how long it took.
      log(
        `Telegram search took ${seconds(performance.now() - started)} s (waited ${seconds(engineMs)} s for the engine)`,
      );
    }
  }

  /** The bytes to store; files are fetched from Telegram and checked against the declared size. */
  async function contentOf(plan: SavePlan) {
    if (plan.kind === 'note') {
      const characters = Array.from(plan.text).length;
      if (characters > LIMITS.maxTextCodePoints)
        throw new Refusal(TELEGRAM_REPLIES.longNote(characters));
      return { bytes: new TextEncoder().encode(plan.text), mimeType: NOTE_MIME };
    }
    const limit = plan.kind === 'image' ? LIMITS.maxImageBytes : LIMITS.maxPdfBytes;
    const tooBig = (bytes: number | undefined, byTelegram = false) =>
      new Refusal(
        TELEGRAM_REPLIES.tooBig({
          kind: plan.kind,
          ...(plan.fileName ? { name: plan.fileName } : {}),
          ...(bytes !== undefined ? { bytes } : {}),
          byTelegram,
        }),
      );
    // Telegram states the size up front; a file over the app's limit is not even looked up.
    if (plan.media.fileSize !== undefined && plan.media.fileSize > limit)
      throw tooBig(plan.media.fileSize);
    let file;
    try {
      file = await api.getFile(plan.media.fileId);
    } catch (cause) {
      // Telegram refuses getFile for files over its own 20 MB limit for bots.
      if (
        cause instanceof TelegramError &&
        cause.status === 400 &&
        /too big/i.test(cause.description ?? '')
      )
        throw tooBig(plan.media.fileSize, true);
      throw new TelegramDownloadError(errorText(cause), { cause });
    }
    if (!file.filePath)
      throw new TelegramDownloadError('Telegram gave no file path for this file.');
    const size = file.fileSize ?? plan.media.fileSize;
    if (size !== undefined && size > limit) throw tooBig(size);
    let bytes;
    try {
      bytes = await api.download(file.filePath, limit);
    } catch (cause) {
      if (cause instanceof MediaTooLargeError) throw tooBig(size);
      throw new TelegramDownloadError(errorText(cause), { cause });
    }
    // Telegram sends no hash: the size it declared must match, and the item's SHA-256 is computed
    // here from these bytes. Retried: a damaged download is fetched again next time.
    if (size !== undefined && bytes.length !== size)
      throw new TelegramDownloadError('Downloaded bytes do not match the size Telegram declared.');
    return { bytes, mimeType: plan.mimeType };
  }

  async function ingest(job: BotJob) {
    const inbound = await bot.getInbound(job.wamid);
    const sender = inbound && (await bot.getSender(inbound.senderId));
    if (!inbound || !sender) return bot.finishJob(job);
    const key = inbound.wamid;
    const record = inbound.message as TelegramInbound;
    const account = await gate(sender, key, record);
    if (!account) return bot.finishJob(job);
    const message: TgMessage | undefined = record.message;
    if (!message) return bot.finishJob(job);
    const plan = planTelegramMessage(message);
    if (plan.action === 'ignore' || plan.action === 'command') return bot.finishJob(job);
    if (plan.action === 'refuse') {
      await bot.finishJob(job);
      return answer(key, say(sender, plan.reply));
    }
    if (plan.action === 'text') {
      await onText(sender, account, key, plan.text);
      return bot.finishJob(job);
    }

    const ownerKey = account.ownerKey;
    const globalId = telegramGlobalId(key);
    const track = () =>
      state.recordSaved({ ownerKey, globalId, userId: sender.userId, savedAt: now() });
    const saved = async (item: StoredItem) => {
      await bot.finishJob(job);
      // A deleted item stays deleted; a retry only completes what was started.
      if (item.deleted) return;
      if (await bot.claimReply(key)) await batches.add(sender.ownerKey, sender, item.title);
    };
    const earlier = await store.getItem(ownerKey, globalId);
    if (earlier) {
      if (!earlier.deleted) await track();
      return saved(earlier);
    }

    let content;
    try {
      content = await contentOf(plan);
    } catch (cause) {
      if (!(cause instanceof Refusal)) throw cause;
      await bot.finishJob(job);
      return answer(key, say(sender, cause.reply));
    }
    const description = {
      globalId,
      kind: plan.kind,
      title: plan.title,
      mimeType: content.mimeType,
      byteLength: content.bytes.length,
      contentSha256: createHash('sha256').update(content.bytes).digest('hex'),
      createdAt: createdAtOf(message, now() * 1000),
      ...(plan.kind === 'note' && plan.sourceUrl ? { sourceUrl: plan.sourceUrl } : {}),
    };
    if (!validateCloudItem(description).ok) {
      await bot.finishJob(job);
      const name = plan.kind === 'note' ? undefined : plan.fileName;
      return answer(
        key,
        say(
          sender,
          content.bytes.length ? TELEGRAM_REPLIES.notSaved(name) : TELEGRAM_REPLIES.empty(name),
        ),
      );
    }
    const outcome = await storeChatItem({
      bot,
      store,
      objects,
      job,
      ownerKey,
      description,
      bytes: content.bytes,
      quotaBytes: options.quotaBytes,
      now: now(),
      canStore: () => canStore(sender, ownerKey),
      // Recorded with the item, so /delete always finds what was saved here.
      afterPublish: track,
    });
    if ('cancelled' in outcome) {
      // Not stored and not answered (/delete, /logout or /stop meanwhile); the content goes too.
      await bot.finishJob(job);
      await bot.forgetMessage(key);
      return;
    }
    if ('full' in outcome) {
      await bot.finishJob(job);
      const name = plan.kind === 'note' ? undefined : plan.fileName;
      return answer(key, say(sender, TELEGRAM_REPLIES.full(name, options.quotaBytes)));
    }
    if ('existing' in outcome && !outcome.existing.deleted) await track();
    return saved('item' in outcome ? outcome.item : outcome.existing);
  }

  /**
   * Tells the student once that a saved item could not be made searchable, and why: the reason
   * the engine host gave (too many pages, a password, …) with what to do about it.
   */
  async function indexFailed(job: BotJob, cause: unknown) {
    const failedJob = await bot.getJob(job.id);
    if (failedJob?.state !== 'failed' || failedJob.attempts !== job.attempts) return;
    const inbound = await bot.getInbound(job.wamid);
    const sender = inbound && (await bot.getSender(inbound.senderId));
    const item = await store.getItem(job.ownerKey, telegramGlobalId(job.wamid));
    if (!sender || !item || item.deleted) return;
    const reply = TELEGRAM_REPLIES.notSearchable(
      classifyIndexFailure(cause),
      item,
      options.quotaBytes,
    );
    await say(sender, reply)().catch(failed);
  }

  /**
   * An index job, timed and logged, with "typing…" in the chat of the student who sent the file
   * while it runs (a search they type meanwhile waits for the engine).
   */
  async function indexJob(job: BotJob) {
    const started = performance.now();
    const inbound = await bot.getInbound(job.wamid);
    const sender = inbound && (await bot.getSender(inbound.senderId));
    const stopTyping = sender ? typing(Number(sender.userId)) : async () => undefined;
    indexingNow.set(job.ownerKey, (indexingNow.get(job.ownerKey) ?? 0) + 1);
    try {
      await options.onIndexJob!(job);
    } finally {
      const left = (indexingNow.get(job.ownerKey) ?? 1) - 1;
      if (left > 0) indexingNow.set(job.ownerKey, left);
      else indexingNow.delete(job.ownerKey);
      lastIndexEnd.set(job.ownerKey, performance.now());
      if (lastIndexEnd.size > 1000) {
        // Only ends newer than a search still running matter; old ones go.
        const cutoff = performance.now() - 600_000;
        for (const [owner, at] of lastIndexEnd) if (at < cutoff) lastIndexEnd.delete(owner);
      }
      await stopTyping();
      log(`Telegram index job took ${seconds(performance.now() - started)} s`);
    }
  }

  const makeRunner = (kinds: JobKind[]) =>
    createJobRunner({
      bot,
      kinds,
      now,
      leaseSeconds: options.leaseSeconds ?? 300,
      maxAttempts: options.maxAttempts ?? 6,
      retryDelay: options.retryDelaySeconds ?? defaultRetryDelay,
      log,
      label: 'Telegram',
      async run(job) {
        if (job.kind === 'ingest') {
          const wait = senders.take(job.ownerKey);
          if (wait) return bot.deferJob(job, now() + wait);
          await ingest(job);
        } else {
          await indexJob(job);
          await bot.finishJob(job);
        }
      },
      async gaveUp(job, cause) {
        if (job.kind === 'ingest') {
          const inbound = await bot.getInbound(job.wamid);
          const sender = inbound && (await bot.getSender(inbound.senderId));
          // A file Telegram would not hand over, or a problem on our side (storage, search).
          const reply =
            cause instanceof TelegramDownloadError
              ? TELEGRAM_REPLIES.downloadFailed
              : TELEGRAM_REPLIES.serverError;
          if (inbound && sender) await answer(job.wamid, say(sender, reply));
        } else await indexFailed(job, cause);
      },
    });
  const runner = makeRunner(kinds);

  return {
    ...runner,
    /** Runs one due message (ingest job), leaving index jobs to `runIndexOnce`. */
    runIngestOnce: makeRunner(['ingest']).runOnce,
    /** Runs one due index job; undefined without an indexer. */
    runIndexOnce: options.onIndexJob ? makeRunner(['index']).runOnce : undefined,
    /** Sends every waiting confirmation now and waits for those already being sent. */
    flush: () => batches.flush(),
    search,
  };
}

/**
 * Answers someone outside the demo's allowed users (`PILOT_TELEGRAM_ALLOWED_USERS`) that the bot
 * is not open yet. Nothing of theirs is stored, so this is sent from the intake, not the queue.
 */
export function refuseTelegramUser(
  api: TelegramApi,
  refused: { chatId: number; callbackQueryId?: string },
  log: (message: string, detail?: unknown) => void = (message, detail) =>
    console.error(message, detail),
) {
  const failed = (cause: unknown) => log('Telegram reply failed', describeFailure(cause));
  return refused.callbackQueryId
    ? api.answerCallbackQuery(refused.callbackQueryId, 'Not open yet.').catch(failed)
    : api.sendMessage(refused.chatId, TELEGRAM_REPLIES.notOpen).catch(failed);
}

/** The bot as one unit in this process; `stop` sends any waiting confirmations first. */
export function startTelegramBot(options: TelegramBotOptions & { idleMs?: number }) {
  const telegram = createTelegramBot(options);
  const loopOptions = {
    idleMs: options.idleMs ?? 5000,
    log: options.log ?? ((message: string, detail?: unknown) => console.error(message, detail)),
    label: 'Telegram',
  };
  // Index jobs run in their own loop, so a search is never queued behind a file being indexed:
  // it runs at once (with "typing…") and only its engine call waits.
  const indexRunOnce = telegram.runIndexOnce;
  const indexLoop = indexRunOnce ? startJobLoop(indexRunOnce, loopOptions) : undefined;
  const ingestLoop = startJobLoop(async () => {
    const worked = await telegram.runIngestOnce();
    // A saved file may have queued an index job.
    if (worked) indexLoop?.wake();
    return worked;
  }, loopOptions);
  return {
    ...telegram,
    wake() {
      ingestLoop.wake();
      indexLoop?.wake();
    },
    async stop() {
      await Promise.all([ingestLoop.stop(), indexLoop?.stop()]);
      await telegram.flush();
    },
  };
}
