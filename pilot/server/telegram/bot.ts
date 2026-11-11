/// <reference types="node" />
// The Telegram bot (docs/pilot/telegram.md): consent before anything is stored (T1), commands and
// buttons, saving files and notes into the sender's vault (T2), at most one item and one reply per
// message (T3), search replies with result buttons that send the original back (T8), one-time app
// links (T6) and /delete (T9). The queue, saving, search, sending back, batching and erasing are
// the shared chat core (../chat/), as for WhatsApp; this file holds what differs: Telegram's
// messages, commands, buttons and downloads.
import { createHash, randomBytes } from 'node:crypto';
import { LIMITS } from '../../../src/shared';
import { validateCloudItem } from '../../contract';
import { createSaveBatches, realSchedule } from '../chat/batch';
import { clip, type ChatChannel } from '../chat/channel';
import { eraseOwner } from '../chat/erase';
import { NOTE_MIME, storeChatItem } from '../chat/items';
import { PermanentJobError, createJobRunner, defaultRetryDelay, startJobLoop } from '../chat/jobs';
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
} from './api';
import { createTelegramLink } from './links';
import {
  createdAtOf,
  isTypedAgree,
  planTelegramMessage,
  commandOf,
  type TelegramPlan,
} from './plan';
import { describeFailure } from './poller';
import {
  telegramGlobalId,
  type TelegramInbound,
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

const quote = (query: string) => `“${clip(query, 60)}”`;

export const TELEGRAM_REPLIES = {
  notice: (privacyUrl: string) =>
    [
      'Hi! This is Campus Recall. Send or forward photos, PDFs and notes here to keep them in your own library, then search them here or in the app.',
      '',
      '• We save the photos, PDFs and notes you send here, and the searches you type.',
      '• Our server stores and processes your files to make them searchable, and sees your searches.',
      '• Telegram keeps bot chats on its own servers. Chats with bots are not end-to-end encrypted.',
      '• You must be 18 or older to use this.',
      '• Send /delete at any time to erase everything.',
      '',
      `Privacy: ${privacyUrl}`,
      '',
      'Tap Agree (or reply AGREE) to start.',
    ].join('\n'),
  agreeButton: 'Agree',
  agreed:
    "You're all set. Anything you sent before this wasn't saved, so please send it again. Send /help to see what I can do.",
  alreadyAgreed: "You're already set up. Send /help to see what I can do.",
  help: (contactEmail: string) =>
    [
      "Send or forward photos, PDFs and notes to save them. Photos keep their full quality when you send them as a file. Start a message with 'note ' to save it as a note, or send a single link. Type anything else to search what you saved.",
      '',
      '/open: open your library in the app',
      '/privacy: how your data is handled',
      '/stop and /resume: pause or resume the bot',
      '/delete: erase everything',
      '',
      `Questions: ${contactEmail}`,
    ].join('\n'),
  privacy: (privacyUrl: string) => `How Campus Recall handles your data: ${privacyUrl}`,
  stopped:
    "Stopped. I won't save anything or reply until you send /resume. What you saved is kept; send /resume and then /delete to erase it.",
  started: "Welcome back. I'm saving and replying again.",
  alreadyOn: "I'm already on. Send /help to see what I can do.",
  tapAgree: 'Tap Agree on the notice first.',
  resumeFirst: 'Send /resume first.',
  deleteAsk:
    'This erases everything you saved here, also from the app, and signs out app links. Tap the button within 10 minutes to go ahead.',
  deleteButton: 'Yes, erase everything',
  deleted:
    'Done. Everything you saved here is erased and the app is signed out. Send any message to start again.',
  deleteExpired:
    'That request has expired. Send /delete again if you still want to erase everything.',
  deleteNotAsked: 'Send /delete first if you want to erase everything.',
  nothingStored: 'Nothing is saved for you yet.',
  open: 'Open your Telegram library in Campus Recall. The link works once, for 10 minutes.',
  openButton: 'Open in app',
  noLinks:
    "App links need the pilot's HTTPS address. In a local trial, start it again with --origin https://<tunnel host>, then send /open.",
  savedMany: (titles: string[]) =>
    `Saved ${titles.length} items to Campus Recall: ${titles.map((t) => clip(t, 40)).join(', ')}`,
  results: (query: string) => `Best matches for ${quote(query)}. Tap one to get it back.`,
  keywordOnly: 'Matched by keyword only right now.',
  noResults: (query: string, keywordOnly: boolean) =>
    `Nothing matched ${quote(query)} (only things you sent here are searched).${
      keywordOnly ? ' Search by meaning is off right now, so only titles were matched.' : ''
    }`,
  gone: "That item isn't in your library any more.",
  expired: 'That result has expired. Search again to get it.',
  appOnly: "This one can't be sent in Telegram. Open it in the app instead.",
  openCta: 'Open it in Campus Recall. The link works once, for 10 minutes.',
  noteTooLong: '(Cut short here; open it in the app to read the rest.)',
  unknownCommand: "I don't know that command. Send /help to see what I can do.",
  notOpen:
    "Campus Recall on Telegram isn't open to everyone yet, so nothing you send here is saved. Thanks for your interest!",
};

/** Button data: consent, the delete confirmation, and a search result (`p:<token>`). */
const AGREE = 'agree';
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
    sendText: (to, text) => api.sendMessage(to.chatId, fitTelegram(text, TELEGRAM_LIMITS.text)),
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
    sendOpenButton: (to, url) =>
      api.sendMessage(to.chatId, TELEGRAM_REPLIES.openCta, {
        inline_keyboard: [[{ text: TELEGRAM_REPLIES.openButton, url }]],
      }),
  };
}

