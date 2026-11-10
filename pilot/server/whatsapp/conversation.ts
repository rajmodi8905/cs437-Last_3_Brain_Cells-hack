/// <reference types="node" />
// The WhatsApp bot's conversation (docs/pilot/whatsapp.md): consent before anything is stored
// (W1), the commands, one confirmation for a burst of saves, search replies that send the
// original back (W8), one-time app links (W6) and DELETE ALL (W9). It plugs into the worker
// through its `gate`, `onText` and `onSaved` hooks; without them the worker behaves as before.
import type { SourceLocation } from '../../../src/shared';
import type { ObjectStore, PilotStore, StoredItem } from '../store';
import { resetOwnerVault } from '../vault-reset';
import type { EngineHost } from './engine-host';
import type { GraphClient } from './graph';
import { ownerSearchItems } from './indexer';
import {
  addressOf,
  REPLIES as INGEST_REPLIES,
  startWhatsAppWorker,
  type GateHook,
  type TextHook,
  type WhatsAppWorkerOptions,
} from './ingest';
import { createOpenLink } from './links';
import type { BotStore, WaMessage, WhatsAppSender } from './store';

/** CONFIRM DELETE must follow DELETE ALL within this many seconds. */
export const DELETE_CONFIRM_SECONDS = 600;
/** Meta's limits for interactive messages (cloud-api-mechanics.md). */
export const META_LIMITS = {
  listRows: 10,
  rowTitle: 24,
  rowDescription: 72,
  rowId: 200,
  listButton: 20,
  sectionTitle: 24,
  footer: 60,
  ctaLabel: 20,
  caption: 1024,
  text: 4096,
};
/** Results in a search reply; the app shows five too. */
const MAX_RESULTS = 5;
/** WhatsApp sends photos up to 5 MB as images; larger ones go as documents. */
const MAX_IMAGE_SEND_BYTES = 5 * 1024 * 1024;
const SEND_AS_IMAGE = new Set(['image/jpeg', 'image/png']);

export interface ConversationOptions {
  bot: BotStore;
  store: PilotStore;
  objects: ObjectStore;
  graph: GraphClient;
  /** Searches by meaning when set; otherwise search is by keyword only, and says so. */
  engine?: EngineHost;
  /** The pilot site, for app links: `https://…`, no trailing path. */
  origin: string;
  privacyUrl: string;
  contactEmail: string;
  /** Stored with each consent, so a changed notice can be told apart later. */
  noticeVersion: string;
  /** Saves confirmed together when they arrive within this long of each other; 3 seconds. */
  batchMs?: number;
  /** A burst's confirmation goes out once it has this many items; 10. */
  batchMax?: number;
  supportedIndexVersions?: readonly string[];
  nowSeconds?: () => number;
  log?: (message: string, detail?: unknown) => void;
}

const codePoints = (text: string) => Array.from(text);
/** At most `max` code points, ending in an ellipsis when cut. */
export function clip(text: string, max: number) {
  const flat = text.replace(/\s+/g, ' ').trim();
  const points = codePoints(flat);
  return points.length <= max
    ? flat
    : `${points
        .slice(0, max - 1)
        .join('')
        .trimEnd()}…`;
}
const quote = (query: string) => `“${clip(query, 60)}”`;

