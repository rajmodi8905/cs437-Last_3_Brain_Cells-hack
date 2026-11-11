// Everything the Telegram bot says (docs/pilot/telegram.md, "Messages"). Each refusal or failure
// says what happened, names the file where there is one, and gives the next step, in one or two
// short sentences. WhatsApp keeps its own wording (../whatsapp/ingest.ts).
import { LIMITS } from '../../../src/shared';
import { clip } from '../chat/channel';
import type { IndexFailure } from '../chat/index-failure';
import { maskEmail } from './links';

/** Telegram serves files to bots up to 20 MB (`getFile`). */
export const TELEGRAM_DOWNLOAD_LIMIT_MB = 20;

/**
 * Megabytes as people read them (1 MB = 1,000,000 bytes, as the app's limits count), rounded up
 * to one decimal, so a file just over a limit never reads as the limit itself.
 */
export function formatMegabytes(bytes: number) {
  const tenths = Math.ceil(bytes / 100_000);
  return `${tenths % 10 === 0 ? tenths / 10 : (tenths / 10).toFixed(1)} MB`;
}

const quote = (query: string) => `“${clip(query, 60)}”`;
/** A file or item name in a reply. */
const named = (name: string) => `"${clip(name, 80)}"`;
const CAN_SAVE = 'I can save photos, PDFs, text notes and links.';
/** The home-screen app keeps its own sign-in, which a link from the chat cannot reach. */
const HOME_SCREEN =
  'Using Campus Recall from your home screen? Sign in there once with the same IITGN account — everything you save here shows up automatically.';

const OFFICE = new Set([
  'doc',
  'docx',
  'ppt',
  'pptx',
  'xls',
  'xlsx',
  'odt',
  'odp',
  'ods',
  'rtf',
  'pages',
  'key',
  'numbers',
]);
const OTHER_IMAGES = new Set(['heic', 'heif', 'gif', 'bmp', 'tif', 'tiff', 'svg', 'avif']);
/** File types by MIME type, for documents sent without a file name. */
const MIME_TYPES: Record<string, string> = {
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/zip': 'zip',
  'text/plain': 'txt',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/gif': 'gif',
};

/** A document's type for people (`docx`, `ipynb`): from its file name, else its MIME type. */
export function fileTypeOf(fileName?: string, mimeType?: string) {
  const extension = fileName && /\.([A-Za-z0-9]{1,10})$/.exec(fileName.trim())?.[1];
  if (extension) return extension.toLowerCase();
  return mimeType ? MIME_TYPES[mimeType] : undefined;
}

/** What a file over a size limit was: its kind, file name and size, when known. */
export interface TooBigFile {
  kind: 'image' | 'pdf';
  name?: string;
  /** Its size in bytes, when Telegram declared it. */
  bytes?: number;
  /** Telegram itself would not hand the file over (its 20 MB limit for bots). */
  byTelegram?: boolean;
}

