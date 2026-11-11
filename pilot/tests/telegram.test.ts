/// <reference types="node" />
// The Telegram bot against a real local API server (webhook mode), the stand-in Bot API and
// FakeEngineHost: consent (T1), exact originals (T2), no duplicates (T3), the webhook's secret
// token (T4), one vault per user (T5), one-time app links (T6), server indexing (T7), search
// replies with result buttons (T8) and /delete (T9). Runs on memory stores, and on PostgreSQL and
// Azurite with npm run test:pilot:storage.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { LIMITS } from '../../src/shared';
import { createPilotHandler } from '../server/app';
import { AzureBlobObjectStore } from '../server/blob';
import { MemoryObjectStore, MemoryPilotStore } from '../server/memory';
import { PostgresPilotStore } from '../server/postgres';
import type { ObjectStore, PilotStore } from '../server/store';
import { createTelegramApi, type TelegramApi } from '../server/telegram/api';
import {
  TELEGRAM_REPLIES,
  createTelegramBot,
  createTelegramIndexer,
  refuseTelegramUser,
  type TelegramBotOptions,
} from '../server/telegram/bot';
import { createTelegramIntake, type AllowedUsers } from '../server/telegram/intake';
import { PostgresTelegramStore } from '../server/telegram/postgres';
import {
  MemoryTelegramStore,
  TELEGRAM_TABLES,
  telegramGlobalId,
  type TelegramStateStore,
} from '../server/telegram/store';
import { staticKeySource } from '../server/tokens';
import { FakeEngineHost } from '../server/whatsapp/engine-host';
import { hashLinkToken } from '../server/whatsapp/links';
import { REPLIES } from '../server/whatsapp/ingest';
import { PostgresBotStore } from '../server/whatsapp/postgres';
import { MemoryBotStore, jobId, type BotStore } from '../server/whatsapp/store';
import {
  BOT_TOKEN,
  USER_A,
  USER_B,
  USER_NO_NAME,
  WEBHOOK_SECRET,
  callbackUpdate,
  documentUpdate,
  forwardedUpdate,
  jpegBytes,
  messageUpdate,
  pdfBytes,
  photoUpdate,
  startFakeTelegram,
  textUpdate,
  type TgFrom,
} from './telegram-helpers';

const DATABASE = process.env.PILOT_TEST_DATABASE_URL;
const BLOB = process.env.PILOT_TEST_BLOB_CONNECTION;
const ORIGIN = 'https://recall.example.test';
const PRIVACY_URL = 'https://recall.example.test/telegram-privacy.html';
const CONTACT = 'recall-team@example.test';
const NOTICE_VERSION = '2026-11-telegram-test';
const OWNER_A = `tg:${USER_A.id}`;
const OWNER_B = `tg:${USER_B.id}`;
const LINK = /^https:\/\/recall\.example\.test\/api\/v1\/telegram\/open\/([A-Za-z0-9_-]{43})$/;
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

interface Stores {
  store: PilotStore;
  objects: ObjectStore;
  bot: BotStore;
  state: TelegramStateStore;
}
const backends: [string, boolean, () => Promise<Stores>][] = [
  [
    'memory',
    true,
    async () => ({
      store: new MemoryPilotStore(),
      objects: new MemoryObjectStore(),
      bot: new MemoryBotStore(),
      state: new MemoryTelegramStore(),
    }),
  ],
  [
    'PostgreSQL and Azurite',
    !!DATABASE && !!BLOB,
    async () => {
      const store = await PostgresPilotStore.open({
        connectionString: DATABASE!,
        schema: `test_${randomUUID().replaceAll('-', '')}`,
      });
      const objects = await AzureBlobObjectStore.open({
        connectionString: BLOB!,
        container: `test-${randomUUID()}`,
      });
      cleanups.push(async () => {
        await objects.deleteContainerForTests();
        await store.dropSchemaForTests();
        await store.close();
      });
      return {
        store,
        objects,
        bot: new PostgresBotStore(store, TELEGRAM_TABLES),
        state: new PostgresTelegramStore(store),
      };
    },
  ],
];

const cookieOf = (res: Response) =>
  /recall_session=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1];
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

