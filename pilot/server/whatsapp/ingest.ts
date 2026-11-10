/// <reference types="node" />
// The WhatsApp worker: takes recorded messages from the job queue, copies supported files and
// notes into the sender's vault as ordinary cloud items, and answers in the chat.
import { createHash } from 'node:crypto';
import { LIMITS } from '../../../src/shared';
import { validateCloudItem, MAX_TITLE_CODE_POINTS } from '../../contract';
import { RateLimiter } from '../limits';
import type { ObjectStore, PilotStore, StoredItem } from '../store';
import { GraphError, MediaTooLargeError, type GraphClient, type WhatsAppAddress } from './graph';
import type { BotJob, BotStore, JobKind, WaMedia, WaMessage, WhatsAppSender } from './store';

export const REPLIES = {
  help: "Forward things here to save them, or start a message with 'note ' to save it as a note.",
  saved: (title: string) => `Saved to Campus Recall: ${title}`,
  failed: "Couldn't save this. Please send it again.",
  full: 'Your Campus Recall library is full, so this was not saved.',
  empty: 'This file is empty, so it was not saved.',
  voice: "Can't save voice notes yet.",
  audio: "Can't save audio files yet.",
  video: "Can't save videos yet.",
  sticker: "Can't save stickers.",
  file: "Can't save this kind of file yet. Send a PDF or a photo.",
  location: "Can't save locations yet.",
  contacts: "Can't save contacts.",
  other: "Can't save this kind of message yet.",
  tooBigForWhatsApp: 'This file is too large to come through WhatsApp.',
  bigImage: `This photo is over ${LIMITS.maxImageBytes / 1_000_000} MB, so it was not saved.`,
  bigPdf: `This PDF is over ${LIMITS.maxPdfBytes / 1_000_000} MB, so it was not saved.`,
  longNote: `This note is over ${LIMITS.maxTextCodePoints.toLocaleString('en-US')} characters, so it was not saved.`,
  notSearchable: (title: string) =>
    `Couldn't make "${title}" searchable, but it is still saved in Campus Recall.`,
  indexFull: (title: string) =>
    `Your Campus Recall library is full, so "${title}" was saved but can't be searched yet.`,
};

const NOTE_MIME = 'text/plain;charset=utf-8';
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
/** Media WhatsApp could not deliver because it is over its own 100 MB limit. */
const TOO_LARGE_FOR_WHATSAPP = 131052;

/** What to do with one message. */
export type MessagePlan =
  | { action: 'ignore' }
  | { action: 'refuse'; reply: string }
  | { action: 'text'; text: string }
  | { action: 'save'; kind: 'image' | 'pdf'; media: WaMedia; mimeType: string; title: string }
  | { action: 'save'; kind: 'note'; text: string; title: string; sourceUrl?: string };