export const TELEGRAM_REPLIES = {
  notice: (privacyUrl: string) =>
    [
      'Hi! This is Campus Recall. Log in with your IITGN Google account, then send or forward photos, PDFs and notes here to keep them in your Campus Recall library, and type anything to search it.',
      '',
      '• What you send here is saved to your Campus Recall cloud library, with the searches you type.',
      '• Our server stores and processes your files to make them searchable, and sees your searches.',
      '• Telegram keeps bot chats on its own servers. Chats with bots are not end-to-end encrypted.',
      '• You must be 18 or older to use this.',
      '• /logout unlinks this chat, and /delete erases what you saved here.',
      '',
      `Privacy: ${privacyUrl}`,
      '',
      'Nothing is saved until you log in. The login link works once, for 10 minutes.',
    ].join('\n'),
  loginButton: 'Log in with IITGN',
  loginFirst: 'Log in first with /login.',
  linked: (email: string) =>
    `Linked to ${maskEmail(email)}. Forward or send files to save them; type anything to search.`,
  alreadyLinked: (email: string) =>
    `You're logged in as ${maskEmail(email)}. Send /help to see what I can do.`,
  loginWhileLinked: (email: string) =>
    `You're already logged in as ${maskEmail(email)}. To use another account, send /logout first, then /login.`,
  loggedOut: (email: string) =>
    `Logged out: this chat is no longer linked to ${maskEmail(email)}, and its unused links no longer work. What you saved stays in your Campus Recall library. Send /login to link again.`,
  help: (contactEmail: string) =>
    [
      "Log in with /login, then send or forward photos, PDFs and notes to save them to your Campus Recall library. Photos keep their full quality when you send them as a file. Start a message with 'note ' to save it as a note, or send a single link. Type anything else to search your library.",
      '',
      '/login: link your IITGN account',
      '/open: open your library in your browser',
      '/logout: unlink this chat',
      '/privacy: how your data is handled',
      '/stop and /resume: pause or resume the bot',
      '/delete: erase what you saved here',
      '',
      `Questions: ${contactEmail}`,
    ].join('\n'),
  privacy: (privacyUrl: string) => `How Campus Recall handles your data: ${privacyUrl}`,
  stopped:
    "Stopped. I won't save anything or reply until you send /resume. What you saved is kept.",
  started: "Welcome back. I'm saving and replying again.",
  alreadyOn: "I'm already on. Send /help to see what I can do.",
  /** A button tapped while stopped (a short pop-up). */
  resumeFirst: "I'm paused. Send /resume to use me again.",
  deleteAsk:
    "This erases the items you saved here through Telegram from your Campus Recall library, on every device, and logs this chat out. Items you added in the app stay; to remove everything, use Remove cloud library in the app's Settings. Tap the button within 10 minutes to go ahead.",
  deleteButton: 'Yes, erase my Telegram items',
  deleted: (count: number) =>
    `Done. ${count === 1 ? '1 item' : `${count} items`} you saved through Telegram ${count === 1 ? 'is' : 'are'} erased from your Campus Recall library, and this chat is logged out. Everything else in your library stays; to remove it all, use Remove cloud library in the app's Settings.`,
  deleteExpired:
    'That erase button has expired (it works for 10 minutes). Nothing was erased; send /delete again if you still want to erase what you saved here.',
  deleteNotAsked: 'Send /delete first if you want to erase what you saved here.',
  open: `Open your Campus Recall library in your browser (the link works once, for 10 minutes). ${HOME_SCREEN}`,
  /** A link opens in the browser: on an iPhone it can never open the home-screen app. */
  openButton: 'Open in browser',
  noLinks:
    "Links need the pilot's HTTPS address. In a local trial, start it again with --origin https://<tunnel host>, then send /login or /open.",
  savedMany: (titles: string[]) =>
    `Saved ${titles.length} items to Campus Recall: ${titles.map((t) => clip(t, 40)).join(', ')}`,
  results: (query: string) => `Best matches for ${quote(query)}. Tap one to get it back.`,
  keywordOnly: 'Search by meaning is off right now, so these only match words in titles.',
  /** Under results that include items not searchable by meaning yet. */
  stillIndexing:
    'Items marked “still indexing” matched by their title only; their contents are not searchable yet.',
  noResults: (query: string, keywordOnly: boolean) =>
    `Nothing matched ${quote(query)} in your Campus Recall library.${
      keywordOnly
        ? ' Search by meaning is off right now, so only titles were matched.'
        : ' Try other words.'
    }`,
  gone: "That item isn't in your library any more.",
  expired: 'That result button has expired (they work for a day). Search again to get it.',
  appOnly: "This one can't be sent in Telegram. Open it in your browser instead.",
  openCta: `Open it in your browser (the link works once, for 10 minutes). ${HOME_SCREEN}`,
  noteTooLong: '(Cut short here; open it in your browser to read the rest.)',
  unknownCommand: (command: string) =>
    `I don't know ${clip(command, 40)}. Send /help to see the commands I understand.`,
  notOpen:
    "Campus Recall on Telegram isn't open to everyone yet, so nothing you send here is saved. Thanks for your interest!",

  // What cannot be saved, and what can.
  voice: `Can't save voice messages. ${CAN_SAVE}`,
  audio: `Can't save audio files. ${CAN_SAVE}`,
  video: `Can't save videos. ${CAN_SAVE}`,
  videoNote: `Can't save video messages. ${CAN_SAVE}`,
  gif: `Can't save GIFs. ${CAN_SAVE}`,
  sticker: `Can't save stickers. ${CAN_SAVE}`,
  location: "Can't save locations. Send a map link instead and I'll save it as a note.",
  contact:
    "Can't save contacts. To keep someone's details, type them in a message that starts with 'note '.",
  other: `Can't save this kind of message. ${CAN_SAVE}`,
  /** A document of a type the app does not take, by its type (`fileTypeOf`). */
  unsupportedFile: (type: string | undefined) =>
    !type
      ? `Can't save this kind of file. ${CAN_SAVE}`
      : OFFICE.has(type)
        ? `Can't save .${type} files. Export it as a PDF and send that instead.`
        : OTHER_IMAGES.has(type)
          ? `Can't save .${type} images. Send it as a photo, or as a JPEG, PNG or WebP file.`
          : type === 'txt'
            ? "Can't save .txt files. Paste the text in a message that starts with 'note ' instead."
            : `Can't save .${type} files. ${CAN_SAVE}`,

  // Saving.
  tooBig: (file: TooBigFile) => {
    const pdf = file.kind === 'pdf';
    const subject = file.name ? named(file.name) : pdf ? 'This PDF' : 'This photo';
    const fix = pdf
      ? 'Compress it or split it into smaller PDFs, then send them again.'
      : 'Send a smaller copy, or send it as a photo instead of as a file.';
    const limit = formatMegabytes(pdf ? LIMITS.maxPdfBytes : LIMITS.maxImageBytes);
    const over =
      file.bytes !== undefined
        ? `is ${formatMegabytes(file.bytes)}, over the ${limit} limit for ${pdf ? 'PDFs' : 'photos'}`
        : file.byTelegram
          ? `is over Telegram's ${TELEGRAM_DOWNLOAD_LIMIT_MB} MB download limit for bots`
          : `is over the ${limit} limit for ${pdf ? 'PDFs' : 'photos'}`;
    return `${subject} ${over}, so it wasn't saved. ${fix}`;
  },
  longNote: (characters: number) =>
    `This note is ${characters.toLocaleString('en-US')} characters, over the ${LIMITS.maxTextCodePoints.toLocaleString('en-US')}-character limit for notes, so it wasn't saved. Split it into shorter notes and send them one by one.`,
  empty: (name?: string) => `${name ? named(name) : 'This file'} is empty, so it wasn't saved.`,
  notSaved: (name?: string) =>
    `Couldn't save ${name ? named(name) : 'this'}. Please send it again.`,
  full: (name: string | undefined, quotaBytes: number) =>
    `Your Campus Recall cloud library has reached its ${formatMegabytes(quotaBytes)} limit, so ${
      name ? named(name) : 'this'
    } wasn't saved. Delete some items in the app to make room, then send it again.`,
  downloadFailed: "Couldn't get that file from Telegram. Please send it again.",
  serverError: 'Something went wrong on our side. Please try again in a minute.',

  /** A saved item that could not be made searchable, by the reason (`classifyIndexFailure`). */
  notSearchable: (
    failure: IndexFailure,
    item: { title: string; kind: string },
    quotaBytes: number,
  ) => {
    const name = named(item.title);
    const maxPages = LIMITS.maxPdfPages;
    switch (failure.kind) {
      case 'too-many-pages': {
        const pages =
          failure.pageCount !== undefined && failure.pageCount > maxPages
            ? `${failure.pageCount}`
            : `more than ${maxPages}`;
        return `${name} has ${pages} pages — search works on PDFs up to ${maxPages} pages. It's still saved; split it into smaller PDFs to make it searchable.`;
      }
      case 'password-protected':
        return `${name} is password-protected, so it can't be searched. It's still saved; remove the password (for example, print it to a new PDF) and send it again to make it searchable.`;
      case 'unreadable-pdf':
        return `${name} couldn't be read; the PDF may be damaged. It's still saved; export or print it to a new PDF and send it again to make it searchable.`;
      case 'bad-image':
        return `${name} couldn't be opened as an image. It's still saved; re-save it as a JPEG or PNG and send it again to make it searchable.`;
      case 'nothing-searchable':
        return item.kind === 'pdf'
          ? `No text was found in ${name}, so it can't be searched by its words. It's still saved; if it's a scan, a sharper copy may help.`
          : `Couldn't find anything to search by in ${name}. It's still saved, and you can open it in the app.`;
      case 'library-full':
        return `${name} is saved, but your cloud library has reached its ${formatMegabytes(quotaBytes)} limit, so it can't be made searchable. Delete some items in the app to make room.`;
      default:
        return `${name} is saved, but it couldn't be made searchable. You can still open it in the app.`;
    }
  },
};
