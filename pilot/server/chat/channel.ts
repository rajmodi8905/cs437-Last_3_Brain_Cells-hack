// What a chat bot channel (WhatsApp, Telegram) needs to render the shared conversation parts:
// search results, a picked original sent back and an "Open in app" link. Each channel turns these
// into its own messages; the shared code decides what is sent.
import type { SourceLocation } from '../../../src/shared';
import type { StoredItem } from '../store';

/** One row of a search reply. */
export interface ResultRow {
  globalId: string;
  location: SourceLocation;
  title: string;
  description: string;
}

/** A stored original to send back in the chat. */
export interface OutgoingFile {
  item: StoredItem;
  bytes: Uint8Array;
  /** The title, with the page when the hit was on one, cut to the channel's caption limit. */
  caption: string;
  /** The title with the file type's extension. */
  filename: string;
}

/**
 * A channel's renderer. `To` is the channel's own address for a person (a WhatsApp BSUID or
 * number, a Telegram chat). Each method sends one or more messages and throws when sending fails.
 */
export interface ChatChannel<To> {
  /** Longest text message, in code points. */
  textLimit: number;
  /** Longest caption on a file, in code points. */
  captionLimit: number;
  sendText(to: To, text: string): Promise<void>;
  /** A search answer with at least one row; the person picks a row to get the original back. */
  sendResults(to: To, query: string, rows: ResultRow[], keywordOnly: boolean): Promise<void>;
  /** A photo or PDF; the channel decides whether it goes as a photo or as a document. */
  sendFile(to: To, file: OutgoingFile): Promise<void>;
  /** A message with an "Open in app" button for a one-time link. */
  sendOpenButton(to: To, url: string): Promise<void>;
}

const codePoints = (text: string) => Array.from(text);
const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });
/**
 * At most `max` code points, ending in an ellipsis when cut. The cut falls between whole
 * characters, so an emoji or an accented letter is never split.
 */
export function clip(text: string, max: number) {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (codePoints(flat).length <= max) return flat;
  let kept = '';
  let used = 0;
  for (const { segment } of graphemes.segment(flat)) {
    const size = codePoints(segment).length;
    if (used + size > max - 1) break;
    kept += segment;
    used += size;
  }
  return `${kept.trimEnd()}…`;
}

export const KIND_LABEL: Record<string, string> = {
  pdf: 'PDF',
  image: 'Photo',
  note: 'Note',
  audio: 'Audio',
  video: 'Video',
};

/** Where a hit is, for people: `p. 2`, `at 1:05`, or nothing for the whole item. */
export const where = (location: SourceLocation) =>
  location.kind === 'page'
    ? `p. ${location.page}`
    : location.kind === 'time'
      ? `at ${Math.floor(location.startMs / 60000)}:${String(Math.floor(location.startMs / 1000) % 60).padStart(2, '0')}`
      : undefined;

const EXTENSIONS: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};
/** A file name for sending an item back: its title, safe characters only, with an extension. */
export const fileName = (item: StoredItem) => {
  const base = item.title.replace(/[\\/:*?"<>|\n\r\t]+/g, ' ').trim() || 'Campus Recall';
  const extension = EXTENSIONS[item.mimeType] ?? '';
  return base.toLowerCase().endsWith(extension) ? base : `${base}${extension}`;
};