export const BOT_REPLIES = {
  notice: (privacyUrl: string) =>
    [
      'Hi! This is Campus Recall. Send or forward photos, PDFs and notes here to keep them in your own library, then search them here or in the app.',
      '',
      '• We save the photos, PDFs and notes you send here, and the searches you type.',
      '• WhatsApp (Meta) decrypts messages to pass them to us and may keep them for up to 30 days.',
      '• Our server stores and processes your files and searches.',
      '• You must be 18 or older to use this.',
      '• Send DELETE ALL at any time to erase everything.',
      '',
      `Privacy: ${privacyUrl}`,
      '',
      'Reply AGREE to start.',
    ].join('\n'),
  agreed:
    "You're all set. Anything you sent before this wasn't saved, so please send it again. Send HELP to see what I can do.",
  alreadyAgreed: "You're already set up. Send HELP to see what I can do.",
  help: (contactEmail: string) =>
    [
      "Send or forward photos, PDFs and notes to save them. Start a message with 'note ' to save it as a note. Type anything else to search what you saved.",
      '',
      'OPEN: open your library in the app',
      'PRIVACY: how your data is handled',
      'STOP / START: pause or resume the bot',
      'DELETE ALL: erase everything',
      '',
      `Questions: ${contactEmail}`,
    ].join('\n'),
  privacy: (privacyUrl: string) => `How Campus Recall handles your data: ${privacyUrl}`,
  stopped:
    "Stopped. I won't save anything or reply until you send START. What you saved is kept; send START and then DELETE ALL to erase it.",
  started: "Welcome back. I'm saving and replying again.",
  alreadyOn: "I'm already on. Send HELP to see what I can do.",
  deleteAsk:
    'This erases everything you saved here, also from the app, and signs out app links. Reply CONFIRM DELETE within 10 minutes to go ahead.',
  deleted:
    'Done. Everything you saved here is erased and the app is signed out. Send any message to start again.',
  deleteExpired:
    'That request has expired. Send DELETE ALL again if you still want to erase everything.',
  deleteNotAsked: 'Send DELETE ALL first if you want to erase everything.',
  nothingStored: 'Nothing is saved for you yet.',
  open: (url: string) =>
    `Open your WhatsApp library in Campus Recall: ${url}\nThe link works once, for 10 minutes.`,
  savedMany: (titles: string[]) =>
    `Saved ${titles.length} items to Campus Recall: ${titles.map((t) => clip(t, 40)).join(', ')}`,
  results: (query: string) => `Best matches for ${quote(query)}. Pick one to get it back.`,
  keywordOnly: 'Matched by keyword only right now.',
  noResults: (query: string, keywordOnly: boolean) =>
    `Nothing matched ${quote(query)} (only things you sent here are searched).${
      keywordOnly ? ' Search by meaning is off right now, so only titles were matched.' : ''
    }`,
  gone: "That item isn't in your library any more.",
  openCta: 'Open it in Campus Recall. The link works once, for 10 minutes.',
  noteTooLong: '(Cut short here; open it in the app to read the rest.)',
};

/** Commands match the whole message, ignoring case, extra spaces and a final full stop. */
const COMMANDS = [
  'AGREE',
  'HELP',
  'PRIVACY',
  'STOP',
  'START',
  'DELETE ALL',
  'CONFIRM DELETE',
  'OPEN',
] as const;
type Command = (typeof COMMANDS)[number];
export function commandOf(message: WaMessage): Command | undefined {
  if (message.type !== 'text') return undefined;
  if (message.context?.forwarded || message.context?.frequently_forwarded) return undefined;
  const text = (message.text?.body ?? '')
    .trim()
    .replace(/[.!]+$/, '')
    .replace(/\s+/g, ' ')
    .toUpperCase();
  return COMMANDS.find((command) => command === text);
}

/** A result row's ID: the global ID and the location, so a pick returns exactly that place. */
export function rowId(globalId: string, location: SourceLocation) {
  const where =
    location.kind === 'page'
      ? `p${location.page}`
      : location.kind === 'time'
        ? `t${location.startMs}-${location.endMs}`
        : 'w';
  return `${globalId}|${where}`;
}
export function parseRowId(id: string): { globalId: string; location: SourceLocation } | undefined {
  const match = /^([0-9a-f-]{36})\|(?:w|p(\d{1,6})|t(\d{1,12})-(\d{1,12}))$/.exec(id);
  if (!match) return undefined;
  const location: SourceLocation = match[2]
    ? { kind: 'page', page: Number(match[2]) }
    : match[3]
      ? { kind: 'time', startMs: Number(match[3]), endMs: Number(match[4]) }
      : { kind: 'whole' };
  return { globalId: match[1], location };
}

const KIND_LABEL: Record<string, string> = {
  pdf: 'PDF',
  image: 'Photo',
  note: 'Note',
  audio: 'Audio',
  video: 'Video',
};
const where = (location: SourceLocation) =>
  location.kind === 'page'
    ? `p. ${location.page}`
    : location.kind === 'time'
      ? `at ${Math.floor(location.startMs / 60000)}:${String(Math.floor(location.startMs / 1000) % 60).padStart(2, '0')}`
      : undefined;

/** One row of a search reply. */
export interface ResultRow {
  globalId: string;
  location: SourceLocation;
  title: string;
  description: string;
}

/** Lowercase words of three or more letters or digits, for keyword matching. */
const words = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= 3 || /^\d+$/.test(word)),
  );
