/// <reference types="node" />
// The Telegram bot's error and refusal messages (docs/pilot/telegram.md, "Messages"): the reason
// an index job failed is read from the app's own engine messages, and every refusal or failure is
// one or two short sentences with no internal codes. The bot's own tests (telegram.test.ts) send
// each case through the stand-in Bot API.
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { LIMITS } from '../../src/shared';
import { GEMMA } from '../../src/shared/searchModels';
import { classifyIndexFailure, type IndexFailureKind } from '../server/chat/index-failure';
import { PermanentJobError } from '../server/chat/jobs';
import { IndexPublishError } from '../server/index-publish';
import { planTelegramMessage } from '../server/telegram/plan';
import { TELEGRAM_REPLIES, fileTypeOf, formatMegabytes } from '../server/telegram/replies';
import { EngineIndexError } from '../server/whatsapp/engine-host';
import { REPLIES } from '../server/whatsapp/ingest';
import { ENGINE_MESSAGES, documentUpdate, messageUpdate } from './telegram-helpers';

/** As the indexer passes an engine refusal on: a permanent failure caused by it. */
const failed = (message: string, pageCount?: number) => {
  const cause = new EngineIndexError('EXTRACTION_FAILED', message, pageCount);
  return new PermanentJobError(`${cause.code}: ${cause.message}`, undefined, { cause });
};
const PICTURE_ONLY = `There is no text or speech to search here, and your own search model cannot search what is in a picture or video. Switch to ${GEMMA.label} in Settings to search it. The original is still saved and can be opened.`;