describe.each(backends)('Telegram bot: %s', (name, available, open) => {
  if (!available) {
    it.skip(`needs PILOT_TEST_DATABASE_URL and PILOT_TEST_BLOB_CONNECTION for ${name}`);
    return;
  }

  async function setup(
    over: {
      engine?: FakeEngineHost | false;
      allowed?: AllowedUsers;
      bot?: Partial<TelegramBotOptions>;
    } = {},
  ) {
    const stores = await open();
    const clock = { now: 1_762_300_010 };
    const tg = await startFakeTelegram();
    cleanups.push(tg.close);
    const quotaBytes = 50_000_000;
    const errors: string[] = [];
    const log = (message: string, detail?: unknown) => errors.push(`${message}: ${String(detail)}`);
    const api = createTelegramApi({ token: BOT_TOKEN, baseUrl: tg.base, minIntervalMs: 0 });
    const intake = createTelegramIntake({
      bot: stores.bot,
      ...(over.allowed ? { allowed: over.allowed } : {}),
      onRefused: (refused) => void refuseTelegramUser(api, refused, log),
      nowSeconds: () => clock.now,
    });
    const server: Server = createServer(
      createPilotHandler({
        clientId: 'pilot-client',
        allowedEmailDomain: 'iitgn.ac.in',
        origin: ORIGIN,
        keys: staticKeySource({}),
        store: stores.store,
        objects: stores.objects,
        nowSeconds: () => clock.now,
        quotaBytes,
        telegram: { bot: stores.bot, webhook: { secretToken: WEBHOOK_SECRET, intake } },
      }),
    );
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
    const engine = over.engine === false ? undefined : (over.engine ?? new FakeEngineHost());
    const timers = new Set<() => void>();
    const makeBot = (apiFor: TelegramApi = api, extra: Partial<TelegramBotOptions> = {}) =>
      createTelegramBot({
        ...stores,
        api: apiFor,
        quotaBytes,
        ...(engine
          ? {
              engine,
              onIndexJob: createTelegramIndexer({ ...stores, engine, quotaBytes }),
            }
          : {}),
        origin: ORIGIN,
        privacyUrl: PRIVACY_URL,
        contactEmail: CONTACT,
        noticeVersion: NOTICE_VERSION,
        batchMs: 60_000,
        schedule: (run) => {
          timers.add(run);
          return () => timers.delete(run);
        },
        nowSeconds: () => clock.now,
        log,
        ...over.bot,
        ...extra,
      });
    const telegram = makeBot();
    /** Posts updates to the webhook, as Telegram does, without running a worker. */
    const deliver = async (updates: Record<string, unknown>[]) => {
      for (const update of updates) {
        const res = await fetch(`${base}/telegram/webhook`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-telegram-bot-api-secret-token': WEBHOOK_SECRET,
          },
          body: JSON.stringify(update),
        });
        expect(res.status).toBe(200);
      }
    };
    /** Delivers updates, runs the worker and sends waiting confirmations. */
    const send = async (...updates: Record<string, unknown>[]) => {
      await deliver(updates);
      await telegram.drain();
      await telegram.flush();
      return updates;
    };
    /** Opens the chat and taps Agree, as every student does first. */
    const agree = async (from: TgFrom = USER_A) => {
      await send(textUpdate('/start', from));
      await send(callbackUpdate('agree', from));
    };
    const liveItems = async (ownerKey = OWNER_A) => {
      const { changes } = await stores.store.changesAfter(ownerKey, 0);
      const found = [];
      for (const id of new Set(changes.map((change) => change.item.globalId))) {
        const item = await stores.store.getItem(ownerKey, id);
        if (item && !item.deleted) found.push(item);
      }
      return found;
    };
    const keyOf = (update: Record<string, unknown>) => {
      const message = update.message as { message_id: number; chat: { id: number } } | undefined;
      const callback = update.callback_query as { id: string } | undefined;
      return message ? `m:${message.chat.id}:${message.message_id}` : `c:${callback!.id}`;
    };
    const sessionFor = async (ownerKey: string) => {
      const cookie = randomBytes(32).toString('base64url');
      await stores.store.createSession({
        id: createHash('sha256').update(cookie).digest('hex'),
        csrf: 'csrf',
        ownerKey,
        email: '',
        expiresAt: clock.now + 3600,
      });
      return cookie;
    };
    const get = (path: string, cookie?: string) =>
      fetch(`${base}${path}`, { headers: cookie ? { cookie: `recall_session=${cookie}` } : {} });
    /** The URL on the last message's first button. */
    const lastButtonUrl = (from: TgFrom = USER_A) =>
      tg.to(from.id).at(-1)?.replyMarkup?.inline_keyboard[0]?.[0]?.url;
    /** Sends /open and returns the link's token. */
    const openLink = async (from: TgFrom = USER_A) => {
      await send(textUpdate('/open', from));
      const match = LINK.exec(lastButtonUrl(from) ?? '');
      expect(match).not.toBeNull();
      return match![1];
    };
    const follow = (token: string, origin: string | null = ORIGIN) =>
      fetch(`${base}/telegram/open/${token}`, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          ...(origin ? { origin } : {}),
        },
        body: '',
      });
    /** Searches and returns the result buttons' data, best first. */
    const searchButtons = async (query: string, from: TgFrom = USER_A) => {
      await send(textUpdate(query, from));
      const reply = tg.to(from.id).at(-1)!;
      return (reply.replyMarkup?.inline_keyboard ?? []).map((row) => row[0].callback_data!);
    };
    /** Searches and returns the data of the button whose label names `title`. */
    const buttonFor = async (query: string, title: string, from: TgFrom = USER_A) => {
      await send(textUpdate(query, from));
      const rows = tg.to(from.id).at(-1)?.replyMarkup?.inline_keyboard ?? [];
      const row = rows.find((r) => r[0].text.includes(title));
      expect(row).toBeDefined();
      return row![0].callback_data!;
    };
    return {
      ...stores,
      clock,
      tg,
      api,
      engine,
      errors,
      base,
      telegram,
      makeBot,
      intake,
      timers,
      deliver,
      send,
      agree,
      liveItems,
      keyOf,
      sessionFor,
      get,
      lastButtonUrl,
      openLink,
      follow,
      searchButtons,
      buttonFor,
    };
  }

  describe('T1 consent before anything is stored', () => {
    it('sends the notice once with an Agree button, and stores nothing before Agree', async () => {
      const t = await setup();
      const photo = jpegBytes();
      t.tg.addFile('p-1', photo);
      const updates = await t.send(
        forwardedUpdate('Hostel curfew is 11 pm'),
        photoUpdate([{ fileId: 'p-1', size: photo.length, width: 800, height: 600 }]),
        textUpdate('note Mess timings 8 to 10'),
      );
      expect(await t.liveItems()).toEqual([]);
      expect(t.tg.state.getFileCalls).toEqual([]);
      const sent = t.tg.to(USER_A.id);
      expect(sent).toHaveLength(1);
      const notice = sent[0].text!;
      for (const part of [
        'photos, PDFs and notes',
        'Our server stores and processes your files',
        'sees your searches',
        'Telegram keeps bot chats on its own servers',
        'not end-to-end encrypted',
        '18 or older',
        '/delete',
        `Privacy: ${PRIVACY_URL}`,
      ])
        expect(notice).toContain(part);
      expect(notice.trim().endsWith('Tap Agree (or reply AGREE) to start.')).toBe(true);
      expect(sent[0].replyMarkup).toEqual({
        inline_keyboard: [[{ text: 'Agree', callback_data: 'agree' }]],
      });
      // Only each message's key and type are kept.
      for (const update of updates) {
        const kept = await t.bot.getInbound(t.keyOf(update));
        expect(kept?.message).toEqual({ id: t.keyOf(update), type: 'message' });
      }
      await t.send(textUpdate('anything'));
      expect(t.tg.to(USER_A.id)).toHaveLength(1);
      expect((await t.bot.senderState(String(USER_A.id))).consentedAt).toBeUndefined();
    });

    it('records consent from the Agree button with the notice version, then saves', async () => {
      const t = await setup();
      await t.send(textUpdate('/start'));
      t.clock.now += 30;
      const [tap] = await t.send(callbackUpdate('agree'));
      const tapId = (tap.callback_query as { id: string }).id;
      expect(t.tg.state.answered.map((a) => a.id)).toContain(tapId);
      expect(await t.bot.senderState(String(USER_A.id))).toMatchObject({
        consentedAt: t.clock.now,
        noticeVersion: NOTICE_VERSION,
      });
      expect(t.tg.textsTo(USER_A.id).at(-1)).toBe(TELEGRAM_REPLIES.agreed);
      await t.send(textUpdate('note Library closes at midnight'));
      expect((await t.liveItems()).map((item) => item.title)).toEqual([
        'Library closes at midnight',
      ]);
      expect(t.tg.textsTo(USER_A.id).at(-1)).toBe(REPLIES.saved('Library closes at midnight'));
    });

    it('accepts a typed AGREE, and each user consents for themselves', async () => {
      const t = await setup();
      await t.send(textUpdate('hello', USER_B));
      await t.send(textUpdate('agree.', USER_B));
      expect((await t.bot.senderState(String(USER_B.id))).consentedAt).toBeDefined();
      expect((await t.bot.senderState(String(USER_A.id))).consentedAt).toBeUndefined();
      // Agree before any notice only gets the notice.
      await t.send(textUpdate('AGREE'));
      expect((await t.bot.senderState(String(USER_A.id))).consentedAt).toBeUndefined();
      expect(t.tg.textsTo(USER_A.id)).toEqual([TELEGRAM_REPLIES.notice(PRIVACY_URL)]);
    });

    it('answers /help and /privacy before consent, sends the notice again on /start, and acknowledges other taps', async () => {
      const t = await setup();
      await t.send(textUpdate('/start'));
      await t.send(textUpdate('/help'), textUpdate('/privacy'), textUpdate('/delete'));
      const [start] = await t.send(textUpdate('/start promo'));
      const [tap] = await t.send(callbackUpdate('delete'));
      expect(t.tg.textsTo(USER_A.id)).toEqual([
        TELEGRAM_REPLIES.notice(PRIVACY_URL),
        TELEGRAM_REPLIES.help(CONTACT),
        TELEGRAM_REPLIES.privacy(PRIVACY_URL),
        TELEGRAM_REPLIES.nothingStored,
        TELEGRAM_REPLIES.notice(PRIVACY_URL),
      ]);
      expect(await t.bot.getInbound(t.keyOf(start))).toMatchObject({
        message: { id: t.keyOf(start), type: 'message' },
      });
      expect(t.tg.state.answered).toContainEqual({
        id: (tap.callback_query as { id: string }).id,
        text: TELEGRAM_REPLIES.tapAgree,
      });
    });

    it('sends the notice with the next message when it could not be sent', async () => {
      const t = await setup();
      t.tg.state.failSends = 1;
      await t.send(textUpdate('hi'));
      expect(t.tg.to(USER_A.id)).toEqual([]);
      await t.send(textUpdate('hi again'));
      expect(t.tg.textsTo(USER_A.id)).toEqual([TELEGRAM_REPLIES.notice(PRIVACY_URL)]);
    });

    it('after /stop saves and answers nothing until /resume', async () => {
      const t = await setup();
      await t.agree();
      await t.send(textUpdate('/stop'));
      const [note] = await t.send(textUpdate('note while stopped'));
      expect(await t.liveItems()).toEqual([]);
      expect(await t.bot.getInbound(t.keyOf(note))).toMatchObject({
        message: { id: t.keyOf(note), type: 'message' },
      });
      await t.send(textUpdate('/resume'));
      await t.send(textUpdate('note after resume'));
      expect(t.tg.textsTo(USER_A.id).slice(-3)).toEqual([
        TELEGRAM_REPLIES.stopped,
        TELEGRAM_REPLIES.started,
        REPLIES.saved('after resume'),
      ]);
    });

    it('stores nothing from a save still downloading when /delete is confirmed by another worker', async () => {
      const t = await setup();
      await t.agree();
      const photo = jpegBytes(3000, 7);
      t.tg.addFile('slow', photo);
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      let reached!: () => void;
      const downloading = new Promise<void>((resolve) => (reached = resolve));
      const slowApi: TelegramApi = {
        ...t.api,
        async getFile(id) {
          reached();
          await held;
          return t.api.getFile(id);
        },
      };
      const slow = t.makeBot(slowApi);
      await t.deliver([
        photoUpdate([{ fileId: 'slow', size: photo.length, width: 10, height: 10 }]),
      ]);
      const first = slow.runOnce();
      await downloading;
      await t.send(textUpdate('/delete'));
      await t.send(callbackUpdate('delete'));
      release();
      await first;
      await slow.flush();
      expect(await t.liveItems()).toEqual([]);
      expect(t.tg.textsTo(USER_A.id).some((text) => text.startsWith('Saved'))).toBe(false);
    });
  });

  describe('T2 exact original', () => {
    it('saves the largest photo size and a PDF byte for byte with our own SHA-256', async () => {
      const t = await setup();
      await t.agree();
      const small = jpegBytes(900, 2);
      const large = jpegBytes(7000, 3);
      const pdf = pdfBytes('Guest rules. ');
      t.tg.addFile('small', small);
      t.tg.addFile('large', large);
      t.tg.addFile('pdf-1', pdf);
      const [photo, doc] = await t.send(
        photoUpdate(
          [
            { fileId: 'small', size: small.length, width: 90, height: 60 },
            { fileId: 'large', size: large.length, width: 1280, height: 960 },
          ],
          USER_A,
          'Notice board',
        ),
        documentUpdate({
          fileId: 'pdf-1',
          size: pdf.length,
          mimeType: 'application/pdf',
          fileName: 'Guest rules.pdf',
        }),
      );
      expect(t.tg.state.getFileCalls).toEqual(['large', 'pdf-1']);
      const cookie = await t.sessionFor(OWNER_A);
      for (const [update, bytes, kind, title] of [
        [photo, large, 'image', 'Notice board'],
        [doc, pdf, 'pdf', 'Guest rules.pdf'],
      ] as const) {
        const item = (await t.store.getItem(OWNER_A, telegramGlobalId(t.keyOf(update))))!;
        expect(item).toMatchObject({
          kind,
          title,
          contentSha256: sha256(bytes),
          byteLength: bytes.length,
        });
        const res = await t.get(`/items/${item.globalId}/original`, cookie);
        expect(res.status).toBe(200);
        expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
      }
      expect(t.tg.textsTo(USER_A.id).at(-1)).toBe(
        TELEGRAM_REPLIES.savedMany(['Notice board', 'Guest rules.pdf']),
      );
    });

    it('never stores bytes whose size differs from what Telegram declared, and retries', async () => {
      const t = await setup();
      await t.agree();
      const png = jpegBytes(4000, 5);
      t.tg.addFile('png', png);
      t.tg.state.truncateDownloads = 1;
      const [doc] = await t.send(
        documentUpdate({
          fileId: 'png',
          size: png.length,
          mimeType: 'image/png',
          fileName: 'map.png',
        }),
      );
      expect(await t.liveItems()).toEqual([]);
      const job = await t.bot.getJob(jobId('ingest', t.keyOf(doc)));
      expect(job).toMatchObject({ state: 'pending', lastError: expect.stringMatching(/size/) });
      t.clock.now += 60;
      await t.telegram.drain();
      await t.telegram.flush();
      const [item] = await t.liveItems();
      expect(item).toMatchObject({
        kind: 'image',
        mimeType: 'image/png',
        contentSha256: sha256(png),
      });
    });

    it('refuses files over the app limit before downloading, and files Telegram will not serve', async () => {
      const t = await setup();
      await t.agree();
      t.tg.addFile('huge', new Uint8Array(10));
      await t.send(
        documentUpdate({
          fileId: 'huge',
          size: LIMITS.maxPdfBytes + 1,
          mimeType: 'application/pdf',
        }),
        photoUpdate([
          { fileId: 'huge', size: LIMITS.maxImageBytes + 1, width: 9000, height: 9000 },
        ]),
      );
      expect(t.tg.state.getFileCalls).toEqual([]);
      t.tg.state.fileTooBig = true;
      await t.send(documentUpdate({ fileId: 'huge', mimeType: 'application/pdf' }));
      expect(t.tg.state.downloads).toEqual([]);
      expect(await t.liveItems()).toEqual([]);
      expect(t.tg.textsTo(USER_A.id).slice(-3)).toEqual([
        REPLIES.bigPdf,
        REPLIES.bigImage,
        REPLIES.bigPdf,
      ]);
    });

    it('refuses voice notes, audio, video, stickers and Office files with plain reasons', async () => {
      const t = await setup();
      await t.agree();
      const file = { file_id: 'x', file_unique_id: 'ux' };
      await t.send(
        messageUpdate({ voice: { ...file, mime_type: 'audio/ogg' } }),
        messageUpdate({ audio: { ...file, mime_type: 'audio/mpeg' } }),
        messageUpdate({ video: { ...file, mime_type: 'video/mp4' } }),
        messageUpdate({ sticker: file }),
        documentUpdate({
          fileId: 'docx',
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
        messageUpdate({ location: { latitude: 23.2, longitude: 72.6 } }),
      );
      expect(await t.liveItems()).toEqual([]);
      expect(t.tg.textsTo(USER_A.id).slice(-6)).toEqual([
        REPLIES.voice,
        REPLIES.audio,
        REPLIES.video,
        REPLIES.sticker,
        REPLIES.file,
        REPLIES.location,
      ]);
    });

    it('saves forwarded text, note and save prefixes and single links, and searches anything else', async () => {
      const t = await setup({ engine: false });
      await t.agree();
      await t.send(
        forwardedUpdate('Bus leaves at 7'),
        messageUpdate({ text: '/help', forward_date: 1_762_000_000 }),
        textUpdate('SAVE Room 204 key'),
        textUpdate('https://iitgn.ac.in/timetable'),
        textUpdate('where is the bus'),
      );
      const items = await t.liveItems();
      expect(items.map((item) => item.title).sort()).toEqual(
        ['/help', 'Bus leaves at 7', 'Room 204 key', 'https://iitgn.ac.in/timetable'].sort(),
      );
      expect(items.find((item) => item.title.startsWith('https'))?.sourceUrl).toBe(
        'https://iitgn.ac.in/timetable',
      );
      // The forwarded "/help" was saved, not answered as a command.
      expect(t.tg.textsTo(USER_A.id)).not.toContain(TELEGRAM_REPLIES.help(CONTACT));
      expect(
        t.tg
          .textsTo(USER_A.id)
          .some((text) => text.startsWith('Best matches for “where is the bus”')),
      ).toBe(true);
    });
  });

  describe('T3 no duplicates from redelivery', () => {
    it('one item and one confirmation for a repeated, concurrent or doubly worked update', async () => {
      const t = await setup();
      await t.agree();
      const update = textUpdate('note Exam hall B12');
      await t.deliver([update, update]);
      await Promise.all([1, 2, 3].map(() => t.deliver([update])));
      const second = t.makeBot();
      await Promise.all([t.telegram.drain(), second.drain()]);
      await t.telegram.flush();
      await second.flush();
      await t.send(update);
      expect(await t.liveItems()).toHaveLength(1);
      expect(t.tg.textsTo(USER_A.id).filter((text) => text.startsWith('Saved'))).toHaveLength(1);
    });

    it('a redelivered button tap is answered once', async () => {
      const t = await setup();
      await t.agree();
      const tap = callbackUpdate('agree');
      await t.send(tap, tap);
      const id = (tap.callback_query as { id: string }).id;
      expect(t.tg.state.answered.filter((a) => a.id === id)).toHaveLength(1);
    });

    it('a job that crashed after publishing its item is retried without a second item or reply', async () => {
      const t = await setup();
      await t.agree();
      const update = textUpdate('note Lab manual');
      await t.deliver([update]);
      // The first worker fails right after publishing (queueing the index job throws once).
      let crash = true;
      const crashing: BotStore = Object.create(t.bot, {
        enqueue: {
          value: async (...args: Parameters<BotStore['enqueue']>) => {
            if (args[0] === 'index' && crash) {
              crash = false;
              throw new Error('worker crashed');
            }
            return t.bot.enqueue(...args);
          },
        },
      });
      await t.makeBot(t.api, { bot: crashing }).runOnce();
      expect(t.errors.some((line) => line.includes('worker crashed'))).toBe(true);
      t.clock.now += 400;
      await t.telegram.drain();
      await t.telegram.flush();
      await t.send(update);
      expect(await t.liveItems()).toHaveLength(1);
      expect(t.tg.textsTo(USER_A.id).filter((text) => text.startsWith('Saved'))).toEqual([
        REPLIES.saved('Lab manual'),
      ]);
    });
  });

  describe('T4 webhook secret token', () => {
    it('refuses a missing or wrong secret token before reading the update', async () => {
      const t = await setup();
      const update = textUpdate('note should not be stored');
      const post = (headers: Record<string, string>) =>
        fetch(`${t.base}/telegram/webhook`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...headers },
          body: JSON.stringify(update),
        });
      expect((await post({})).status).toBe(401);
      expect(
        (await post({ 'x-telegram-bot-api-secret-token': 'wrong-secret-0123456789' })).status,
      ).toBe(403);
      expect((await post({ 'x-telegram-bot-api-secret-token': `${WEBHOOK_SECRET}x` })).status).toBe(
        403,
      );
      expect((await fetch(`${t.base}/telegram/webhook`)).status).toBe(404);
      expect(await t.bot.getInbound(t.keyOf(update))).toBeUndefined();
      expect(await t.telegram.drain()).toBe(0);
      expect(t.tg.state.sent).toEqual([]);
    });

    it('ignores group chats, other bots and malformed updates', async () => {
      const t = await setup();
      const group = textUpdate('note in a group');
      (group.message as { chat: { id: number; type: string } }).chat = {
        id: -100123,
        type: 'group',
      };
      const fromBot = textUpdate('note from a bot');
      (fromBot.message as { from: { is_bot: boolean } }).from.is_bot = true;
      await t.send(group, fromBot, { update_id: 1 }, { update_id: 2, message: { text: 'x' } });
      expect(await t.telegram.drain()).toBe(0);
      expect(t.tg.state.sent).toEqual([]);
    });
  });

  describe('T5 one vault per Telegram user', () => {
    it('keeps each user’s items in their own tg: vault', async () => {
      const t = await setup();
      await t.agree(USER_A);
      await t.agree(USER_B);
      const [a] = await t.send(textUpdate('note A secret', USER_A));
      const [b] = await t.send(textUpdate('note B secret', USER_B));
      expect((await t.liveItems(OWNER_A)).map((item) => item.title)).toEqual(['A secret']);
      expect((await t.liveItems(OWNER_B)).map((item) => item.title)).toEqual(['B secret']);
      const itemA = (await t.store.getItem(OWNER_A, telegramGlobalId(t.keyOf(a))))!;
      expect(itemA.objectKey?.startsWith(`${OWNER_A}/`)).toBe(true);
      const cookieB = await t.sessionFor(OWNER_B);
      const res = await t.get(`/items/${itemA.globalId}/original`, cookieB);
      expect(res.status).toBe(404);
      expect(await t.store.getItem(OWNER_B, telegramGlobalId(t.keyOf(b)))).toBeDefined();
      // A's result button tapped by B finds nothing in B's vault.
      const [button] = await t.searchButtons('secret', USER_A);
      await t.send(callbackUpdate(button, USER_B));
      expect(t.tg.textsTo(USER_B.id).at(-1)).toBe(TELEGRAM_REPLIES.gone);
    });
  });

  describe('T6 one-time app link', () => {
    it('opens a normal session for the tg: vault once, from the pilot origin only', async () => {
      const t = await setup();
      await t.agree();
      await t.send(textUpdate('note Hostel rules'));
      const token = await t.openLink();
      expect(t.tg.to(USER_A.id).at(-1)?.text).toBe(TELEGRAM_REPLIES.open);
      expect(await t.bot.peekLink(hashLinkToken(token), t.clock.now)).toMatchObject({
        ownerKey: OWNER_A,
        label: 'Telegram @student_a',
      });
      expect(await t.bot.peekLink(token, t.clock.now)).toBeUndefined();

      const page = await t.get(`/telegram/open/${token}`);
      expect(page.status).toBe(200);
      const html = await page.text();
      expect(html).toContain('Open your Telegram library');
      expect(html).toContain('Telegram @student_a');
      expect(html).not.toContain('<script');
      expect(page.headers.get('content-security-policy')).toContain("default-src 'none'");

      expect((await t.follow(token, 'https://evil.example')).status).toBe(403);
      expect((await t.follow(token, null)).status).toBe(403);
      const res = await t.follow(token);
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe(`${ORIGIN}/?signin=telegram#/settings`);
      const session = await (await t.get('/session', cookieOf(res))).json();
      expect(session).toMatchObject({ email: 'Telegram @student_a', kind: 'telegram' });
      const changes = await (
        await t.get(`/changes?epoch=${session.vault.epoch}&after=0`, cookieOf(res))
      ).json();
      expect(
        new Set(changes.changes.map((c: { item: { title: string } }) => c.item.title)),
      ).toEqual(new Set(['Hostel rules']));
      // Used up.
      expect((await t.follow(token)).status).toBe(404);
      const again = await t.get(`/telegram/open/${token}`);
      expect(again.status).toBe(404);
      expect(await again.text()).toContain('Send /open to the Campus Recall Telegram bot');
    });

    it('expires after 10 minutes, labels users without a username, and is not a WhatsApp link', async () => {
      const t = await setup();
      await t.agree(USER_NO_NAME);
      const token = await t.openLink(USER_NO_NAME);
      expect((await t.bot.peekLink(hashLinkToken(token), t.clock.now))?.label).toBe(
        'your Telegram account',
      );
      expect((await t.get(`/whatsapp/open/${token}`)).status).toBe(404);
      t.clock.now += 601;
      expect((await t.follow(token)).status).toBe(404);
      expect((await t.follow('not-a-token')).status).toBe(404);
    });

    it('explains that app links need the tunnel when the origin cannot open on a phone', async () => {
      const t = await setup({ bot: { appLinks: false } });
      await t.agree();
      await t.send(textUpdate('/open'));
      expect(t.tg.textsTo(USER_A.id).at(-1)).toBe(TELEGRAM_REPLIES.noLinks);
      expect(t.lastButtonUrl()).toBeUndefined();
    });
  });

  describe('T7 server indexing', () => {
    it('indexes each saved item with the engine host and publishes its bundle', async () => {
      const t = await setup();
      await t.agree();
      const pdf = pdfBytes('Library rules. ');
      t.tg.addFile('lib', pdf);
      const [doc] = await t.send(
        documentUpdate({
          fileId: 'lib',
          size: pdf.length,
          mimeType: 'application/pdf',
          fileName: 'Library.pdf',
        }),
      );
      const item = (await t.store.getItem(OWNER_A, telegramGlobalId(t.keyOf(doc))))!;
      expect(item.index).toMatchObject({ contentSha256: item.contentSha256 });
      expect(item.indexObjectKey).toBe(`${OWNER_A}/1/${item.globalId}/index`);
      expect(t.engine!.calls.map((call) => call.title)).toEqual(['Library.pdf']);
    });
  });

  describe('T8 search in Telegram', () => {
    it('answers with up to five result buttons whose tokens stay within 64 bytes', async () => {
      const t = await setup();
      await t.agree();
      for (let i = 1; i <= 7; i++) await t.send(textUpdate(`note Rule number ${i}`));
      const buttons = await t.searchButtons('rules');
      expect(buttons).toHaveLength(5);
      for (const data of buttons) {
        expect(data).toMatch(/^p:[A-Za-z0-9_-]{12}$/);
        expect(Buffer.byteLength(data)).toBeLessThanOrEqual(64);
      }
      const reply = t.tg.to(USER_A.id).at(-1)!;
      expect(reply.text).toContain('Best matches for “rules”. Tap one to get it back.');
      expect(reply.text).toContain('1. Rule number');
    });

    it('sends a photo, a PDF and a note back, each with an Open in app button', async () => {
      const t = await setup();
      await t.agree();
      const photo = jpegBytes(6000, 9);
      const pdf = pdfBytes('Guests need a pass. ');
      t.tg.addFile('ph', photo);
      t.tg.addFile('gr', pdf);
      await t.send(
        photoUpdate(
          [{ fileId: 'ph', size: photo.length, width: 800, height: 600 }],
          USER_A,
          'Mess menu',
        ),
        documentUpdate({
          fileId: 'gr',
          size: pdf.length,
          mimeType: 'application/pdf',
          fileName: 'Guest rules.pdf',
        }),
        textUpdate('note Wifi password is on the board'),
      );
      const before = t.tg.state.answered.length;
      const titles: Record<string, string> = {
        mess: 'Mess menu',
        guest: 'Guest rules',
        wifi: 'Wifi password',
      };
      for (const [query, check] of [
        [
          'mess',
          () => {
            const sent = t.tg.to(USER_A.id).at(-2)!;
            expect(sent.method).toBe('sendPhoto');
            expect(sent.file?.bytes).toEqual(photo);
            expect(sent.caption).toBe('Mess menu');
          },
        ],
        [
          'guest',
          () => {
            const sent = t.tg.to(USER_A.id).at(-2)!;
            expect(sent.method).toBe('sendDocument');
            expect(sent.file).toMatchObject({
              filename: 'Guest rules.pdf',
              mimeType: 'application/pdf',
            });
            expect(sent.file?.bytes).toEqual(pdf);
            expect(sent.caption).toBe('Guest rules.pdf (p. 1)');
          },
        ],
        [
          'wifi',
          () => {
            expect(t.tg.to(USER_A.id).at(-2)?.text).toBe('Wifi password is on the board');
          },
        ],
      ] as const) {
        const first = await t.buttonFor(query, titles[query]);
        await t.send(callbackUpdate(first));
        check();
        const cta = t.tg.to(USER_A.id).at(-1)!;
        expect(cta.text).toBe(TELEGRAM_REPLIES.openCta);
        expect(cta.replyMarkup?.inline_keyboard[0][0].text).toBe('Open in app');
        const token = LINK.exec(cta.replyMarkup?.inline_keyboard[0][0].url ?? '')![1];
        expect((await t.follow(token)).status).toBe(303);
      }
      expect(t.tg.state.answered.length - before).toBe(3);
    });

    it('matches items still being indexed by title, says when search is by keyword, and reports no match', async () => {
      const t = await setup({ engine: false });
      await t.agree();
      await t.send(textUpdate('note Badminton team signup'));
      await t.searchButtons('badminton');
      const reply = t.tg.to(USER_A.id).at(-1)!;
      expect(reply.text).toContain('Badminton team signup (Note · title match)');
      expect(reply.text).toContain(TELEGRAM_REPLIES.keywordOnly);
      await t.send(textUpdate('cricket'));
      expect(t.tg.textsTo(USER_A.id).at(-1)).toBe(TELEGRAM_REPLIES.noResults('cricket', true));
    });

    it('expires result buttons, and answers every tap', async () => {
      const t = await setup();
      await t.agree();
      await t.send(textUpdate('note Timetable'));
      const [button] = await t.searchButtons('timetable');
      t.clock.now += 86_401;
      const [tap] = await t.send(callbackUpdate(button));
      expect(t.tg.textsTo(USER_A.id).at(-1)).toBe(TELEGRAM_REPLIES.expired);
      expect(t.tg.state.answered.map((a) => a.id)).toContain(
        (tap.callback_query as { id: string }).id,
      );
      await t.send(callbackUpdate('p:AAAAAAAAAAAA'));
      expect(t.tg.textsTo(USER_A.id).at(-1)).toBe(TELEGRAM_REPLIES.expired);
    });
  });

  describe('T9 /delete', () => {
    it('erases the vault, sessions, links and buttons after the confirm button, and leaves others alone', async () => {
      const t = await setup();
      await t.agree(USER_A);
      await t.agree(USER_B);
      const pdf = pdfBytes('Erase me. ');
      t.tg.addFile('erase', pdf);
      const [doc] = await t.send(
        documentUpdate({
          fileId: 'erase',
          size: pdf.length,
          mimeType: 'application/pdf',
          fileName: 'Erase.pdf',
        }),
      );
      await t.send(textUpdate('note B keeps this', USER_B));
      const item = (await t.store.getItem(OWNER_A, telegramGlobalId(t.keyOf(doc))))!;
      const [button] = await t.searchButtons('erase');
      const linkCookie = cookieOf(await t.follow(await t.openLink()));
      const storeCookie = await t.sessionFor(OWNER_A);
      const unused = await t.openLink();
      const cookieB = await t.sessionFor(OWNER_B);
      const { epoch } = await t.store.vault(OWNER_A);

      await t.send(textUpdate('/delete'));
      const ask = t.tg.to(USER_A.id).at(-1)!;
      expect(ask.text).toBe(TELEGRAM_REPLIES.deleteAsk);
      expect(ask.replyMarkup).toEqual({
        inline_keyboard: [[{ text: 'Yes, erase everything', callback_data: 'delete' }]],
      });
      expect(await t.liveItems()).toHaveLength(1);
      t.clock.now += 599;
      await t.send(callbackUpdate('delete'));
      expect(t.tg.textsTo(USER_A.id).at(-1)).toBe(TELEGRAM_REPLIES.deleted);
      expect(await t.liveItems()).toEqual([]);
      expect((await t.store.vault(OWNER_A)).epoch).toBe(epoch + 1);
      expect(await t.objects.get(item.objectKey!)).toBeUndefined();
      expect(await t.objects.get(item.indexObjectKey!)).toBeUndefined();
      for (const cookie of [linkCookie, storeCookie])
        expect((await t.get('/session', cookie)).status).toBe(401);
      expect((await t.follow(unused)).status).toBe(404);
      expect(await t.state.getPick(button.slice(2), t.clock.now)).toBeUndefined();
      expect((await t.bot.getInbound(t.keyOf(doc)))?.message).toEqual({
        id: t.keyOf(doc),
        type: 'message',
      });
      expect(await t.bot.senderState(String(USER_A.id))).toEqual({});
      expect((await t.bot.getSender(String(USER_A.id)))?.waId).toBeUndefined();
      // A redelivered update does not bring the item back; the next message gets the notice.
      await t.send(doc);
      expect(await t.liveItems()).toEqual([]);
      await t.send(textUpdate('hello again'));
      expect(t.tg.textsTo(USER_A.id).at(-1)).toBe(TELEGRAM_REPLIES.notice(PRIVACY_URL));
      // B is untouched.
      expect((await t.liveItems(OWNER_B)).map((i) => i.title)).toEqual(['B keeps this']);
      expect((await t.get('/session', cookieB)).status).toBe(200);
      expect((await t.bot.senderState(String(USER_B.id))).consentedAt).toBeDefined();
    });

    it('erases nothing without /delete, or when the button is tapped after 10 minutes', async () => {
      const t = await setup();
      await t.agree();
      await t.send(textUpdate('note Keep me'));
      await t.send(callbackUpdate('delete'));
      expect(t.tg.textsTo(USER_A.id).at(-1)).toBe(TELEGRAM_REPLIES.deleteNotAsked);
      await t.send(textUpdate('/delete'));
      t.clock.now += 601;
      await t.send(callbackUpdate('delete'));
      expect(t.tg.textsTo(USER_A.id).at(-1)).toBe(TELEGRAM_REPLIES.deleteExpired);
      expect(await t.liveItems()).toHaveLength(1);
    });
  });

  describe('Commands', () => {
    it('answers the menu commands once agreed, and unknown commands with a pointer to /help', async () => {
      const t = await setup();
      await t.agree();
      await t.send(
        textUpdate('/start'),
        textUpdate('/help@test_bot'),
        textUpdate('/privacy'),
        textUpdate('/resume'),
        textUpdate('/frobnicate'),
        textUpdate('AGREE'),
      );
      expect(t.tg.textsTo(USER_A.id).slice(-6)).toEqual([
        TELEGRAM_REPLIES.alreadyOn,
        TELEGRAM_REPLIES.help(CONTACT),
        TELEGRAM_REPLIES.privacy(PRIVACY_URL),
        TELEGRAM_REPLIES.alreadyOn,
        TELEGRAM_REPLIES.unknownCommand,
        TELEGRAM_REPLIES.alreadyAgreed,
      ]);
      // /help lists the bot's menu (BotFather's /setcommands list in docs/pilot/telegram-setup.md).
      for (const command of ['/open', '/privacy', '/stop', '/resume', '/delete'])
        expect(TELEGRAM_REPLIES.help(CONTACT)).toContain(command);
    });
  });

  describe('Allowed users', () => {
    it('stores nothing from other users and tells them once that the bot is not open yet', async () => {
      const t = await setup({
        allowed: { ids: new Set([String(USER_A.id)]), usernames: new Set(['student_b']) },
      });
      const other = { id: 700_000_099, username: 'someone_else' };
      const update = textUpdate('note not allowed', other);
      await t.send(update, update);
      expect(await t.bot.getInbound(t.keyOf(update))).toBeUndefined();
      expect(await t.bot.getSender(String(other.id))).toBeUndefined();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(t.tg.textsTo(other.id)).toEqual([TELEGRAM_REPLIES.notOpen]);
      // Allowed by ID and by username.
      await t.agree(USER_A);
      await t.agree(USER_B);
      expect((await t.bot.senderState(String(USER_A.id))).consentedAt).toBeDefined();
      expect((await t.bot.senderState(String(USER_B.id))).consentedAt).toBeDefined();
    });
  });
});