/** How many of the query's words the title contains; 0 means no match. */
export function keywordScore(query: string, title: string) {
  const inTitle = [...words(title)];
  let score = 0;
  for (const word of words(query)) if (inTitle.some((w) => w.startsWith(word))) score++;
  return score;
}

/** The interactive list Meta shows for a search, within its limits. */
export function resultsList(query: string, rows: ResultRow[], keywordOnly: boolean) {
  return {
    type: 'list',
    body: { text: clip(BOT_REPLIES.results(query), META_LIMITS.text) },
    ...(keywordOnly ? { footer: { text: clip(BOT_REPLIES.keywordOnly, META_LIMITS.footer) } } : {}),
    action: {
      button: clip('See results', META_LIMITS.listButton),
      sections: [
        {
          title: clip('Results', META_LIMITS.sectionTitle),
          rows: rows.slice(0, Math.min(MAX_RESULTS, META_LIMITS.listRows)).map((row) => ({
            id: rowId(row.globalId, row.location),
            title: clip(row.title, META_LIMITS.rowTitle),
            description: clip(row.description, META_LIMITS.rowDescription),
          })),
        },
      ],
    },
  };
}

const EXTENSIONS: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};
const fileName = (item: StoredItem) => {
  const base = item.title.replace(/[\\/:*?"<>|\n\r\t]+/g, ' ').trim() || 'Campus Recall';
  const extension = EXTENSIONS[item.mimeType] ?? '';
  return base.toLowerCase().endsWith(extension) ? base : `${base}${extension}`;
};

export function createWhatsAppConversation(options: ConversationOptions) {
  const { bot, store, objects, graph } = options;
  const now = options.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  const log = options.log ?? ((message, detail) => console.error(message, detail));
  const batchMs = options.batchMs ?? 3000;
  const batchMax = options.batchMax ?? 10;

  /** Claims the message's one reply, then sends; a failed send is logged, never repeated. */
  async function answer(wamid: string, sender: WhatsAppSender, send: () => Promise<void>) {
    if (!(await bot.claimReply(wamid))) return;
    await send().catch((cause: unknown) => log('WhatsApp reply failed', cause));
  }
  const text = (sender: WhatsAppSender, body: string) => async () => {
    const to = addressOf(sender);
    if (to) await graph.sendText(to, body);
  };

  // Batched confirmations: the reply of each saved message is claimed before it waits here, so
  // a crash can lose a confirmation but nothing is ever confirmed twice.
  const batches = new Map<
    string,
    { sender: WhatsAppSender; titles: string[]; timer?: ReturnType<typeof setTimeout> }
  >();
  async function sendBatch(ownerKey: string) {
    const batch = batches.get(ownerKey);
    if (!batch) return;
    batches.delete(ownerKey);
    clearTimeout(batch.timer);
    const body =
      batch.titles.length === 1
        ? INGEST_REPLIES.saved(batch.titles[0])
        : BOT_REPLIES.savedMany(batch.titles);
    await text(batch.sender, clip(body, META_LIMITS.text))().catch((cause: unknown) =>
      log('WhatsApp reply failed', cause),
    );
  }
  async function onSaved(sender: WhatsAppSender, title: string) {
    const batch = batches.get(sender.ownerKey) ?? { sender, titles: [] };
    batches.set(sender.ownerKey, batch);
    batch.titles.push(title);
    clearTimeout(batch.timer);
    if (batch.titles.length >= batchMax) return sendBatch(sender.ownerKey);
    batch.timer = setTimeout(() => void sendBatch(sender.ownerKey), batchMs);
    batch.timer.unref?.();
  }
  /** Sends every waiting confirmation now; for tests and shutdown. */
  async function flush() {
    for (const ownerKey of [...batches.keys()]) await sendBatch(ownerKey);
  }

  /** Erases the sender's vault and everything that signs in to it (W9). */
  async function eraseEverything(sender: WhatsAppSender) {
    const batch = batches.get(sender.ownerKey);
    if (batch) clearTimeout(batch.timer);
    batches.delete(sender.ownerKey);
    await store.withOwnerLock(sender.ownerKey, async () => {
      await resetOwnerVault(store, objects, sender.ownerKey);
      await store.deleteOwnerSessions(sender.ownerKey);
      await bot.forgetSender(sender.userId, sender.ownerKey);
    });
  }

  const gate: GateHook = async ({ sender, wamid, message }) => {
    const state = await bot.senderState(sender.userId);
    const command = commandOf(message);
    const reply = (body: string) => answer(wamid, sender, text(sender, body));

    if (state.stoppedAt !== undefined) {
      // Stopped: nothing is saved or answered except START.
      if (command === 'START') {
        await bot.setStopped(sender.userId, undefined);
        await reply(BOT_REPLIES.started);
      } else await bot.forgetMessage(wamid);
      return true;
    }

    if (state.consentedAt === undefined) {
      // Before AGREE nothing is kept: not the item, and not the message's content.
      await bot.forgetMessage(wamid);
      if (state.noticeSentAt !== undefined) {
        if (command === 'AGREE') {
          await bot.setConsent(sender.userId, now(), options.noticeVersion);
          return reply(BOT_REPLIES.agreed).then(() => true);
        }
        if (command === 'HELP')
          return reply(BOT_REPLIES.help(options.contactEmail)).then(() => true);
        if (command === 'PRIVACY')
          return reply(BOT_REPLIES.privacy(options.privacyUrl)).then(() => true);
        if (command === 'DELETE ALL' || command === 'CONFIRM DELETE')
          return reply(BOT_REPLIES.nothingStored).then(() => true);
        if (command === 'STOP') {
          await bot.setStopped(sender.userId, now());
          return reply(BOT_REPLIES.stopped).then(() => true);
        }
      }
      // The notice goes out once; later messages before AGREE get no answer.
      if (await bot.claimNotice(sender.userId, now()))
        await reply(BOT_REPLIES.notice(options.privacyUrl));
      return true;
    }

    if (message.type === 'interactive') {
      const picked = (message.interactive as { type?: string; list_reply?: { id?: unknown } })
        ?.list_reply;
      if (typeof picked?.id === 'string') await sendBack(sender, wamid, picked.id);
      return true;
    }

    switch (command) {
      case 'AGREE':
        await reply(BOT_REPLIES.alreadyAgreed);
        return true;
      case 'HELP':
        await reply(BOT_REPLIES.help(options.contactEmail));
        return true;
      case 'PRIVACY':
        await reply(BOT_REPLIES.privacy(options.privacyUrl));
        return true;
      case 'STOP':
        await bot.setStopped(sender.userId, now());
        await reply(BOT_REPLIES.stopped);
        return true;
      case 'START':
        await reply(BOT_REPLIES.alreadyOn);
        return true;
      case 'OPEN':
        await reply(BOT_REPLIES.open(await createOpenLink(bot, sender, options.origin, now())));
        return true;
      case 'DELETE ALL':
        await bot.setDeleteRequest(sender.userId, now());
        await reply(BOT_REPLIES.deleteAsk);
        return true;
      case 'CONFIRM DELETE': {
        const asked = state.deleteRequestedAt;
        if (asked === undefined) await reply(BOT_REPLIES.deleteNotAsked);
        else if (now() - asked > DELETE_CONFIRM_SECONDS) {
          await bot.setDeleteRequest(sender.userId, undefined);
          await reply(BOT_REPLIES.deleteExpired);
        } else {
          await eraseEverything(sender);
          await reply(BOT_REPLIES.deleted);
        }
        return true;
      }
      default:
        return false;
    }
  };

  /** The sender's live items. */
  async function liveItems(ownerKey: string) {
    const { changes } = await store.changesAfter(ownerKey, 0);
    const items: StoredItem[] = [];
    for (const globalId of new Set(changes.map((change) => change.item.globalId))) {
      const item = await store.getItem(ownerKey, globalId);
      if (item && !item.deleted) items.push(item);
    }
    return items;
  }

  /** Search results for a sender: by meaning when the engine is there, plus keyword matches. */
  async function search(ownerKey: string, query: string) {
    const items = await liveItems(ownerKey);
    const byId = new Map(items.map((item) => [item.globalId, item]));
    const rows: ResultRow[] = [];
    let keywordOnly = !options.engine;
    let indexed = new Set<string>();
    if (options.engine) {
      try {
        const searchable = await ownerSearchItems(
          store,
          objects,
          ownerKey,
          options.supportedIndexVersions,
        );
        indexed = new Set(searchable.map((item) => item.globalId));
        const hits = searchable.length ? await options.engine.search(query, searchable) : [];
        for (const hit of hits) {
          const item = byId.get(hit.globalId);
          if (!item) continue;
          const parts = [where(hit.location), hit.excerpt && clip(hit.excerpt, 60)].filter(Boolean);
          rows.push({
            globalId: hit.globalId,
            location: hit.location,
            title: item.title,
            description: parts.length ? parts.join(' · ') : (KIND_LABEL[item.kind] ?? item.kind),
          });
        }
      } catch (cause) {
        log('WhatsApp search fell back to keywords', cause);
        keywordOnly = true;
        indexed = new Set();
      }
    }
    // Items not searchable by meaning yet (or at all, without the engine) match by title.
    const matches = items
      .filter((item) => !indexed.has(item.globalId))
      .map((item) => ({ item, score: keywordScore(query, item.title) }))
      .filter((match) => match.score > 0)
      .sort((a, b) => b.score - a.score || b.item.createdAt - a.item.createdAt);
    for (const { item } of matches) {
      if (rows.length >= MAX_RESULTS) break;
      if (rows.some((row) => row.globalId === item.globalId)) continue;
      rows.push({
        globalId: item.globalId,
        location: { kind: 'whole' },
        title: item.title,
        description: `${KIND_LABEL[item.kind] ?? item.kind} · ${
          keywordOnly ? 'title match' : 'still indexing'
        }`,
      });
    }
    return { rows: rows.slice(0, MAX_RESULTS), keywordOnly };
  }

  const onText: TextHook = async (sender, query, message) => {
    const { rows, keywordOnly } = await search(sender.ownerKey, clip(query, 500));
    const to = addressOf(sender);
    await answer(message.id, sender, async () => {
      if (!to) return;
      if (!rows.length) return graph.sendText(to, BOT_REPLIES.noResults(query, keywordOnly));
      await graph.sendInteractive(to, resultsList(query, rows, keywordOnly));
    });
  };

  /** A picked result: the original back in the chat, then a link to open the app. */
  async function sendBack(sender: WhatsAppSender, wamid: string, id: string) {
    const to = addressOf(sender);
    const picked = parseRowId(id);
    const item = picked && (await store.getItem(sender.ownerKey, picked.globalId));
    const bytes =
      item && !item.deleted && item.objectKey?.startsWith(`${sender.ownerKey}/`)
        ? await objects.get(item.objectKey)
        : undefined;
    await answer(wamid, sender, async () => {
      if (!to) return;
      if (!item || !bytes) return graph.sendText(to, BOT_REPLIES.gone);
      const place = picked && where(picked.location);
      const caption = clip(place ? `${item.title} (${place})` : item.title, META_LIMITS.caption);
      if (item.kind === 'note') {
        const note = new TextDecoder().decode(bytes);
        const room = META_LIMITS.text - BOT_REPLIES.noteTooLong.length - 2;
        await graph.sendText(
          to,
          codePoints(note).length <= META_LIMITS.text
            ? note
            : `${codePoints(note).slice(0, room).join('')}\n\n${BOT_REPLIES.noteTooLong}`,
        );
      } else {
        const asImage =
          item.kind === 'image' &&
          SEND_AS_IMAGE.has(item.mimeType) &&
          bytes.length <= MAX_IMAGE_SEND_BYTES;
        const mediaId = await graph.uploadMedia(bytes, item.mimeType, fileName(item));
        await graph.sendMedia(
          to,
          asImage
            ? { type: 'image', mediaId, caption }
            : { type: 'document', mediaId, caption, filename: fileName(item) },
        );
      }
      await graph.sendInteractive(to, {
        type: 'cta_url',
        body: { text: BOT_REPLIES.openCta },
        action: {
          name: 'cta_url',
          parameters: {
            display_text: clip('Open in app', META_LIMITS.ctaLabel),
            url: await createOpenLink(bot, sender, options.origin, now()),
          },
        },
      });
    });
  }

  return {
    gate,
    onText,
    onSaved,
    flush,
    search,
    /** The worker options this conversation needs. */
    hooks: { gate, onText, onSaved } satisfies Partial<WhatsAppWorkerOptions>,
  };
}

/**
 * The bot as one unit: the worker with this conversation's hooks. `stop` sends any waiting
 * confirmations first.
 */
export function startWhatsAppBot(
  options: ConversationOptions &
    Omit<WhatsAppWorkerOptions, 'gate' | 'onText' | 'onSaved'> & { idleMs?: number },
) {
  const conversation = createWhatsAppConversation(options);
  const worker = startWhatsAppWorker({ ...options, ...conversation.hooks });
  return {
    ...worker,
    conversation,
    async stop() {
      await worker.stop();
      await conversation.flush();
    },
  };
}