describe('Telegram messages: why indexing failed', () => {
  it("uses the app's own engine messages, word for word", async () => {
    const extract = await readFile('src/engine/extract.ts', 'utf8');
    const engine = await readFile('src/engine/index.ts', 'utf8');
    for (const message of [
      ENGINE_MESSAGES.pageLimit,
      ENGINE_MESSAGES.password,
      ENGINE_MESSAGES.unreadablePdf,
      ENGINE_MESSAGES.badImage,
    ])
      expect(extract).toContain(message);
    expect(engine).toContain(ENGINE_MESSAGES.nothingSearchable);
    expect(engine).toContain(
      'There is no text or speech to search here, and your own search model cannot search what is in a picture or video. Switch to ${GEMMA.label} in Settings to search it. The original is still saved and can be opened.',
    );
    // The page limit in the message is the app's frozen limit.
    expect(LIMITS.maxPdfPages).toBe(50);
  });

  it('reads each reason, and the page count, from the failed job', () => {
    const cases: [unknown, IndexFailureKind][] = [
      [failed(ENGINE_MESSAGES.pageLimit), 'too-many-pages'],
      [failed(ENGINE_MESSAGES.password), 'password-protected'],
      [failed(ENGINE_MESSAGES.unreadablePdf), 'unreadable-pdf'],
      [failed(ENGINE_MESSAGES.badImage), 'bad-image'],
      [failed(ENGINE_MESSAGES.nothingSearchable), 'nothing-searchable'],
      [failed(PICTURE_ONLY), 'nothing-searchable'],
      [failed('Processing cancelled.'), 'other'],
      [
        new PermanentJobError('quota', REPLIES.indexFull('x'), {
          cause: new IndexPublishError('QUOTA_EXCEEDED', 'The account quota is full.'),
        }),
        'library-full',
      ],
      [
        new PermanentJobError('INVALID_INPUT: bad', undefined, {
          cause: new IndexPublishError('INVALID_INPUT', 'bad'),
        }),
        'other',
      ],
      [new Error('Engine host page crashed'), 'other'],
      ['not an error', 'other'],
      [undefined, 'other'],
    ];
    for (const [error, kind] of cases) expect(classifyIndexFailure(error)).toEqual({ kind });
    expect(classifyIndexFailure(failed(ENGINE_MESSAGES.pageLimit, 71))).toEqual({
      kind: 'too-many-pages',
      pageCount: 71,
    });
    // The engine host's own error, without the job's wrapper, reads the same.
    expect(
      classifyIndexFailure(
        new EngineIndexError('EXTRACTION_FAILED', ENGINE_MESSAGES.pageLimit, 71),
      ),
    ).toEqual({ kind: 'too-many-pages', pageCount: 71 });
    for (const pageCount of [0, -1, 1.5, Number.NaN])
      expect(classifyIndexFailure(failed(ENGINE_MESSAGES.pageLimit, pageCount))).toEqual({
        kind: 'too-many-pages',
      });
  });

  it('words each reason with the file name, that it is still saved, and the fix', () => {
    const pdf = { title: 'Lecture 19_01_04_2026.pdf', kind: 'pdf' };
    const photo = { title: 'Notice board', kind: 'image' };
    const say = (failure: Parameters<typeof TELEGRAM_REPLIES.notSearchable>[0], item = pdf) =>
      TELEGRAM_REPLIES.notSearchable(failure, item, 200_000_000);
    expect(say({ kind: 'too-many-pages', pageCount: 71 })).toBe(
      '"Lecture 19_01_04_2026.pdf" has 71 pages — search works on PDFs up to 50 pages. It\'s still saved; split it into smaller PDFs to make it searchable.',
    );
    // A page count that cannot be right is not shown.
    expect(say({ kind: 'too-many-pages', pageCount: 12 })).toBe(say({ kind: 'too-many-pages' }));
    expect(say({ kind: 'too-many-pages' })).toContain('has more than 50 pages');
    expect(say({ kind: 'password-protected' })).toBe(
      '"Lecture 19_01_04_2026.pdf" is password-protected, so it can\'t be searched. It\'s still saved; remove the password (for example, print it to a new PDF) and send it again to make it searchable.',
    );
    expect(say({ kind: 'unreadable-pdf' })).toBe(
      '"Lecture 19_01_04_2026.pdf" couldn\'t be read; the PDF may be damaged. It\'s still saved; export or print it to a new PDF and send it again to make it searchable.',
    );
    expect(say({ kind: 'bad-image' }, photo)).toBe(
      '"Notice board" couldn\'t be opened as an image. It\'s still saved; re-save it as a JPEG or PNG and send it again to make it searchable.',
    );
    expect(say({ kind: 'nothing-searchable' })).toBe(
      "No text was found in \"Lecture 19_01_04_2026.pdf\", so it can't be searched by its words. It's still saved; if it's a scan, a sharper copy may help.",
    );
    // A photo is not told it has no text: photos are searched by how they look as well.
    expect(say({ kind: 'nothing-searchable' }, photo)).toBe(
      'Couldn\'t find anything to search by in "Notice board". It\'s still saved, and you can open it in the app.',
    );
    expect(say({ kind: 'library-full' })).toBe(
      '"Lecture 19_01_04_2026.pdf" is saved, but your cloud library has reached its 200 MB limit, so it can\'t be made searchable. Delete some items in the app to make room.',
    );
    expect(say({ kind: 'other' })).toBe(
      '"Lecture 19_01_04_2026.pdf" is saved, but it couldn\'t be made searchable. You can still open it in the app.',
    );
  });
});

