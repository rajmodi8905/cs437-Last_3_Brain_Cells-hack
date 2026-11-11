/// <reference types="node" />
// The real reason reaches the chat, with the real engine: a 71-page PDF made here (the app indexes
// PDFs of at most 50 pages) and a damaged PDF are refused by the app's own engine in the engine
// host, which reports the page count, and the Telegram bot, linked to an account, says why and what
// to do. Nothing calls Telegram or Google; the account is linked directly in the store.
import { expect, test } from '@playwright/test';
import { classifyIndexFailure } from '../server/chat/index-failure';
import { MemoryObjectStore, MemoryPilotStore } from '../server/memory';
import { createTelegramApi } from '../server/telegram/api';
import { TELEGRAM_REPLIES, createTelegramBot, createTelegramIndexer } from '../server/telegram/bot';
import { createTelegramIntake } from '../server/telegram/intake';
import { MemoryTelegramStore, telegramGlobalId } from '../server/telegram/store';
import { EngineIndexError, PlaywrightEngineHost } from '../server/whatsapp/engine-host';
import { MemoryBotStore } from '../server/whatsapp/store';
import {
  BOT_TOKEN,
  ENGINE_MESSAGES,
  USER_A,
  documentUpdate,
  startFakeTelegram,
} from '../tests/telegram-helpers';

const QUOTA = 200_000_000;
const OWNER = 'google:engine-errors-test';
const LECTURE = 'Lecture 19_01_04_2026.pdf';

/** A plain PDF with `pages` pages of text, written by hand (no fixture is changed). */
function makePdf(pages: number) {
  const bodies: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${4 + 2 * i} 0 R`).join(' ')}] /Count ${pages} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  for (let i = 0; i < pages; i++) {
    const text = `BT /F1 18 Tf 72 720 Td (Lecture 19, page ${i + 1}: hostel guest rules and timings.) Tj ET`;
    bodies.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + 2 * i} 0 R >>`,
      `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    );
  }
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  bodies.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

test('Telegram: a 71-page PDF and a damaged PDF get their real reason in the chat', async () => {
  test.setTimeout(900_000);
  const engine = new PlaywrightEngineHost({
    distDir: '.cache/engine-host-dist',
    modelsDir: '.models',
    log: (message, detail) => console.log(message, detail ?? ''),
  });
  const tg = await startFakeTelegram();
  try {
    const long = makePdf(71);
    const damaged = new TextEncoder().encode('%PDF-1.4\nthis is not really a PDF\n%%EOF\n');

    // The engine host itself: the app's message and the page count.
    const refused = await engine
      .index({
        bytes: long,
        kind: 'pdf',
        mimeType: 'application/pdf',
        title: LECTURE,
        createdAt: 1_762_300_000_000,
      })
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    expect(refused).toBeInstanceOf(EngineIndexError);
    expect((refused as EngineIndexError).message).toBe(ENGINE_MESSAGES.pageLimit);
    expect((refused as EngineIndexError).pageCount).toBe(71);
    expect(classifyIndexFailure(refused)).toEqual({ kind: 'too-many-pages', pageCount: 71 });

    // The bot, linked to an account, with the same engine host.
    const stores = {
      bot: new MemoryBotStore(),
      state: new MemoryTelegramStore(),
      store: new MemoryPilotStore(),
      objects: new MemoryObjectStore(),
    };
    const api = createTelegramApi({ token: BOT_TOKEN, baseUrl: tg.base, minIntervalMs: 0 });
    const intake = createTelegramIntake({ bot: stores.bot });
    const bot = createTelegramBot({
      ...stores,
      api,
      quotaBytes: QUOTA,
      engine,
      onIndexJob: createTelegramIndexer({ ...stores, engine, quotaBytes: QUOTA }),
      origin: 'https://recall.example.test',
      privacyUrl: 'https://recall.example.test/telegram-privacy.html',
      contactEmail: 'recall-team@example.test',
      batchMs: 0,
    });
    await stores.state.linkAccount({
      userId: String(USER_A.id),
      ownerKey: OWNER,
      email: 'student.a@iitgn.ac.in',
      linkedAt: 1,
    });
    tg.addFile('long', long);
    tg.addFile('damaged', damaged);
    const updates = [
      documentUpdate({
        fileId: 'long',
        size: long.length,
        mimeType: 'application/pdf',
        fileName: LECTURE,
      }),
      documentUpdate({
        fileId: 'damaged',
        size: damaged.length,
        mimeType: 'application/pdf',
        fileName: 'Broken notes.pdf',
      }),
    ];
    for (const update of updates) await intake(update);
    await bot.drain();
    await bot.flush();

    const texts = tg.textsTo(USER_A.id);
    console.log(JSON.stringify(texts, null, 2));
    expect(texts).toContain(
      '"Lecture 19_01_04_2026.pdf" has 71 pages — search works on PDFs up to 50 pages. It\'s still saved; split it into smaller PDFs to make it searchable.',
    );
    expect(texts).toContain(
      TELEGRAM_REPLIES.notSearchable(
        { kind: 'unreadable-pdf' },
        { title: 'Broken notes.pdf', kind: 'pdf' },
        QUOTA,
      ),
    );
    // Both are still saved, byte for byte, without an index.
    for (const [update, bytes] of [
      [updates[0], long],
      [updates[1], damaged],
    ] as const) {
      const message = update.message as { message_id: number; chat: { id: number } };
      const item = await stores.store.getItem(
        OWNER,
        telegramGlobalId(`m:${message.chat.id}:${message.message_id}`),
      );
      expect(item).toMatchObject({ deleted: false, byteLength: bytes.length });
      expect(item?.index).toBeUndefined();
    }
    expect(engine.blockedRequests).toEqual([]);
  } finally {
    await engine.close();
    await tg.close();
  }
});
