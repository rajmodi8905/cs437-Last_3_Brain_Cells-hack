// A picked search result sent back in the chat (W8, T8): the original from the person's own vault
// (a photo or PDF as a file, a note as text), then a one-time link to open it in the app.
import type { SourceLocation } from '../../../src/shared';
import type { ObjectStore, PilotStore } from '../store';
import { clip, fileName, where, type ChatChannel } from './channel';

/** Kinds sent back in the chat; others (from an included device library) open in the app. */
const SENDABLE = new Set(['image', 'pdf', 'note']);
const codePoints = (text: string) => Array.from(text);

export interface SendBackReplies {
  /** The item is not in this vault (another vault's, deleted, or never there). */
  gone: string;
  /** A kind the chat cannot carry. */
  appOnly: string;
  /** Ends a note that was cut to the channel's text limit. */
  noteTooLong: string;
}

export interface SendBackInput<To> {
  store: PilotStore;
  objects: ObjectStore;
  channel: ChatChannel<To>;
  replies: SendBackReplies;
  ownerKey: string;
  /** The result that was picked; undefined when the reference could not be read. */
  picked: { globalId: string; location: SourceLocation } | undefined;
  /**
   * Sends the answer at most once: `send` runs only if this message's reply is claimed. `to` is
   * undefined when there is no address to answer.
   */
  answer: (send: () => Promise<void>) => Promise<void>;
  to: To | undefined;
  /** A fresh one-time app link, made only once the answer is being sent; none skips the button. */
  link: () => Promise<string | undefined>;
}

export async function sendBack<To>(input: SendBackInput<To>) {
  const { store, objects, channel, replies, ownerKey, picked, to } = input;
  // Only the person's own vault is read, so another vault's ID finds nothing.
  const item = picked && (await store.getItem(ownerKey, picked.globalId));
  // Kinds the chat cannot carry (a long video synced from the app, say) are only checked to
  // exist, not read into memory.
  const bytes =
    item && !item.deleted && item.objectKey?.startsWith(`${ownerKey}/`)
      ? await objects.get(
          item.objectKey,
          SENDABLE.has(item.kind) ? undefined : { start: 0, end: 0 },
        )
      : undefined;
  await input.answer(async () => {
    if (to === undefined) return;
    if (!item || !bytes) return channel.sendText(to, replies.gone);
    const place = picked && where(picked.location);
    const caption = clip(place ? `${item.title} (${place})` : item.title, channel.captionLimit);
    if (!SENDABLE.has(item.kind)) {
      await channel.sendText(to, replies.appOnly);
    } else if (item.kind === 'note') {
      const note = new TextDecoder().decode(bytes);
      const room = channel.textLimit - replies.noteTooLong.length - 2;
      await channel.sendText(
        to,
        codePoints(note).length <= channel.textLimit
          ? note
          : `${codePoints(note).slice(0, room).join('')}\n\n${replies.noteTooLong}`,
      );
    } else {
      await channel.sendFile(to, { item, bytes, caption, filename: fileName(item) });
    }
    const url = await input.link();
    if (url) await channel.sendOpenButton(to, url);
  });
}