export interface TelegramBotOptions {
  bot: BotStore;
  /** The polling offset and result buttons. */
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
  /** The pilot site, for app links: `https://…`, no trailing path. */
  origin: string;
  /**
   * False when the origin cannot be opened from a phone (a local trial without a tunnel): /open
   * then says so, and no "Open in app" button is sent.
   */
  appLinks?: boolean;
  privacyUrl: string;
  contactEmail: string;
  /** Stored with each consent. */
  noticeVersion: string;
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
  log?: (message: string, detail?: unknown) => void;
}

/** A message the bot will not save, with the reason it gives. */
class Refusal extends Error {
  constructor(readonly reply: string) {
    super(reply);
  }
}

type SavePlan = Extract<TelegramPlan, { action: 'save' }>;

/** The indexer for Telegram items, whose global IDs come from Telegram message keys. */
export const createTelegramIndexer = (options: Omit<WhatsAppIndexerOptions, 'globalIdOf'>) =>
  createWhatsAppIndexer({ ...options, globalIdOf: (job) => telegramGlobalId(job.wamid) });

export function createTelegramBot(options: TelegramBotOptions) {
  const { bot, state, store, objects, api } = options;
  const now = options.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  const log = options.log ?? ((message, detail) => console.error(message, detail));
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
  const addressOf = (sender: TelegramSender): TelegramAddress => ({
    chatId: Number(sender.userId),
    ownerKey: sender.ownerKey,
  });
  const failed = (cause: unknown) => log('Telegram reply failed', describeFailure(cause));

  /**
   * Answers a message or tap at most once, whoever processes it: the answer is claimed before it
   * is sent, so a crash right after can lose it but nothing ever sends it twice.
   */
  async function answer(key: string, send: () => Promise<void>) {
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
    send: (sender, titles) =>
      say(
        sender,
        titles.length === 1 ? REPLIES.saved(titles[0]) : TELEGRAM_REPLIES.savedMany(titles),
      )(),
    batchMs: options.batchMs ?? 3000,
    batchMax: options.batchMax ?? 10,
    schedule: options.schedule ?? realSchedule,
    log,
    failedMessage: 'Telegram reply failed',
  });

  /** Saving needs consent and no /stop; checked again under the owner's lock. */
  async function canStore(sender: TelegramSender) {
    const current = await bot.senderState(sender.userId);
    return current.consentedAt !== undefined && current.stoppedAt === undefined;
  }

  /** The consent notice with its Agree button; given back when it could not be sent. */
  async function sendNotice(sender: TelegramSender, key: string, claimed: boolean) {
    await answer(key, async () => {
      try {
        await say(sender, TELEGRAM_REPLIES.notice(options.privacyUrl), {
          inline_keyboard: [[{ text: TELEGRAM_REPLIES.agreeButton, callback_data: AGREE }]],
        })();
      } catch (cause) {
        if (claimed) await bot.releaseNotice(sender.userId);
        throw cause;
      }
    });
  }

  /** Erases the sender's vault, sessions, links and result buttons (T9). */
  async function eraseEverything(sender: TelegramSender) {
    batches.drop(sender.ownerKey);
    await eraseOwner({
      store,
      objects,
      bot,
      userId: sender.userId,
      ownerKey: sender.ownerKey,
      more: () => state.forgetOwner(sender.ownerKey),
    });
  }

  /**
   * Consent, /stop, commands and buttons. True means the message or tap was dealt with: nothing
   * is saved and the worker only finishes the job.
   */
  async function gate(sender: TelegramSender, key: string, inbound: TelegramInbound) {
    const current = await bot.senderState(sender.userId);
    const callback = inbound.callback_query;
    const message = inbound.message;
    const command = message ? commandOf(message) : undefined;
    const data = callback?.data;
    const reply = (text: string, keyboard?: InlineKeyboard) =>
      answer(key, say(sender, text, keyboard));

    if (current.stoppedAt !== undefined) {
      // Stopped: nothing is saved or answered except /resume (or /start).
      if (command?.name === 'resume' || command?.name === 'start') {
        await bot.setStopped(sender.userId, undefined);
        // A /stop sent before agreeing: starting again still needs consent.
        if (current.consentedAt === undefined) {
          const claimed = await bot.claimNotice(sender.userId, now());
          await sendNotice(sender, key, claimed);
        } else await reply(TELEGRAM_REPLIES.started);
      } else {
        await bot.forgetMessage(key);
        await acknowledge(callback, TELEGRAM_REPLIES.resumeFirst);
      }
      return true;
    }

    if (current.consentedAt === undefined) {
      // Before Agree nothing is kept: not the item, and not the message's content.
      await bot.forgetMessage(key);
      const agree = data === AGREE || isTypedAgree(message);
      if (agree && current.noticeSentAt !== undefined) {
        await bot.setConsent(sender.userId, now(), options.noticeVersion);
        await acknowledge(callback);
        await reply(TELEGRAM_REPLIES.agreed);
        return true;
      }
      if (callback && !agree) {
        await acknowledge(callback, TELEGRAM_REPLIES.tapAgree);
        return true;
      }
      switch (command?.name) {
        case 'help':
          await reply(TELEGRAM_REPLIES.help(options.contactEmail));
          return true;
        case 'privacy':
          await reply(TELEGRAM_REPLIES.privacy(options.privacyUrl));
          return true;
        case 'delete':
          await reply(TELEGRAM_REPLIES.nothingStored);
          return true;
        case 'stop':
          await bot.setStopped(sender.userId, now());
          await reply(TELEGRAM_REPLIES.stopped);
          return true;
        case 'start':
        case 'resume': {
          // Asked for: the notice again, even when it was sent before.
          const claimed = await bot.claimNotice(sender.userId, now());
          await sendNotice(sender, key, claimed);
          return true;
        }
      }
      // The notice goes out once; later messages before Agree get no answer.
      if (await bot.claimNotice(sender.userId, now())) await sendNotice(sender, key, true);
      await acknowledge(callback);
      return true;
    }

    if (callback) {
      if (data === AGREE) {
        await acknowledge(callback, TELEGRAM_REPLIES.alreadyAgreed);
        return true;
      }
      await acknowledge(callback);
      if (data === DELETE) {
        await confirmDelete(sender, key, current.deleteRequestedAt);
        return true;
      }
      const token = data && PICK.exec(data)?.[1];
      if (token) await pick(sender, key, token);
      return true;
    }

    if (isTypedAgree(message)) {
      await reply(TELEGRAM_REPLIES.alreadyAgreed);
      return true;
    }
    if (!command) return false;
    switch (command.name) {
      case 'start':
      case 'resume':
        await reply(TELEGRAM_REPLIES.alreadyOn);
        return true;
      case 'help':
        await reply(TELEGRAM_REPLIES.help(options.contactEmail));
        return true;
      case 'privacy':
        await reply(TELEGRAM_REPLIES.privacy(options.privacyUrl));
        return true;
      case 'stop':
        await bot.setStopped(sender.userId, now());
        await reply(TELEGRAM_REPLIES.stopped);
        return true;
      case 'open':
        // The link is made only once the reply is claimed, so a retried job leaves no spare one.
        await answer(key, async () => {
          if (!appLinks) return say(sender, TELEGRAM_REPLIES.noLinks)();
          const url = await createTelegramLink(bot, sender, options.origin, now());
          await say(sender, TELEGRAM_REPLIES.open, {
            inline_keyboard: [[{ text: TELEGRAM_REPLIES.openButton, url }]],
          })();
        });
        return true;
      case 'delete':
        await bot.setDeleteRequest(sender.userId, now());
        await reply(TELEGRAM_REPLIES.deleteAsk, {
          inline_keyboard: [[{ text: TELEGRAM_REPLIES.deleteButton, callback_data: DELETE }]],
        });
        return true;
      default:
        await reply(TELEGRAM_REPLIES.unknownCommand);
        return true;
    }
  }

  /** The delete button: erases everything when /delete came within 10 minutes (T9). */
  async function confirmDelete(sender: TelegramSender, key: string, asked: number | undefined) {
    const reply = (text: string) => answer(key, say(sender, text));
    if (asked === undefined) return reply(TELEGRAM_REPLIES.deleteNotAsked);
    if (now() - asked > DELETE_CONFIRM_SECONDS) {
      await bot.setDeleteRequest(sender.userId, undefined);
      return reply(TELEGRAM_REPLIES.deleteExpired);
    }
    await eraseEverything(sender);
    await reply(TELEGRAM_REPLIES.deleted);
  }

  /** A result button: the original back in the chat, then a link to open the app. */
  async function pick(sender: TelegramSender, key: string, token: string) {
    const found = await state.getPick(token, now());
    if (!found) return answer(key, say(sender, TELEGRAM_REPLIES.expired));
    await sendBack({
      store,
      objects,
      channel,
      replies: TELEGRAM_REPLIES,
      ownerKey: sender.ownerKey,
      // Only this owner's buttons count; another owner's token finds nothing here.
      picked:
        found.ownerKey === sender.ownerKey
          ? { globalId: found.globalId, location: found.location }
          : undefined,
      to: addressOf(sender),
      answer: (send) => answer(key, send),
      link: async () =>
        appLinks ? createTelegramLink(bot, sender, options.origin, now()) : undefined,
    });
  }

  /** Search results for an owner: by meaning when the engine is there, plus keyword matches. */
  const search = (ownerKey: string, query: string) =>
    searchOwner(
      {
        store,
        objects,
        engine: options.engine,
        supportedIndexVersions: options.supportedIndexVersions,
        log,
        fallbackMessage: 'Telegram search fell back to keywords',
      },
      ownerKey,
      query,
    );

  async function onText(sender: TelegramSender, key: string, query: string) {
    const { rows, keywordOnly } = await search(sender.ownerKey, clip(query, 500));
    await answer(key, async () => {
      if (!rows.length) return say(sender, TELEGRAM_REPLIES.noResults(query, keywordOnly))();
      await channel.sendResults(addressOf(sender), query, rows, keywordOnly);
    });
  }

  /** The bytes to store; files are fetched from Telegram and checked against the declared size. */
  async function contentOf(plan: SavePlan) {
    if (plan.kind === 'note') {
      if (Array.from(plan.text).length > LIMITS.maxTextCodePoints)
        throw new Refusal(REPLIES.longNote);
      return { bytes: new TextEncoder().encode(plan.text), mimeType: NOTE_MIME };
    }
    const limit = plan.kind === 'image' ? LIMITS.maxImageBytes : LIMITS.maxPdfBytes;
    const tooBig = new Refusal(plan.kind === 'image' ? REPLIES.bigImage : REPLIES.bigPdf);
    // Telegram states the size up front; a file over the app's limit is not even looked up.
    if (plan.media.fileSize !== undefined && plan.media.fileSize > limit) throw tooBig;
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
        throw tooBig;
      throw cause;
    }
    if (!file.filePath) throw new Error('Telegram gave no file path for this file.');
    const size = file.fileSize ?? plan.media.fileSize;
    if (size !== undefined && size > limit) throw tooBig;
    let bytes;
    try {
      bytes = await api.download(file.filePath, limit);
    } catch (cause) {
      if (cause instanceof MediaTooLargeError) throw tooBig;
      throw cause;
    }
    // Telegram sends no hash: the size it declared must match, and the item's SHA-256 is computed
    // here from these bytes. Retried: a damaged download is fetched again next time.
    if (size !== undefined && bytes.length !== size)
      throw new Error('Downloaded bytes do not match the size Telegram declared.');
    return { bytes, mimeType: plan.mimeType };
  }

  async function ingest(job: BotJob) {
    const inbound = await bot.getInbound(job.wamid);
    const sender = inbound && (await bot.getSender(inbound.senderId));
    if (!inbound || !sender) return bot.finishJob(job);
    const key = inbound.wamid;
    const record = inbound.message as TelegramInbound;
    if (await gate(sender, key, record)) return bot.finishJob(job);
    const message: TgMessage | undefined = record.message;
    if (!message) return bot.finishJob(job);
    const plan = planTelegramMessage(message);
    if (plan.action === 'ignore' || plan.action === 'command') return bot.finishJob(job);
    if (plan.action === 'refuse') {
      await bot.finishJob(job);
      return answer(key, say(sender, plan.reply));
    }
    if (plan.action === 'text') {
      await onText(sender, key, plan.text);
      return bot.finishJob(job);
    }

    const globalId = telegramGlobalId(key);
    const saved = async (item: StoredItem) => {
      await bot.finishJob(job);
      // A deleted item stays deleted; a retry only completes what was started.
      if (item.deleted) return;
      if (await bot.claimReply(key)) await batches.add(sender.ownerKey, sender, item.title);
    };
    const earlier = await store.getItem(inbound.ownerKey, globalId);
    if (earlier) return saved(earlier);

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
      return answer(key, say(sender, content.bytes.length ? REPLIES.failed : REPLIES.empty));
    }
    const outcome = await storeChatItem({
      bot,
      store,
      objects,
      job,
      ownerKey: inbound.ownerKey,
      description,
      bytes: content.bytes,
      quotaBytes: options.quotaBytes,
      now: now(),
      canStore: () => canStore(sender),
    });
    if ('cancelled' in outcome) {
      // Not stored and not answered (/delete or /stop meanwhile); the content goes too.
      await bot.finishJob(job);
      await bot.forgetMessage(key);
      return;
    }
    if ('full' in outcome) {
      await bot.finishJob(job);
      return answer(key, say(sender, REPLIES.full));
    }
    return saved('item' in outcome ? outcome.item : outcome.existing);
  }

  /** Tells the student once that a saved item could not be made searchable. */
  async function indexFailed(job: BotJob, text?: string) {
    const failedJob = await bot.getJob(job.id);
    if (failedJob?.state !== 'failed' || failedJob.attempts !== job.attempts) return;
    const inbound = await bot.getInbound(job.wamid);
    const sender = inbound && (await bot.getSender(inbound.senderId));
    const item = await store.getItem(job.ownerKey, telegramGlobalId(job.wamid));
    if (!sender || !item || item.deleted) return;
    await say(sender, text ?? REPLIES.notSearchable(item.title))().catch(failed);
  }

  const runner = createJobRunner({
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
        await options.onIndexJob!(job);
        await bot.finishJob(job);
      }
    },
    async gaveUp(job, cause) {
      if (job.kind === 'ingest') {
        const inbound = await bot.getInbound(job.wamid);
        const sender = inbound && (await bot.getSender(inbound.senderId));
        if (inbound && sender) await answer(job.wamid, say(sender, REPLIES.failed));
      } else await indexFailed(job, cause instanceof PermanentJobError ? cause.reply : undefined);
    },
  });

  return {
    ...runner,
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
  const loop = startJobLoop(telegram.runOnce, {
    idleMs: options.idleMs ?? 5000,
    log: options.log ?? ((message, detail) => console.error(message, detail)),
    label: 'Telegram',
  });
  return {
    ...telegram,
    wake: loop.wake,
    async stop() {
      await loop.stop();
      await telegram.flush();
    },
  };
}