describe('Telegram messages: refusals', () => {
  const plan = (update: { message: unknown }) =>
    planTelegramMessage(update.message as Parameters<typeof planTelegramMessage>[0]);
  const file = { file_id: 'x', file_unique_id: 'ux' };

  it('says what was sent and what can be saved', () => {
    const cases: [{ message: unknown }, string][] = [
      [
        messageUpdate({ voice: { ...file, mime_type: 'audio/ogg' } }),
        "Can't save voice messages. I can save photos, PDFs, text notes and links.",
      ],
      [
        messageUpdate({ audio: { ...file, mime_type: 'audio/mpeg' } }),
        "Can't save audio files. I can save photos, PDFs, text notes and links.",
      ],
      [
        messageUpdate({ video: { ...file, mime_type: 'video/mp4' } }),
        "Can't save videos. I can save photos, PDFs, text notes and links.",
      ],
      [
        messageUpdate({ video_note: file }),
        "Can't save video messages. I can save photos, PDFs, text notes and links.",
      ],
      [
        messageUpdate({ animation: file, document: { ...file, mime_type: 'video/mp4' } }),
        "Can't save GIFs. I can save photos, PDFs, text notes and links.",
      ],
      [
        messageUpdate({ sticker: file }),
        "Can't save stickers. I can save photos, PDFs, text notes and links.",
      ],
      [
        messageUpdate({ location: { latitude: 23.2, longitude: 72.6 } }),
        "Can't save locations. Send a map link instead and I'll save it as a note.",
      ],
      [
        messageUpdate({ venue: { title: 'Library' } }),
        "Can't save locations. Send a map link instead and I'll save it as a note.",
      ],
      [
        messageUpdate({ contact: { phone_number: '+910000000000', first_name: 'Warden' } }),
        "Can't save contacts. To keep someone's details, type them in a message that starts with 'note '.",
      ],
      [
        messageUpdate({ dice: { emoji: '🎲', value: 3 } }),
        "Can't save this kind of message. I can save photos, PDFs, text notes and links.",
      ],
      [
        documentUpdate({
          fileId: 'nb',
          mimeType: 'application/x-ipynb+json',
          fileName: 'analysis.ipynb',
        }),
        "Can't save .ipynb files. I can save photos, PDFs, text notes and links.",
      ],
      [
        documentUpdate({ fileId: 'd', mimeType: 'application/msword', fileName: 'Report.DOC' }),
        "Can't save .doc files. Export it as a PDF and send that instead.",
      ],
      [
        documentUpdate({
          fileId: 'x',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        "Can't save .xlsx files. Export it as a PDF and send that instead.",
      ],
      [
        documentUpdate({ fileId: 'h', mimeType: 'image/heic', fileName: 'IMG_1234.HEIC' }),
        "Can't save .heic images. Send it as a photo, or as a JPEG, PNG or WebP file.",
      ],
      [
        documentUpdate({ fileId: 't', mimeType: 'text/plain', fileName: 'todo.txt' }),
        "Can't save .txt files. Paste the text in a message that starts with 'note ' instead.",
      ],
      [
        documentUpdate({ fileId: 'z', mimeType: 'application/octet-stream' }),
        "Can't save this kind of file. I can save photos, PDFs, text notes and links.",
      ],
    ];
    for (const [update, reply] of cases) expect(plan(update)).toEqual({ action: 'refuse', reply });
  });

  it('gives sizes and limits for files and notes that are too big', () => {
    expect(TELEGRAM_REPLIES.tooBig({ kind: 'pdf', name: 'Big notes.pdf', bytes: 31_250_001 })).toBe(
      '"Big notes.pdf" is 31.3 MB, over the 20 MB limit for PDFs, so it wasn\'t saved. Compress it or split it into smaller PDFs, then send them again.',
    );
    expect(TELEGRAM_REPLIES.tooBig({ kind: 'image', bytes: LIMITS.maxImageBytes + 1 })).toBe(
      "This photo is 20.1 MB, over the 20 MB limit for photos, so it wasn't saved. Send a smaller copy, or send it as a photo instead of as a file.",
    );
    expect(TELEGRAM_REPLIES.tooBig({ kind: 'pdf', name: 'Scan.pdf', byTelegram: true })).toBe(
      '"Scan.pdf" is over Telegram\'s 20 MB download limit for bots, so it wasn\'t saved. Compress it or split it into smaller PDFs, then send them again.',
    );
    expect(TELEGRAM_REPLIES.tooBig({ kind: 'pdf' })).toBe(
      "This PDF is over the 20 MB limit for PDFs, so it wasn't saved. Compress it or split it into smaller PDFs, then send them again.",
    );
    expect(TELEGRAM_REPLIES.longNote(23_456)).toBe(
      "This note is 23,456 characters, over the 20,000-character limit for notes, so it wasn't saved. Split it into shorter notes and send them one by one.",
    );
    expect(TELEGRAM_REPLIES.full('Mess menu.pdf', 200_000_000)).toBe(
      'Your Campus Recall cloud library has reached its 200 MB limit, so "Mess menu.pdf" wasn\'t saved. Delete some items in the app to make room, then send it again.',
    );
    expect(TELEGRAM_REPLIES.empty('blank.pdf')).toBe('"blank.pdf" is empty, so it wasn\'t saved.');
  });

  it('formats sizes so a file just over a limit never reads as the limit', () => {
    expect(formatMegabytes(20_000_000)).toBe('20 MB');
    expect(formatMegabytes(20_000_001)).toBe('20.1 MB');
    expect(formatMegabytes(31_250_001)).toBe('31.3 MB');
    expect(formatMegabytes(200_000_000)).toBe('200 MB');
    expect(formatMegabytes(1)).toBe('0.1 MB');
  });

  it('names a file type from its file name, else from its MIME type', () => {
    expect(fileTypeOf('analysis.IPYNB')).toBe('ipynb');
    expect(fileTypeOf('archive.tar.gz')).toBe('gz');
    expect(fileTypeOf('README', 'text/plain')).toBe('txt');
    expect(fileTypeOf(undefined, 'application/msword')).toBe('doc');
    expect(fileTypeOf(undefined, 'application/x-unknown')).toBeUndefined();
    expect(fileTypeOf('no extension')).toBeUndefined();
  });

  it('keeps every refusal and failure to one or two short sentences, without codes', () => {
    const item = { title: 'A rather long lecture title for week nineteen.pdf', kind: 'pdf' };
    const kinds: IndexFailureKind[] = [
      'too-many-pages',
      'password-protected',
      'unreadable-pdf',
      'bad-image',
      'nothing-searchable',
      'library-full',
      'other',
    ];
    const messages = [
      ...kinds.map((kind) =>
        TELEGRAM_REPLIES.notSearchable({ kind, pageCount: 71 }, item, 200_000_000),
      ),
      TELEGRAM_REPLIES.voice,
      TELEGRAM_REPLIES.audio,
      TELEGRAM_REPLIES.video,
      TELEGRAM_REPLIES.videoNote,
      TELEGRAM_REPLIES.gif,
      TELEGRAM_REPLIES.sticker,
      TELEGRAM_REPLIES.location,
      TELEGRAM_REPLIES.contact,
      TELEGRAM_REPLIES.other,
      ...[undefined, 'docx', 'heic', 'txt', 'ipynb'].map(TELEGRAM_REPLIES.unsupportedFile),
      TELEGRAM_REPLIES.tooBig({ kind: 'pdf', name: item.title, bytes: 25_000_000 }),
      TELEGRAM_REPLIES.tooBig({ kind: 'image', byTelegram: true }),
      TELEGRAM_REPLIES.longNote(20_001),
      TELEGRAM_REPLIES.empty(),
      TELEGRAM_REPLIES.notSaved(item.title),
      TELEGRAM_REPLIES.full(item.title, 200_000_000),
      TELEGRAM_REPLIES.downloadFailed,
      TELEGRAM_REPLIES.serverError,
      TELEGRAM_REPLIES.unknownCommand('/frobnicate'),
      TELEGRAM_REPLIES.deleteExpired,
      TELEGRAM_REPLIES.expired,
      TELEGRAM_REPLIES.resumeFirst,
    ];
    for (const message of messages) {
      expect(message.length, message).toBeLessThanOrEqual(240);
      // Sentences end in a full stop followed by a space or the end; "e.g." is never used.
      expect(message.split(/[.!?](?:\s|$)/).filter(Boolean).length, message).toBeLessThanOrEqual(2);
      expect(message).not.toMatch(/[A-Z]{2,}_[A-Z_]+|Error\b|undefined|NaN/);
    }
  });

  it('opens links in the browser, and says the home-screen app needs its own sign-in', () => {
    // On an iPhone a link never opens the home-screen web app, which keeps its own sign-in.
    const homeScreen =
      'Using Campus Recall from your home screen? Sign in there once with the same IITGN account — everything you save here shows up automatically.';
    expect(TELEGRAM_REPLIES.openButton).toBe('Open in browser');
    expect(TELEGRAM_REPLIES.openCta).toBe(
      `Open it in your browser (the link works once, for 10 minutes). ${homeScreen}`,
    );
    expect(TELEGRAM_REPLIES.open).toBe(
      `Open your Campus Recall library in your browser (the link works once, for 10 minutes). ${homeScreen}`,
    );
    expect(TELEGRAM_REPLIES.help('team@example.test')).toContain(
      '/open: open your library in your browser',
    );
    expect(TELEGRAM_REPLIES.appOnly).toBe(
      "This one can't be sent in Telegram. Open it in your browser instead.",
    );
  });

  it('leaves the WhatsApp wording as it was', () => {
    expect(REPLIES.notSearchable('Timetable.pdf')).toBe(
      'Couldn\'t make "Timetable.pdf" searchable, but it is still saved in Campus Recall.',
    );
    expect(REPLIES.file).toBe("Can't save this kind of file yet. Send a PDF or a photo.");
  });
});