const codePoints = (text: string) => Array.from(text);
/** Whitespace collapsed, cut to whole words within `max` code points. */
function firstWords(text: string, max: number) {
  const flat = text.replace(/\s+/g, ' ').trim();
  const points = codePoints(flat);
  if (points.length <= max) return flat;
  const cut = points.slice(0, max - 1).join('');
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
const titleFrom = (...candidates: (string | undefined)[]) => {
  for (const candidate of candidates) {
    const title = candidate && firstWords(candidate, MAX_TITLE_CODE_POINTS);
    if (title) return title;
  }
  return 'WhatsApp message';
};
const mimeOf = (media: WaMedia) => (media.mime_type ?? '').split(';')[0].trim().toLowerCase();
/** Capture time: the message's own timestamp (seconds) in milliseconds. */
export const createdAtOf = (message: WaMessage, fallbackMs = Date.now()) => {
  const seconds = Number(message.timestamp);
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds * 1000 : fallbackMs;
};
const day = (message: WaMessage) => new Date(createdAtOf(message)).toISOString().slice(0, 10);
const singleUrl = (text: string) => {
  if (!/^https?:\/\/\S+$/i.test(text) || !URL.canParse(text)) return undefined;
  const { protocol } = new URL(text);
  return protocol === 'https:' || protocol === 'http:' ? text : undefined;
};

/** Decides how a message is handled, from its content alone. */
export function planMessage(message: WaMessage): MessagePlan {
  switch (message.type) {
    case 'text': {
      const body = (message.text?.body ?? '').trim();
      const forwarded = !!(message.context?.forwarded || message.context?.frequently_forwarded);
      const prefixed = /^(?:note|save)\s+/i.exec(body);
      const text = prefixed ? body.slice(prefixed[0].length).trim() : body;
      const sourceUrl = singleUrl(text);
      if (!text || !(forwarded || prefixed || sourceUrl)) return { action: 'text', text: body };
      return {
        action: 'save',
        kind: 'note',
        text,
        title: titleFrom(firstWords(text, 60)),
        ...(sourceUrl ? { sourceUrl } : {}),
      };
    }
    case 'image':
    case 'document': {
      const media = message[message.type] ?? {};
      const mimeType = mimeOf(media);
      const kind =
        mimeType === 'application/pdf' ? 'pdf' : IMAGE_TYPES.has(mimeType) ? 'image' : undefined;
      if (!kind) return { action: 'refuse', reply: REPLIES.file };
      const fallback = `WhatsApp ${kind === 'pdf' ? 'PDF' : 'photo'} ${day(message)}`;
      return {
        action: 'save',
        kind,
        media,
        mimeType,
        title: titleFrom(media.caption, media.filename, fallback),
      };
    }
    case 'audio':
      return { action: 'refuse', reply: message.audio?.voice ? REPLIES.voice : REPLIES.audio };
    case 'video':
      return { action: 'refuse', reply: REPLIES.video };
    case 'sticker':
      return { action: 'refuse', reply: REPLIES.sticker };
    case 'location':
      return { action: 'refuse', reply: REPLIES.location };
    case 'contacts':
      return { action: 'refuse', reply: REPLIES.contacts };
    // Reactions and system notices need no answer; button and list replies belong to later
    // features.
    case 'reaction':
    case 'system':
    case 'button':
    case 'interactive':
    case 'request_welcome':
      return { action: 'ignore' };
    default:
      return {
        action: 'refuse',
        reply: message.errors?.some((error) => error.code === TOO_LARGE_FOR_WHATSAPP)
          ? REPLIES.tooBigForWhatsApp
          : REPLIES.other,
      };
  }
}

/**
 * The item's global ID: a UUID v4 made from the WhatsApp message ID, so processing a message
 * again can never create a second item.
 */
export function globalIdFor(wamid: string) {
  const bytes = createHash('sha256').update(`campus-recall:whatsapp:${wamid}`).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** WhatsApp's `sha256` names `hex` (64 hex digits) or is its base64 form, as webhooks send it. */
export function sameSha256(declared: string, hex: string) {
  const value = declared.trim();
  if (/^[0-9a-f]{64}$/i.test(value)) return value.toLowerCase() === hex;
  if (!/^[A-Za-z0-9+/_-]{43}=?$/.test(value)) return false;
  const bytes = Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  return bytes.length === 32 && bytes.toString('hex') === hex;
}

/** Called with typed text that is not saved; the conversation answers searches here. */
export type TextHook = (sender: WhatsAppSender, text: string, message: WaMessage) => Promise<void>;

/**
 * Sees every message before it is handled (consent, commands, list replies). True means the
 * message was dealt with: nothing is saved and the worker only finishes the job.
 */
export type GateHook = (input: {
  sender: WhatsAppSender;
  wamid: string;
  message: WaMessage;
  plan: MessagePlan;
}) => Promise<boolean>;

/** Where replies to a sender go: the BSUID when there is one, else the phone number. */
export const addressOf = (sender: WhatsAppSender): WhatsAppAddress | undefined =>
  !sender.userId.startsWith('phone-')
    ? { bsuid: sender.userId }
    : sender.waId
      ? { waId: sender.waId }
      : undefined;

export interface WhatsAppWorkerOptions {
  bot: BotStore;
  store: PilotStore;
  objects: ObjectStore;
  graph: GraphClient;
  /** The same account quota as uploads from the app. */
  quotaBytes: number;
  nowSeconds?: () => number;
  onText?: TextHook;
  gate?: GateHook;
  /**
   * Replaces the "Saved" reply, for example to confirm a burst in one message. It is called only
   * after this message's reply was claimed, so each message is still confirmed at most once.
   */
  onSaved?: (sender: WhatsAppSender, title: string) => Promise<void>;
  /** Handles index jobs; without one they stay queued for a later indexer. */
  onIndexJob?: (job: BotJob) => Promise<void>;
  /** A claimed job is taken again after this long if its worker stopped; 5 minutes. */
  leaseSeconds?: number;
  /** Failed attempts before a job fails for good; 6. */
  maxAttempts?: number;
  /** Wait before attempt `attempt + 1`; doubling from 30 seconds up to an hour by default. */
  retryDelaySeconds?: (attempt: number) => number;
  /** Messages handled per sender: a burst, then so many a minute; 30 and 30. */
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

/**
 * A job that would fail the same way every time, so it fails at once instead of being retried.
 * For an index job, `reply` replaces the usual message to the student.
 */
export class PermanentJobError extends Error {
  constructor(
    message: string,
    readonly reply?: string,
  ) {
    super(message);
    this.name = 'PermanentJobError';
  }
}

export function createWhatsAppIngest(options: WhatsAppWorkerOptions) {
  const { bot, store, objects, graph } = options;
  const now = options.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  const leaseSeconds = options.leaseSeconds ?? 300;
  const maxAttempts = options.maxAttempts ?? 6;
  const retryDelay =
    options.retryDelaySeconds ?? ((n: number) => Math.min(3600, 30 * 2 ** (n - 1)));
  const log = options.log ?? ((message, detail) => console.error(message, detail));
  const senders = new RateLimiter(
    options.senderBurst ?? 30,
    (options.senderPerMinute ?? 30) / 60,
    now,
  );
  const kinds: JobKind[] = options.onIndexJob ? ['ingest', 'index'] : ['ingest'];

  /** Sends a plain text message to the sender. */
  async function reply(sender: WhatsAppSender, text: string) {
    const to = addressOf(sender);
    if (to) await graph.sendText(to, text);
  }
  /**
   * Answers a message at most once, whoever processes it: the answer is claimed before it is
   * sent, so a crash right after can lose it but nothing ever sends it twice.
   */
  async function answer(wamid: string, sender: WhatsAppSender, text: string) {
    if (!(await bot.claimReply(wamid))) return;
    await reply(sender, text).catch((cause: unknown) => log('WhatsApp reply failed', cause));
  }

  /** The media's bytes; an expired download URL is replaced with a fresh one once. */
  async function download(media: WaMedia, maxBytes: number) {
    const lookup = () => {
      if (!media.id) throw new Error('The message names no media.');
      return graph.getMediaUrl(media.id);
    };
    let info = media.url ? undefined : await lookup();
    try {
      return { bytes: await graph.download(media.url ?? info!.url, maxBytes), info };
    } catch (cause) {
      if (!(cause instanceof GraphError && cause.status === 404)) throw cause;
    }
    info = await lookup();
    return { bytes: await graph.download(info.url, maxBytes), info };
  }

  async function contentOf(plan: Extract<MessagePlan, { action: 'save' }>) {
    if (plan.kind === 'note') {
      if (codePoints(plan.text).length > LIMITS.maxTextCodePoints)
        throw new Refusal(REPLIES.longNote);
      return { bytes: new TextEncoder().encode(plan.text), mimeType: NOTE_MIME };
    }
    const limit = plan.kind === 'image' ? LIMITS.maxImageBytes : LIMITS.maxPdfBytes;
    let fetched;
    try {
      fetched = await download(plan.media, limit);
    } catch (cause) {
      if (cause instanceof MediaTooLargeError)
        throw new Refusal(plan.kind === 'image' ? REPLIES.bigImage : REPLIES.bigPdf);
      throw cause;
    }
    const hex = createHash('sha256').update(fetched.bytes).digest('hex');
    const declared =
      plan.media.sha256 ??
      fetched.info?.sha256 ??
      (plan.media.id ? (await graph.getMediaUrl(plan.media.id)).sha256 : undefined);
    if (!declared) throw new Error('WhatsApp sent no SHA-256 for this file.');
    // Retried: a damaged download is fetched again from a fresh URL next time.
    if (!sameSha256(declared, hex))
      throw new Error('Downloaded bytes do not match the SHA-256 WhatsApp sent.');
    return { bytes: fetched.bytes, mimeType: plan.mimeType };
  }

  async function ingest(job: BotJob) {
    const inbound = await bot.getInbound(job.wamid);
    const sender = inbound && (await bot.getSender(inbound.senderId));
    if (!inbound || !sender) return bot.finishJob(job);
    const { wamid, ownerKey, message } = inbound;
    const plan = planMessage(message);
    if (options.gate && (await options.gate({ sender, wamid, message, plan })))
      return bot.finishJob(job);
    if (plan.action === 'ignore') return bot.finishJob(job);
    if (plan.action === 'refuse') {
      await bot.finishJob(job);
      return answer(wamid, sender, plan.reply);
    }
    if (plan.action === 'text') {
      if (options.onText) await options.onText(sender, plan.text, message);
      await bot.finishJob(job);
      if (!options.onText) await answer(wamid, sender, REPLIES.help);
      return;
    }

    const globalId = globalIdFor(wamid);
    const saved = async (item: StoredItem) => {
      await bot.finishJob(job);
      // A deleted item stays deleted; a retry only completes what was started.
      if (item.deleted) return;
      if (!options.onSaved) return answer(wamid, sender, REPLIES.saved(item.title));
      if (await bot.claimReply(wamid))
        await options
          .onSaved(sender, item.title)
          .catch((cause: unknown) => log('WhatsApp reply failed', cause));
    };
    const earlier = await store.getItem(ownerKey, globalId);
    if (earlier) return saved(earlier);

    let content;
    try {
      content = await contentOf(plan);
    } catch (cause) {
      if (!(cause instanceof Refusal)) throw cause;
      await bot.finishJob(job);
      return answer(wamid, sender, cause.reply);
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
    const valid = validateCloudItem(description);
    if (!valid.ok) {
      await bot.finishJob(job);
      return answer(wamid, sender, content.bytes.length ? REPLIES.failed : REPLIES.empty);
    }

    // Like upload completion: quota, object and item under the owner's lock, all or nothing.
    const outcome = await store.withOwnerLock(ownerKey, async () => {
      const { epoch } = await store.vault(ownerKey);
      const existing = await store.getItem(ownerKey, globalId);
      if (existing) return { existing };
      if ((await store.committedBytes(ownerKey)) + content.bytes.length > options.quotaBytes)
        return { full: true };
      const objectKey = `${ownerKey}/${epoch}/${globalId}/original`;
      await objects.put(objectKey, content.bytes);
      const item: StoredItem = { ...description, revision: 1, deleted: false, objectKey };
      await store.publish(ownerKey, item, epoch);
      // The seam for server indexing: every stored item gets an index job.
      await bot.enqueue('index', wamid, ownerKey, now());
      await bot.finishJob(job);
      return { item };
    });
    if ('full' in outcome) {
      await bot.finishJob(job);
      return answer(wamid, sender, REPLIES.full);
    }
    return saved(outcome.item ?? outcome.existing!);
  }

  /** Runs one due job; false when there was none. */
  async function runOnce() {
    const job = await bot.claimJob(kinds, now(), leaseSeconds);
    if (!job) return false;
    try {
      if (job.kind === 'ingest') {
        const wait = senders.take(job.ownerKey);
        if (wait) {
          await bot.deferJob(job, now() + wait);
          return true;
        }
        await ingest(job);
      } else {
        await options.onIndexJob!(job);
        await bot.finishJob(job);
      }
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : String(cause);
      log(`WhatsApp ${job.kind} job failed (attempt ${job.attempts})`, error);
      const permanent = cause instanceof PermanentJobError;
      if (job.attempts < maxAttempts && !permanent)
        await bot.retryJob(job, error, now() + retryDelay(job.attempts));
      else {
        await bot.failJob(job, error);
        if (job.kind === 'ingest') {
          const inbound = await bot.getInbound(job.wamid);
          const sender = inbound && (await bot.getSender(inbound.senderId));
          if (inbound && sender) await answer(job.wamid, sender, REPLIES.failed);
        } else await indexFailed(job, permanent ? cause.reply : undefined);
      }
    }
    return true;
  }

  /**
   * Tells the student once that a saved item could not be made searchable. The message already
   * had its "Saved" reply, so "once" comes from the job: only the claim that moved it to `failed`
   * (the terminal state) answers.
   */
  async function indexFailed(job: BotJob, text?: string) {
    const failed = await bot.getJob(job.id);
    if (failed?.state !== 'failed' || failed.attempts !== job.attempts) return;
    const inbound = await bot.getInbound(job.wamid);
    const sender = inbound && (await bot.getSender(inbound.senderId));
    const item = await store.getItem(job.ownerKey, globalIdFor(job.wamid));
    if (!sender || !item || item.deleted) return;
    await reply(sender, text ?? REPLIES.notSearchable(item.title)).catch((cause: unknown) =>
      log('WhatsApp reply failed', cause),
    );
  }

  /** Runs due jobs until none is left; for tests and one-off runs. */
  async function drain() {
    let count = 0;
    while (await runOnce()) count++;
    return count;
  }

  return { runOnce, drain, reply };
}

/** Runs the worker in this process until stopped; `wake` starts it on new messages at once. */
export function startWhatsAppWorker(options: WhatsAppWorkerOptions & { idleMs?: number }) {
  const worker = createWhatsAppIngest(options);
  const idleMs = options.idleMs ?? 5000;
  const log = options.log ?? ((message, detail) => console.error(message, detail));
  let stopped = false;
  let woken = false;
  let wakeUp: (() => void) | undefined;
  const loop = (async () => {
    while (!stopped) {
      woken = false;
      const worked = await worker.runOnce().catch((cause: unknown) => {
        log('WhatsApp worker error', cause);
        return false;
      });
      if (worked || woken || stopped) continue;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, idleMs);
        wakeUp = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      wakeUp = undefined;
    }
  })();
  return {
    ...worker,
    wake() {
      woken = true;
      wakeUp?.();
    },
    async stop() {
      stopped = true;
      wakeUp?.();
      await loop;
    },
  };
}
