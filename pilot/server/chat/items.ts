/// <reference types="node" />
// Turning a chat message into a cloud item, shared by the chat channels: which typed text is a
// note, titles, the item's global ID, and storing the original under the owner's lock exactly as
// upload completion does.
import { createHash } from 'node:crypto';
import type { CloudItem } from '../../contract';
import type { ObjectStore, PilotStore, StoredItem } from '../store';
import type { BotJob, BotStore } from '../whatsapp/store';

export const NOTE_MIME = 'text/plain;charset=utf-8';

const codePoints = (text: string) => Array.from(text);
/** Whitespace collapsed, cut to whole words within `max` code points. */
export function firstWords(text: string, max: number) {
  const flat = text.replace(/\s+/g, ' ').trim();
  const points = codePoints(flat);
  if (points.length <= max) return flat;
  const cut = points.slice(0, max - 1).join('');
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** The text when it is one `http` or `https` link and nothing else. */
export const singleUrl = (text: string) => {
  if (!/^https?:\/\/\S+$/i.test(text) || !URL.canParse(text)) return undefined;
  const { protocol } = new URL(text);
  return protocol === 'https:' || protocol === 'http:' ? text : undefined;
};

/**
 * Typed text that is saved as a note: forwarded text, text starting with `note ` or `save ` (the
 * prefix is removed), or a single link. Anything else is not a note (it is a search or a command).
 */
export function noteFromText(body: string, forwarded: boolean) {
  const prefixed = /^(?:note|save)\s+/i.exec(body);
  const text = prefixed ? body.slice(prefixed[0].length).trim() : body;
  const sourceUrl = singleUrl(text);
  if (!text || !(forwarded || prefixed || sourceUrl)) return undefined;
  return { text, ...(sourceUrl ? { sourceUrl } : {}) };
}

/**
 * A UUID v4 made from a channel's message ID, so processing a message again can never create a
 * second item. `namespace` keeps channels apart.
 */
export function chatGlobalId(namespace: string, messageId: string) {
  const bytes = createHash('sha256').update(`campus-recall:${namespace}:${messageId}`).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export type StoreOutcome =
  { cancelled: true } | { full: true } | { existing: StoredItem } | { item: StoredItem };

/**
 * Stores a checked item and its original like upload completion: quota, object and item under
 * the owner's lock, all or nothing, then queues its index job and finishes the ingest job.
 * Nothing is stored when the job is no longer the current claim or `canStore` says no, because a
 * DELETE ALL handled by another worker while this one downloaded ends the job and clears consent.
 */
export async function storeChatItem(input: {
  bot: BotStore;
  store: PilotStore;
  objects: ObjectStore;
  job: BotJob;
  ownerKey: string;
  description: Omit<CloudItem, 'revision' | 'deleted' | 'index'>;
  bytes: Uint8Array;
  quotaBytes: number;
  now: number;
  canStore?: () => Promise<boolean>;
}): Promise<StoreOutcome> {
  const { bot, store, objects, job, ownerKey, description, bytes } = input;
  const { globalId } = description;
  return store.withOwnerLock(ownerKey, async (): Promise<StoreOutcome> => {
    const current = await bot.getJob(job.id);
    if (current?.state !== 'running' || current.attempts !== job.attempts)
      return { cancelled: true };
    if (input.canStore && !(await input.canStore())) return { cancelled: true };
    const { epoch } = await store.vault(ownerKey);
    const existing = await store.getItem(ownerKey, globalId);
    if (existing) return { existing };
    if ((await store.committedBytes(ownerKey)) + bytes.length > input.quotaBytes)
      return { full: true };
    const objectKey = `${ownerKey}/${epoch}/${globalId}/original`;
    await objects.put(objectKey, bytes);
    const item: StoredItem = { ...description, revision: 1, deleted: false, objectKey };
    await store.publish(ownerKey, item, epoch);
    // The seam for server indexing: every stored item gets an index job.
    await bot.enqueue('index', job.wamid, ownerKey, input.now);
    await bot.finishJob(job);
    return { item };
  });
}
