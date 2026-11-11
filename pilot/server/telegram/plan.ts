// What to do with one Telegram message, from its content alone: save it (and how), refuse it with
// a plain reason that says what was sent and what can be saved, treat it as a command, or search
// with it.
import { MAX_TITLE_CODE_POINTS } from '../../contract';
import { firstWords, noteFromText } from '../chat/items';
import type { TgFile, TgMessage, TgPhotoSize } from './api';
import { TELEGRAM_REPLIES as REPLIES, fileTypeOf } from './replies';

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** A file to download: Telegram's file ID and the size it declared, when it did. */
export interface TgMedia {
  fileId: string;
  fileSize?: number;
}

export type TelegramPlan =
  | { action: 'ignore' }
  | { action: 'refuse'; reply: string }
  | { action: 'command'; name: string; payload: string }
  | { action: 'text'; text: string }
  | {
      action: 'save';
      kind: 'image' | 'pdf';
      media: TgMedia;
      mimeType: string;
      title: string;
      /** A document's own file name, for replies about it. */
      fileName?: string;
    }
  | { action: 'save'; kind: 'note'; text: string; title: string; sourceUrl?: string };

/** Forwarded from someone or somewhere else. */
export const isForwarded = (message: TgMessage) =>
  !!message.forward_origin || message.forward_date !== undefined;

/** `/name`, `/name@bot` or `/name payload`; forwarded text is never a command. */
export function commandOf(message: TgMessage) {
  if (typeof message.text !== 'string' || isForwarded(message)) return undefined;
  const match = /^\/([A-Za-z0-9_]{1,32})(?:@[A-Za-z0-9_]{1,64})?(?:\s+([\s\S]*))?$/.exec(
    message.text.trim(),
  );
  return match ? { name: match[1].toLowerCase(), payload: (match[2] ?? '').trim() } : undefined;
}

const titleFrom = (...candidates: (string | undefined)[]) => {
  for (const candidate of candidates) {
    const title = candidate && firstWords(candidate, MAX_TITLE_CODE_POINTS);
    if (title) return title;
  }
  return 'Telegram message';
};
const day = (message: TgMessage) => new Date(createdAtOf(message)).toISOString().slice(0, 10);
/** Capture time: the message's own date (seconds) in milliseconds. */
export const createdAtOf = (message: TgMessage, fallbackMs = Date.now()) =>
  Number.isSafeInteger(message.date) && message.date > 0 ? message.date * 1000 : fallbackMs;

/** The largest size Telegram offers of a photo: by bytes when given, else by pixels. */
export function largestPhoto(sizes: TgPhotoSize[]) {
  const usable = sizes.filter((size) => typeof size?.file_id === 'string' && size.file_id);
  const area = (size: TgPhotoSize) => (size.width ?? 0) * (size.height ?? 0);
  return usable.reduce<TgPhotoSize | undefined>(
    (best, size) =>
      !best ||
      (size.file_size ?? 0) > (best.file_size ?? 0) ||
      ((size.file_size ?? 0) === (best.file_size ?? 0) && area(size) > area(best))
        ? size
        : best,
    undefined,
  );
}

const media = (file: { file_id: string; file_size?: number }): TgMedia => ({
  fileId: file.file_id,
  ...(typeof file.file_size === 'number' ? { fileSize: file.file_size } : {}),
});
const mimeOf = (file: TgFile) => (file.mime_type ?? '').split(';')[0].trim().toLowerCase();

export function planTelegramMessage(message: TgMessage): TelegramPlan {
  if (Array.isArray(message.photo) && message.photo.length) {
    const photo = largestPhoto(message.photo);
    if (!photo) return { action: 'refuse', reply: REPLIES.other };
    // Telegram sends photos as JPEG; the original quality is kept only when sent as a file.
    return {
      action: 'save',
      kind: 'image',
      media: media(photo),
      mimeType: 'image/jpeg',
      title: titleFrom(message.caption, `Telegram photo ${day(message)}`),
    };
  }
  // Checked before `document`: Telegram also fills `document` for GIFs (animations).
  if (message.voice) return { action: 'refuse', reply: REPLIES.voice };
  if (message.audio) return { action: 'refuse', reply: REPLIES.audio };
  if (message.animation) return { action: 'refuse', reply: REPLIES.gif };
  if (message.video_note) return { action: 'refuse', reply: REPLIES.videoNote };
  if (message.video) return { action: 'refuse', reply: REPLIES.video };
  if (message.sticker) return { action: 'refuse', reply: REPLIES.sticker };
  if (message.document && typeof message.document.file_id === 'string') {
    const mimeType = mimeOf(message.document);
    const kind =
      mimeType === 'application/pdf' ? 'pdf' : IMAGE_TYPES.has(mimeType) ? 'image' : undefined;
    const fileName =
      typeof message.document.file_name === 'string' && message.document.file_name.trim()
        ? message.document.file_name.trim()
        : undefined;
    if (!kind)
      return { action: 'refuse', reply: REPLIES.unsupportedFile(fileTypeOf(fileName, mimeType)) };
    const fallback = `Telegram ${kind === 'pdf' ? 'PDF' : 'photo'} ${day(message)}`;
    return {
      action: 'save',
      kind,
      media: media(message.document),
      mimeType,
      title: titleFrom(message.caption, fileName, fallback),
      ...(fileName ? { fileName } : {}),
    };
  }
  if (message.location || message.venue) return { action: 'refuse', reply: REPLIES.location };
  if (message.contact) return { action: 'refuse', reply: REPLIES.contact };
  if (typeof message.text === 'string') {
    const command = commandOf(message);
    if (command) return { action: 'command', ...command };
    const body = message.text.trim();
    const note = noteFromText(body, isForwarded(message));
    if (!note) return body ? { action: 'text', text: body } : { action: 'ignore' };
    return { action: 'save', kind: 'note', ...note, title: titleFrom(firstWords(note.text, 60)) };
  }
  // Service messages (a member joined, a pinned message) need no answer.
  if (
    message.new_chat_members ||
    message.left_chat_member ||
    message.pinned_message ||
    message.new_chat_title
  )
    return { action: 'ignore' };
  return { action: 'refuse', reply: REPLIES.other };
}
