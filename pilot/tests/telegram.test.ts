/// <reference types="node" />
// The Telegram bot against a real local API server (webhook mode), the stand-in Bot API,
// FakeEngineHost and test-signed ID tokens standing in for Google: nothing stored before login
// (T1), exact originals (T2), no duplicates (T3), the webhook's secret token (T4), linked accounts
// kept apart (T5), the login and app links (T6), server indexing (T7), search over the linked
// library (T8), /delete and /logout (T9). Runs on memory stores, and on PostgreSQL and Azurite
// with npm run test:pilot:storage. Google sign-in itself is driven against a stand-in for
// Google's token endpoint, as in google-signin.test.ts.
import { createHash, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { LIMITS } from '../../src/shared';
import { INDEX_DIMENSION, searchMetadataDigest } from '../contract';
import { createPilotHandler } from '../server/app';
import { AzureBlobObjectStore } from '../server/blob';
import { NOTE_MIME } from '../server/chat/items';
import { MemoryObjectStore, MemoryPilotStore } from '../server/memory';
import { PostgresPilotStore } from '../server/postgres';
import type { ObjectStore, PilotStore } from '../server/store';
import { createTelegramApi, type TelegramApi } from '../server/telegram/api';
import {
  TELEGRAM_REPLIES,
  announceTelegramLink,
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
import { EngineIndexError, FakeEngineHost } from '../server/whatsapp/engine-host';
import { hashLinkToken } from '../server/whatsapp/links';
import { REPLIES } from '../server/whatsapp/ingest';
import { PostgresBotStore } from '../server/whatsapp/postgres';
import { MemoryBotStore, jobId, type BotStore } from '../server/whatsapp/store';
import {
  BOT_TOKEN,
  CLIENT_ID,
  ENGINE_MESSAGES,
  ID_KEY,
  ID_KEY_ID,
  USER_A,
  USER_B,
  USER_NO_NAME,
  WEBHOOK_SECRET,
  callbackUpdate,
  documentUpdate,
  forwardedUpdate,
  jpegBytes,
  messageUpdate,
  ownerOf,
  pdfBytes,
  photoUpdate,
  signIdToken,
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
const AUTHORIZE = 'https://accounts.example.test/o/oauth2/v2/auth';
const EMAIL_X = 'student.a@iitgn.ac.in';
const EMAIL_Y = 'student.b@iitgn.ac.in';
const OWNER_X = ownerOf(EMAIL_X);
const OWNER_Y = ownerOf(EMAIL_Y);
const LOGIN = /^https:\/\/recall\.example\.test\/api\/v1\/telegram\/link\/([A-Za-z0-9_-]{43})$/;
const OPEN = /^https:\/\/recall\.example\.test\/api\/v1\/telegram\/open\/([A-Za-z0-9_-]{43})$/;
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

/** The cookies a response sets, by name (value only), and whole lines under `name=`. */
function cookiesOf(res: Response) {
  const set: Record<string, string> = {};
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(';');
    const [name, ...value] = pair.split('=');
    set[name] = value.join('=');
    set[`${name}=`] = line;
  }
  return set;
}
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const cookieHeader = (cookies: Record<string, string | undefined>) =>
  Object.entries(cookies)
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');

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
      /** `dev`: development sign-in (the default); `google`: Google sign-in with a stand-in. */
      signIn?: 'dev' | 'google';
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

    // A stand-in for Google's token endpoint: answers each code with `google.reply`.
    const google = {
      exchanges: [] as URLSearchParams[],
      reply: (_form: URLSearchParams) => ({ status: 500, body: {} as unknown }),
      tokenUrl: '',
    };
    if (over.signIn === 'google') {
      const endpoint = createServer(async (req, res) => {
        let body = '';
        for await (const chunk of req) body += chunk;
        const form = new URLSearchParams(body);
        google.exchanges.push(form);
        const { status, body: out } = google.reply(form);
        res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(out));
      });
      await new Promise<void>((resolve) => endpoint.listen(0, '127.0.0.1', resolve));
      cleanups.push(() => new Promise<void>((resolve) => endpoint.close(() => resolve())));
      google.tokenUrl = `http://127.0.0.1:${(endpoint.address() as AddressInfo).port}/token`;
    }

    const notices: Promise<unknown>[] = [];
    const server: Server = createServer(
      createPilotHandler({
        clientId: CLIENT_ID,
        allowedEmailDomain: 'iitgn.ac.in',
        origin: ORIGIN,
        keys: staticKeySource({ [ID_KEY_ID]: ID_KEY.publicKey }),
        store: stores.store,
        objects: stores.objects,
        nowSeconds: () => clock.now,
        limits: { signInBurst: 1000 },
        quotaBytes,
        ...(over.signIn === 'google'
          ? {
              google: {
                clientSecret: 'client-secret',
                authorizeUrl: AUTHORIZE,
                tokenUrl: google.tokenUrl,
              },
            }
          : { devSigner: (email: string) => signIdToken(email, {}, clock.now) }),
        telegram: {
          bot: stores.bot,
          state: stores.state,
          noticeVersion: NOTICE_VERSION,
          privacyUrl: PRIVACY_URL,
          onLinked: (linked) => {
            notices.push(announceTelegramLink(api, linked, log));
          },
          webhook: { secretToken: WEBHOOK_SECRET, intake },
        },
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
    /** Waits for the chat messages sent after a link. */
    const settle = async () => {
      while (notices.length) await Promise.all(notices.splice(0));
    };
    /** Delivers updates, runs the worker and sends waiting confirmations. */
    const send = async (...updates: Record<string, unknown>[]) => {
      await deliver(updates);
      await telegram.drain();
      await telegram.flush();
      await settle();
      return updates;
    };
    const liveItems = async (ownerKey = OWNER_X) => {
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
    const get = (path: string, cookie?: string) =>
      fetch(`${base}${path}`, {
        redirect: 'manual',
        headers: cookie ? { cookie: `recall_session=${cookie}` } : {},
      });
    /** The URL on the last message's first button. */
    const lastButtonUrl = (from: TgFrom = USER_A) =>
      tg.to(from.id).at(-1)?.replyMarkup?.inline_keyboard[0]?.[0]?.url;
    /** Sends /start and returns the login link's token. */
    const loginLink = async (from: TgFrom = USER_A, command = '/start') => {
      await send(textUpdate(command, from));
      const match = LOGIN.exec(lastButtonUrl(from) ?? '');
      expect(match).not.toBeNull();
      return match![1];
    };
    /** The account's own sign-in (development sign-in standing in for Google). */
    const signIn = async (email: string) => {
      const res = await fetch(`${base}/session`, {
        method: 'POST',
        headers: { origin: ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({ idToken: signIdToken(email, {}, clock.now) }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { csrf: string; vault: { epoch: number } };
      return { cookie: cookiesOf(res).recall_session, csrf: body.csrf };
    };
    /** Posts a link page's form, as the browser does. */
    const post = (
      path: string,
      cookie: string | undefined,
      origin: string | null = ORIGIN,
      form = '',
    ) =>
      fetch(`${base}${path}`, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          ...(origin ? { origin } : {}),
          ...(cookie ? { cookie: `recall_session=${cookie}` } : {}),
        },
        body: form,
      });
    /** Links a Telegram user to an account: /start, sign in, Continue. */
    const link = async (from: TgFrom = USER_A, email = EMAIL_X) => {
      const token = await loginLink(from);
      const session = await signIn(email);
      const res = await post(`/telegram/link/${token}`, session.cookie);
      expect(res.status).toBe(200);
      await settle();
      return { ...session, token };
    };
    /** Sends /open and returns the app link's token. */
    const openLink = async (from: TgFrom = USER_A) => {
      await send(textUpdate('/open', from));
      const match = OPEN.exec(lastButtonUrl(from) ?? '');
      expect(match).not.toBeNull();
      return match![1];
    };
    const follow = (token: string, origin: string | null = ORIGIN) =>
      post(`/telegram/open/${token}`, undefined, origin);
    /** A JSON write with a session, as the app sends it. */
    const write = (
      method: string,
      path: string,
      session: { cookie: string; csrf: string },
      body: unknown,
    ) =>
      fetch(`${base}${path}`, {
        method,
        headers: {
          origin: ORIGIN,
          cookie: `recall_session=${session.cookie}`,
          'x-recall-csrf': session.csrf,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    /** Saves a note from the app (upload, then a device-made index), as Auto-sync does. */
    const appNote = async (
      session: { cookie: string; csrf: string },
      ownerKey: string,
      title: string,
      text: string,
    ) => {
      const bytes = new TextEncoder().encode(text);
      const globalId = randomUUID();
      const { epoch } = await stores.store.vault(ownerKey);
      const begin = await write('POST', `/items/${globalId}/upload`, session, {
        opId: randomUUID(),
        epoch,
        item: {
          kind: 'note',
          title,
          mimeType: NOTE_MIME,
          byteLength: bytes.length,
          contentSha256: sha256(bytes),
          createdAt: 1_762_000_000_000,
        },
      });
      expect(begin.status).toBe(200);
      const { uploadId } = (await begin.json()) as { uploadId: string };
      const chunk = await fetch(`${base}/uploads/${uploadId}/chunks/0`, {
        method: 'PUT',
        headers: {
          origin: ORIGIN,
          cookie: `recall_session=${session.cookie}`,
          'x-recall-csrf': session.csrf,
        },
        body: bytes,
      });
      expect(chunk.status).toBe(204);
      const done = await write('POST', `/uploads/${uploadId}/complete`, session, {
        opId: randomUUID(),
        epoch,
      });
      expect(done.status).toBe(200);
      const made = await new FakeEngineHost().index({
        kind: 'note',
        mimeType: NOTE_MIME,
        title,
        bytes,
        createdAt: 1_762_000_000_000,
      });
      const index = await write('PUT', `/items/${globalId}/index`, session, {
        opId: randomUUID(),
        epoch,
        bundle: {
          globalId,
          contentSha256: made.contentSha256,
          searchMetadataDigest: await searchMetadataDigest({ title }),
          indexVersion: made.indexVersion,
          dimension: INDEX_DIMENSION,
          segments: made.segments,
        },
      });
      expect(index.status).toBe(200);
      return globalId;
    };
    /** The account's change feed, as the app reads it with that session. */
    const changes = async (session: { cookie: string }, ownerKey: string, after = 0) => {
      const { epoch } = await stores.store.vault(ownerKey);
      const res = await get(`/changes?epoch=${epoch}&after=${after}`, session.cookie);
      expect(res.status).toBe(200);
      return (await res.json()) as {
        cursor: number;
        changes: { item: { globalId: string; title: string; deleted: boolean } }[];
      };
    };
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
      google,
      telegram,
      makeBot,
      intake,
      timers,
      deliver,
      send,
      settle,
      liveItems,
      keyOf,
      get,
      post,
      lastButtonUrl,
      loginLink,
      signIn,
      link,
      openLink,
      follow,
      appNote,
      changes,
      searchButtons,
      buttonFor,
    };
  }

  describe('T1 nothing is stored or searched before login', () => {
    it('stores and searches nothing for an unlinked user, and answers each message with /login', async () => {
      const t = await setup();
      const photo = jpegBytes();
      t.tg.addFile('p-1', photo);
      const updates = await t.send(
        forwardedUpdate('Hostel curfew is 11 pm'),
        photoUpdate([{ fileId: 'p-1', size: photo.length, width: 800, height: 600 }]),
        textUpdate('note Mess timings 8 to 10'),
        textUpdate('mess timings'),
      );
      expect(t.tg.state.getFileCalls).toEqual([]);
      expect(t.engine!.calls).toEqual([]);
      expect(await t.state.getAccount(String(USER_A.id))).toBeUndefined();
      expect(t.tg.textsTo(USER_A.id)).toEqual(Array(4).fill(TELEGRAM_REPLIES.loginFirst));
      expect(TELEGRAM_REPLIES.loginFirst).toBe('Log in first with /login.');
      // Only each message's key and type are kept.
      for (const update of updates) {
        const kept = await t.bot.getInbound(t.keyOf(update));
        expect(kept?.message).toEqual({ id: t.keyOf(update), type: 'message' });
      }
      // No vault anywhere received anything: not a Telegram one, not an account.
      for (const owner of [`tg:${USER_A.id}`, OWNER_X])
        expect((await t.store.changesAfter(owner, 0)).changes).toEqual([]);
    });

    it('/start and /login send the notice with a one-time Log in with IITGN button', async () => {
      const t = await setup();
      const [start] = await t.send(textUpdate('/start'));
      const sent = t.tg.to(USER_A.id);
      expect(sent).toHaveLength(1);
      const notice = sent[0].text!;
      for (const part of [
        'Log in with your IITGN Google account',
        'photos, PDFs and notes',
        'the searches you type',
        'Our server stores and processes your files',
        'sees your searches',
        'Telegram keeps bot chats on its own servers',
        'not end-to-end encrypted',
        '18 or older',
        '/logout',
        '/delete',
        `Privacy: ${PRIVACY_URL}`,
        'Nothing is saved until you log in.',
      ])
        expect(notice).toContain(part);
      const button = sent[0].replyMarkup!.inline_keyboard[0][0];
      expect(button.text).toBe('Log in with IITGN');
      const token = LOGIN.exec(button.url!)![1];
      // Only the token's SHA-256 is kept, with the user and the message carrying the button.
      expect(await t.state.peekLink(hashLinkToken(token), 'login', t.clock.now)).toMatchObject({
        userId: String(USER_A.id),
        label: 'Telegram @student_a',
        messageId: expect.any(Number),
        expiresAt: t.clock.now + 600,
      });
      expect(await t.state.peekLink(token, 'login', t.clock.now)).toBeUndefined();
      expect((await t.bot.getInbound(t.keyOf(start)))?.message).toEqual({
        id: t.keyOf(start),
        type: 'message',
      });
      await t.send(textUpdate('/login'));
      expect(t.tg.textsTo(USER_A.id).at(-1)).toBe(TELEGRAM_REPLIES.notice(PRIVACY_URL));
      expect(LOGIN.test(t.lastButtonUrl() ?? '')).toBe(true);
    });

    it('answers /help and /privacy without login, and other commands and taps with /login', async () => {
      const t = await setup();
      await t.send(textUpdate('/help'), textUpdate('/privacy'));
      await t.send(textUpdate('/open'), textUpdate('/delete'), textUpdate('/logout'));
      const [tap] = await t.send(callbackUpdate('delete'));
      expect(t.tg.textsTo(USER_A.id)).toEqual([
        TELEGRAM_REPLIES.help(CONTACT),
        TELEGRAM_REPLIES.privacy(PRIVACY_URL),
        TELEGRAM_REPLIES.loginFirst,
        TELEGRAM_REPLIES.loginFirst,
        TELEGRAM_REPLIES.loginFirst,
      ]);
      expect(t.tg.state.answered).toContainEqual({
        id: (tap.callback_query as { id: string }).id,
        text: TELEGRAM_REPLIES.loginFirst,
      });
      expect(await t.state.revokeLinks(String(USER_A.id))).toEqual([]);
    });

    it('records consent with the notice version when linking, then saves', async () => {
      const t = await setup();
      t.clock.now += 30;
      await t.link();
      expect(await t.bot.senderState(String(USER_A.id))).toMatchObject({
        consentedAt: t.clock.now,
        noticeVersion: NOTICE_VERSION,
      });
      await t.send(textUpdate('note Library closes at midnight'));
      expect((await t.liveItems()).map((item) => item.title)).toEqual([
        'Library closes at midnight',
      ]);
      expect(t.tg.textsTo(USER_A.id).at(-1)).toBe(REPLIES.saved('Library closes at midnight'));
    });

    it('after /stop saves and answers nothing until /resume', async () => {
      const t = await setup();
      await t.link();
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
      await t.link();
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
      expect(await t.state.savedItems(OWNER_X)).toEqual([]);
      expect(t.tg.textsTo(USER_A.id).some((text) => text.startsWith('Saved'))).toBe(false);
    });

    it('stores nothing from a save still downloading when the user logs out meanwhile', async () => {
      const t = await setup();
      await t.link();
      const pdf = pdfBytes('Late. ');
      t.tg.addFile('late', pdf);
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      let reached!: () => void;
      const downloading = new Promise<void>((resolve) => (reached = resolve));
      const slow = t.makeBot({
        ...t.api,
        async getFile(id) {
          reached();
          await held;
          return t.api.getFile(id);
        },
      });
      await t.deliver([
        documentUpdate({ fileId: 'late', size: pdf.length, mimeType: 'application/pdf' }),
      ]);
      const first = slow.runOnce();
      await downloading;
      await t.send(textUpdate('/logout'));
      release();
      await first;
      await slow.flush();
      expect(await t.liveItems()).toEqual([]);
    });
    it('checks the link again under the account lock: a save for an account no longer linked stores nothing', async () => {
      const t = await setup();
      await t.link(USER_A, EMAIL_X);
      const pdf = pdfBytes('Moved. ');
      t.tg.addFile('moved', pdf);
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      let reached!: () => void;
      const downloading = new Promise<void>((resolve) => (reached = resolve));
      const slow = t.makeBot({
        ...t.api,
        async getFile(id) {
          reached();
          await held;
          return t.api.getFile(id);
        },
      });
      await t.deliver([
        documentUpdate({ fileId: 'moved', size: pdf.length, mimeType: 'application/pdf' }),
      ]);
      const first = slow.runOnce();
      await downloading;
      // The user's link now points at another account (its job is still the current claim).
      await t.state.linkAccount({
        userId: String(USER_A.id),
        ownerKey: OWNER_Y,
        email: EMAIL_Y,
        linkedAt: t.clock.now,
      });
      release();
      await first;
      await slow.flush();
      expect(await t.liveItems(OWNER_X)).toEqual([]);
      expect(await t.liveItems(OWNER_Y)).toEqual([]);
      expect(t.tg.textsTo(USER_A.id).some((text) => text.startsWith('Saved'))).toBe(false);
    });
  });

  describe('T2 exact original', () => {
    it('saves the largest photo size and a PDF byte for byte with our own SHA-256', async () => {
      const t = await setup();
      const session = await t.link();
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
      for (const [update, bytes, kind, title] of [
        [photo, large, 'image', 'Notice board'],
        [doc, pdf, 'pdf', 'Guest rules.pdf'],
      ] as const) {
        const item = (await t.store.getItem(OWNER_X, telegramGlobalId(t.keyOf(update))))!;
        expect(item).toMatchObject({
          kind,
          title,
          contentSha256: sha256(bytes),
          byteLength: bytes.length,
        });
        // Read with the account's own session, as the app does.
        const res = await t.get(`/items/${item.globalId}/original`, session.cookie);
        expect(res.status).toBe(200);
        expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
      }
      expect(t.tg.textsTo(USER_A.id).at(-1)).toBe(
        TELEGRAM_REPLIES.savedMany(['Notice board', 'Guest rules.pdf']),
      );
    });

    it('never stores bytes whose size differs from what Telegram declared, and retries', async () => {
      const t = await setup();
      await t.link();
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
      await t.link();
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
        TELEGRAM_REPLIES.tooBig({ kind: 'pdf', bytes: LIMITS.maxPdfBytes + 1 }),
        TELEGRAM_REPLIES.tooBig({ kind: 'image', bytes: LIMITS.maxImageBytes + 1 }),
        TELEGRAM_REPLIES.tooBig({ kind: 'pdf', byTelegram: true }),
      ]);
    });

    it('refuses voice notes, audio, video, stickers and Office files with plain reasons', async () => {
      const t = await setup();
      await t.link();
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
        TELEGRAM_REPLIES.voice,
        TELEGRAM_REPLIES.audio,
        TELEGRAM_REPLIES.video,
        TELEGRAM_REPLIES.sticker,
        TELEGRAM_REPLIES.unsupportedFile('docx'),
        TELEGRAM_REPLIES.location,
      ]);
    });

    it('saves forwarded text, note and save prefixes and single links, and searches anything else', async () => {
      const t = await setup({ engine: false });
      await t.link();
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
      // Each saved item is recorded as saved through Telegram.
      expect((await t.state.savedItems(OWNER_X)).sort()).toEqual(
        items.map((item) => item.globalId).sort(),
      );
    });
  });

  describe('T3 no duplicates from redelivery', () => {
    it('one item and one confirmation for a repeated, concurrent or doubly worked update', async () => {
      const t = await setup();
      await t.link();
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
      await t.link();
      await t.send(textUpdate('note Timetable'));
      const [button] = await t.searchButtons('timetable');
      const tap = callbackUpdate(button);
      const before = t.tg.to(USER_A.id).length;
      await t.send(tap, tap);
      const id = (tap.callback_query as { id: string }).id;
      expect(t.tg.state.answered.filter((a) => a.id === id)).toHaveLength(1);
      // The note and its "Open in app" link, once.
      expect(t.tg.to(USER_A.id).length - before).toBe(2);
    });

    it('a job that crashed after publishing its item is retried without a second item or reply', async () => {
      const t = await setup();
      await t.link();
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
      expect(await t.state.savedItems(OWNER_X)).toEqual([telegramGlobalId(t.keyOf(update))]);
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

  describe('T5 linked accounts are kept apart', () => {
    it('saves into each linked account only, and the app sees them in that account’s change feed', async () => {
      const t = await setup();
      const x = await t.link(USER_A, EMAIL_X);
      const y = await t.link(USER_B, EMAIL_Y);
      const [a] = await t.send(textUpdate('note A secret', USER_A));
      const [b] = await t.send(textUpdate('note B secret', USER_B));
      expect((await t.liveItems(OWNER_X)).map((item) => item.title)).toEqual(['A secret']);
      expect((await t.liveItems(OWNER_Y)).map((item) => item.title)).toEqual(['B secret']);
      const itemA = (await t.store.getItem(OWNER_X, telegramGlobalId(t.keyOf(a))))!;
      expect(itemA.objectKey?.startsWith(`${OWNER_X}/`)).toBe(true);
      // The account's own sessions see their item in the change feed (saved, then indexed); the
      // other account does not.
      const titles = async (session: { cookie: string }, owner: string) =>
        new Set((await t.changes(session, owner)).changes.map((c) => c.item.title));
      expect(await titles(x, OWNER_X)).toEqual(new Set(['A secret']));
      expect(await titles(y, OWNER_Y)).toEqual(new Set(['B secret']));
      expect((await t.get(`/items/${itemA.globalId}/original`, y.cookie)).status).toBe(404);
      expect(await t.store.getItem(OWNER_Y, telegramGlobalId(t.keyOf(b)))).toBeDefined();
      // Nothing went to a separate Telegram vault.
      expect((await t.store.changesAfter(`tg:${USER_A.id}`, 0)).changes).toEqual([]);
      // A's result button tapped by B finds nothing in B's account.
      const [button] = await t.searchButtons('secret', USER_A);
      await t.send(callbackUpdate(button, USER_B));
      expect(t.tg.textsTo(USER_B.id).at(-1)).toBe(TELEGRAM_REPLIES.gone);
    });

    it('lets two Telegram users use one account only through that account’s own sign-in', async () => {
      const t = await setup();
      await t.link(USER_A, EMAIL_X);
      // B's login link with no session asks for the account's sign-in; it links nothing.
      const token = await t.loginLink(USER_B);
      const page = await t.get(`/telegram/link/${token}`);
      expect(await page.text()).toContain('Sign in to link Telegram @student_b');
      expect((await t.post(`/telegram/link/${token}`, undefined)).status).toBe(303);
      expect(await t.state.getAccount(String(USER_B.id))).toBeUndefined();
      // A session opened from A's app link is not the account's own sign-in either.
      const res = await t.follow(await t.openLink(USER_A));
      const viaTelegram = cookiesOf(res).recall_session;
      const shown = await t.get(`/telegram/link/${token}`, viaTelegram);
      expect(await shown.text()).toContain('Sign in to link');
      expect((await t.post(`/telegram/link/${token}`, viaTelegram)).status).toBe(303);
      expect(await t.state.getAccount(String(USER_B.id))).toBeUndefined();
      // With the account's own sign-in, B links to it too, and both save into it.
      const own = await t.signIn(EMAIL_X);
      expect((await t.post(`/telegram/link/${token}`, own.cookie)).status).toBe(200);
      await t.settle();
      await t.send(textUpdate('note From A', USER_A), textUpdate('note From B', USER_B));
      expect((await t.liveItems(OWNER_X)).map((item) => item.title).sort()).toEqual([
        'From A',
        'From B',
      ]);
    });
  });

  describe('T6 login and app links', () => {
    it('links the Telegram user to the signed-in account once, from the pilot origin only', async () => {
      const t = await setup();
      const token = await t.loginLink();
      const stored = await t.state.peekLink(hashLinkToken(token), 'login', t.clock.now);
      const session = await t.signIn(EMAIL_X);

      // Without a session (development sign-in here) the page asks to sign in.
      const anonymous = await t.get(`/telegram/link/${token}`);
      expect(anonymous.status).toBe(200);
      expect(await anonymous.text()).toContain('IITGN email');

      const page = await t.get(`/telegram/link/${token}`, session.cookie);
      expect(page.status).toBe(200);
      const html = await page.text();
      expect(html).toContain(
        'Link <strong>Telegram @student_a</strong> to <strong>student.a@iitgn.ac.in</strong>?',
      );
      for (const part of [
        'saved in this account',
        'not end-to-end encrypted',
        "can open your cloud library from the bot's one-time links",
        '18 or older',
        PRIVACY_URL,
        '<form method="post">',
      ])
        expect(html).toContain(part);
      expect(html).not.toContain('<script');
      expect(page.headers.get('content-security-policy')).toMatch(
        /^default-src 'none'; style-src 'sha256-[A-Za-z0-9+/=]+'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'$/,
      );
      expect(page.headers.get('referrer-policy')).toBe('same-origin');
      expect(page.headers.get('cache-control')).toBe('no-store');

      // Another or no Origin is refused and leaves the link usable.
      expect(
        (await t.post(`/telegram/link/${token}`, session.cookie, 'https://evil.example')).status,
      ).toBe(403);
      expect((await t.post(`/telegram/link/${token}`, session.cookie, null)).status).toBe(403);
      expect(await t.state.getAccount(String(USER_A.id))).toBeUndefined();

      const res = await t.post(`/telegram/link/${token}`, session.cookie);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('Telegram is linked');
      await t.settle();
      expect(await t.state.getAccount(String(USER_A.id))).toMatchObject({
        ownerKey: OWNER_X,
        email: EMAIL_X,
      });
      // The chat says so, with the email masked, and the used login button is removed.
      expect(t.tg.textsTo(USER_A.id).at(-1)).toBe(
        'Linked to s•••a@iitgn.ac.in. Forward or send files to save them; type anything to search.',
      );
      expect(t.tg.state.removed).toEqual([{ chatId: USER_A.id, messageId: stored!.messageId }]);

      // Used up.
      expect((await t.post(`/telegram/link/${token}`, session.cookie)).status).toBe(404);
      const again = await t.get(`/telegram/link/${token}`, session.cookie);
      expect(again.status).toBe(404);
      expect(await again.text()).toContain('Send /login to the Campus Recall Telegram bot');
    });

    it('expires login links after 10 minutes and refuses malformed or app-link tokens', async () => {
      const t = await setup();
      await t.link();
      const appToken = await t.openLink();
      // An app link is not a login link.
      expect((await t.get(`/telegram/link/${appToken}`)).status).toBe(404);
      const token = await t.loginLink(USER_B);
      expect((await t.get(`/telegram/open/${token}`)).status).toBe(404);
      const session = await t.signIn(EMAIL_Y);
      t.clock.now += 601;
      expect((await t.get(`/telegram/link/${token}`, session.cookie)).status).toBe(404);
      expect((await t.post(`/telegram/link/${token}`, session.cookie)).status).toBe(404);
      expect((await t.get('/telegram/link/not-a-token')).status).toBe(404);
      expect(await t.state.getAccount(String(USER_B.id))).toBeUndefined();
    });

    it('refuses non-IITGN accounts on development sign-in and signs IITGN ones back to the link', async () => {
      const t = await setup();
      const token = await t.loginLink(USER_NO_NAME);
      expect(await (await t.get(`/telegram/link/${token}`)).text()).toContain(
        'Sign in to link Telegram account C',
      );
      const form = (email: string) => `intent=signin&email=${encodeURIComponent(email)}`;
      const refused = await t.post(
        `/telegram/link/${token}`,
        undefined,
        ORIGIN,
        form('a@gmail.com'),
      );
      expect(refused.status).toBe(403);
      expect(await refused.text()).toContain('Only verified IITGN accounts');
      expect(cookiesOf(refused).recall_session).toBeUndefined();
      expect(
        (await t.post(`/telegram/link/${token}`, undefined, 'https://evil.example', form(EMAIL_Y)))
          .status,
      ).toBe(403);
      const signed = await t.post(`/telegram/link/${token}`, undefined, ORIGIN, form(EMAIL_Y));
      expect(signed.status).toBe(303);
      expect(signed.headers.get('location')).toBe(`${ORIGIN}/api/v1/telegram/link/${token}`);
      const cookie = cookiesOf(signed).recall_session;
      expect(await (await t.get(`/telegram/link/${token}`, cookie)).text()).toContain(
        `Link <strong>Telegram account C</strong> to <strong>${EMAIL_Y}</strong>?`,
      );
      expect((await t.post(`/telegram/link/${token}`, cookie)).status).toBe(200);
      expect((await t.state.getAccount(String(USER_NO_NAME.id)))?.ownerKey).toBe(OWNER_Y);
    });

    it('needs /logout before linking another account', async () => {
      const t = await setup();
      await t.link(USER_A, EMAIL_X);
      await t.send(textUpdate('/login'));
      expect(t.tg.textsTo(USER_A.id).at(-1)).toBe(TELEGRAM_REPLIES.loginWhileLinked(EMAIL_X));
      expect(t.lastButtonUrl()).toBeUndefined();
      await t.send(textUpdate('/start'));
      expect(t.tg.textsTo(USER_A.id).at(-1)).toBe(TELEGRAM_REPLIES.alreadyLinked(EMAIL_X));
      await t.send(textUpdate('/logout'));
      expect(t.tg.textsTo(USER_A.id).at(-1)).toBe(TELEGRAM_REPLIES.loggedOut(EMAIL_X));
      expect(await t.state.getAccount(String(USER_A.id))).toBeUndefined();
      await t.link(USER_A, EMAIL_Y);
      expect((await t.state.getAccount(String(USER_A.id)))?.ownerKey).toBe(OWNER_Y);
      await t.send(textUpdate('note Now in Y'));
      expect((await t.liveItems(OWNER_Y)).map((item) => item.title)).toEqual(['Now in Y']);
      expect(await t.liveItems(OWNER_X)).toEqual([]);
    });

    it('opens a normal session for the linked account once, from the pilot origin only', async () => {
      const t = await setup();
      const own = await t.link();
      await t.send(textUpdate('note Hostel rules'));
      const appItem = await t.appNote(own, OWNER_X, 'Synced from the laptop', 'Laptop note');
      const token = await t.openLink();
      expect(t.tg.to(USER_A.id).at(-1)?.text).toBe(TELEGRAM_REPLIES.open);
      expect(await t.state.peekLink(hashLinkToken(token), 'open', t.clock.now)).toMatchObject({
        ownerKey: OWNER_X,
        label: EMAIL_X,
        userId: String(USER_A.id),
      });

      const page = await t.get(`/telegram/open/${token}`);
      expect(page.status).toBe(200);
      const html = await page.text();
      expect(html).toContain('Sign in to Campus Recall as <strong>student.a@iitgn.ac.in</strong>');
      expect(html).not.toContain('<script');
      expect(page.headers.get('content-security-policy')).toContain("default-src 'none'");

      expect((await t.follow(token, 'https://evil.example')).status).toBe(403);
      expect((await t.follow(token, null)).status).toBe(403);
      const res = await t.follow(token);
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe(`${ORIGIN}/?signin=telegram#/settings`);
      const cookie = cookiesOf(res).recall_session;
      const session = await (await t.get('/session', cookie)).json();
      // The account's own session, as after Google sign-in, marked as opened from Telegram.
      expect(session).toMatchObject({ email: EMAIL_X, via: 'telegram' });
      expect(session).not.toHaveProperty('kind');
      const feed = await t.changes({ cookie }, OWNER_X);
      expect(new Set(feed.changes.map((c) => c.item.title))).toEqual(
        new Set(['Hostel rules', 'Synced from the laptop']),
      );
      expect(feed.changes.some((c) => c.item.globalId === appItem)).toBe(true);
      // Writes still need CSRF, as for every session.
      const del = await fetch(`${t.base}/items/${appItem}`, {
        method: 'DELETE',
        headers: { origin: ORIGIN, cookie: `recall_session=${cookie}` },
        body: JSON.stringify({ opId: randomUUID(), epoch: 1, expectedRevision: 1 }),
      });
      expect(del.status).toBe(403);
      // Used up.
      expect((await t.follow(token)).status).toBe(404);
      const again = await t.get(`/telegram/open/${token}`);
      expect(again.status).toBe(404);
      expect(await again.text()).toContain('Send /open to the Campus Recall Telegram bot');
    });

    it('expires app links after 10 minutes, and /logout revokes unused ones', async () => {
      const t = await setup();
      await t.link();
      const late = await t.openLink();
      t.clock.now += 601;
      expect((await t.follow(late)).status).toBe(404);
      const unused = await t.openLink();
      const pendingLogin = await t.loginLink(USER_B);
      await t.send(textUpdate('/logout'));
      expect((await t.get(`/telegram/open/${unused}`)).status).toBe(404);
      expect((await t.follow(unused)).status).toBe(404);
      expect(await t.state.revokeLinks(String(USER_A.id))).toEqual([]);
      // Another user's links are untouched.
      expect(
        await t.state.peekLink(hashLinkToken(pendingLogin), 'login', t.clock.now),
      ).toBeDefined();
      // After /logout the bot answers with /login again.
      await t.send(textUpdate('note after logout'));
      expect(t.tg.textsTo(USER_A.id).at(-1)).toBe(TELEGRAM_REPLIES.loginFirst);
      expect(await t.liveItems()).toEqual([]);
    });

    it('linking uses up every login link of the user and removes their buttons', async () => {
      const t = await setup();
      const token = await t.loginLink();
      const message = await t.state.peekLink(hashLinkToken(token), 'login', t.clock.now);
      await t.link();
      expect(await t.state.peekLink(hashLinkToken(token), 'login', t.clock.now)).toBeUndefined();
      expect(t.tg.state.removed.map((r) => r.messageId)).toContain(message!.messageId);
      expect(t.tg.state.removed).toHaveLength(2);
    });

    it('/logout before linking revokes unused login links and removes their buttons', async () => {
      const t = await setup();
      const first = await t.loginLink();
      const second = await t.loginLink(USER_A, '/login');
      const messages = await Promise.all(
        [first, second].map((token) =>
          t.state.peekLink(hashLinkToken(token), 'login', t.clock.now),
        ),
      );
      await t.send(textUpdate('/logout'));
      expect(t.tg.textsTo(USER_A.id).at(-1)).toBe(TELEGRAM_REPLIES.loginFirst);
      for (const token of [first, second])
        expect((await t.get(`/telegram/link/${token}`)).status).toBe(404);
      expect(t.tg.state.removed.map((r) => r.messageId).sort()).toEqual(
        messages.map((m) => m!.messageId).sort(),
      );
    });

    it('explains that links need the tunnel when the origin cannot open on a phone', async () => {
      const t = await setup({ bot: { appLinks: false } });
      await t.send(textUpdate('/start'));
      expect(t.tg.textsTo(USER_A.id).at(-1)).toBe(
        `${TELEGRAM_REPLIES.notice(PRIVACY_URL)}\n\n${TELEGRAM_REPLIES.noLinks}`,
      );
      expect(t.lastButtonUrl()).toBeUndefined();
    });
  });

  describe('Google sign-in from a login link', () => {
    async function googleSetup() {
      const t = await setup({ signIn: 'google' });
      /** One browser: its cookies across responses. */
      const jar: Record<string, string | undefined> = {};
      const visit = async (url: string) => {
        const res = await fetch(url.startsWith('http') ? url : `${t.base}${url}`, {
          redirect: 'manual',
          headers: { cookie: cookieHeader(jar) },
        });
        for (const [name, value] of Object.entries(cookiesOf(res)))
          if (!name.endsWith('=')) jar[name] = value || undefined;
        return res;
      };
      return { ...t, jar, visit };
    }
    const local = (location: string) => location.replace(ORIGIN, '');

    it('starts Google sign-in with state, nonce and PKCE, and comes back to the same link', async () => {
      const t = await googleSetup();
      const token = await t.loginLink();
      const first = await t.visit(`/telegram/link/${token}`);
      expect(first.status).toBe(303);
      expect(first.headers.get('location')).toBe(
        `${ORIGIN}/api/v1/auth/google/start?return=${encodeURIComponent(`/api/v1/telegram/link/${token}`)}`,
      );
      const start = await t.visit(local(first.headers.get('location')!).replace('/api/v1', ''));
      expect(start.status).toBe(302);
      const to = new URL(start.headers.get('location')!);
      expect(`${to.origin}${to.pathname}`).toBe(AUTHORIZE);
      expect(Object.fromEntries(to.searchParams)).toMatchObject({
        client_id: CLIENT_ID,
        redirect_uri: `${ORIGIN}/api/v1/auth/google/callback`,
        code_challenge_method: 'S256',
        hd: 'iitgn.ac.in',
        prompt: 'select_account',
      });
      const nonce = to.searchParams.get('nonce')!;
      const state = to.searchParams.get('state')!;
      expect(t.jar.recall_login).toBeDefined();
      expect(t.jar.recall_return).toMatch(new RegExp(`^${token}\\.`));
      // The raw token is never stored server-side: the return travels only in the browser.
      t.google.reply = () => ({
        status: 200,
        body: { id_token: signIdToken(EMAIL_X, { nonce }, t.clock.now) },
      });
      const back = await t.visit(`/auth/google/callback?code=google-code&state=${state}`);
      expect(back.status).toBe(303);
      expect(back.headers.get('location')).toBe(`${ORIGIN}/api/v1/telegram/link/${token}`);
      expect(t.jar.recall_session).toBeDefined();
      expect(t.jar.recall_return).toBeUndefined();
      const exchange = Object.fromEntries(t.google.exchanges[0]);
      expect(createHash('sha256').update(exchange.code_verifier).digest('base64url')).toBe(
        to.searchParams.get('code_challenge'),
      );

      const page = await t.visit(`/telegram/link/${token}`);
      expect(await page.text()).toContain(`to <strong>${EMAIL_X}</strong>?`);
      const linked = await t.post(`/telegram/link/${token}`, t.jar.recall_session);
      expect(linked.status).toBe(200);
      await t.settle();
      expect((await t.state.getAccount(String(USER_A.id)))?.ownerKey).toBe(OWNER_X);
    });

    it('refuses to return anywhere but a login link page', async () => {
      const t = await googleSetup();
      for (const target of [
        'https://evil.example/',
        '//evil.example/api/v1/telegram/link/x',
        '/#/settings',
        '/api/v1/telegram/link/../../../evil',
        `/api/v1/telegram/open/${'a'.repeat(43)}`,
        `https://evil.example/api/v1/telegram/link/${'a'.repeat(43)}`,
        '',
      ]) {
        const res = await t.visit(`/auth/google/start?return=${encodeURIComponent(target)}`);
        expect(res.status).toBe(400);
        expect(res.headers.get('location')).toBeNull();
      }
      // A return cookie not made for this attempt is ignored: the sign-in goes to Settings.
      const start = await t.visit('/auth/google/start');
      const to = new URL(start.headers.get('location')!);
      t.jar.recall_return = `${'a'.repeat(43)}.forged`;
      t.google.reply = () => ({
        status: 200,
        body: {
          id_token: signIdToken(EMAIL_X, { nonce: to.searchParams.get('nonce') }, t.clock.now),
        },
      });
      const back = await t.visit(
        `/auth/google/callback?code=c&state=${to.searchParams.get('state')}`,
      );
      expect(back.headers.get('location')).toBe(`${ORIGIN}/#/settings`);
    });

    it('refuses non-IITGN Google accounts and a wrong nonce, and links nothing', async () => {
      const t = await googleSetup();
      const token = await t.loginLink();
      for (const over of [
        { hd: undefined, email: 'someone@gmail.com' },
        { hd: 'example.edu', email: 'student@example.edu' },
        { nonce: 'another-nonce' },
      ]) {
        const start = await t.visit(
          `/auth/google/start?return=${encodeURIComponent(`/api/v1/telegram/link/${token}`)}`,
        );
        const to = new URL(start.headers.get('location')!);
        t.google.reply = () => ({
          status: 200,
          body: {
            id_token: signIdToken(
              EMAIL_X,
              { nonce: to.searchParams.get('nonce'), ...over },
              t.clock.now,
            ),
          },
        });
        const back = await t.visit(
          `/auth/google/callback?code=c&state=${to.searchParams.get('state')}`,
        );
        expect(back.headers.get('location')).toBe(
          `${ORIGIN}/?signin=${'nonce' in over ? 'failed' : 'not-eligible'}#/settings`,
        );
        expect(t.jar.recall_session).toBeUndefined();
        expect(t.jar.recall_return).toBeUndefined();
      }
      expect(await t.state.getAccount(String(USER_A.id))).toBeUndefined();
      // The link itself is still usable after the refusals.
      expect((await t.get(`/telegram/link/${token}`)).status).toBe(303);
    });
  });

  describe('T7 server indexing', () => {
    it('indexes each saved item with the engine host into the linked account', async () => {
      const t = await setup();
      await t.link();
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
      const item = (await t.store.getItem(OWNER_X, telegramGlobalId(t.keyOf(doc))))!;
      expect(item.index).toMatchObject({ contentSha256: item.contentSha256 });
      expect(item.indexObjectKey).toBe(`${OWNER_X}/1/${item.globalId}/index`);
      expect(t.engine!.calls.map((call) => call.title)).toEqual(['Library.pdf']);
    });
  });

  describe('T8 search in Telegram', () => {
    it('answers with up to five result buttons whose tokens stay within 64 bytes', async () => {
      const t = await setup();
      await t.link();
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

    it('searches the whole linked library, including items synced from the app', async () => {
      const t = await setup();
      const own = await t.link();
      await t.send(textUpdate('note Telegram mess menu'));
      const appItem = await t.appNote(own, OWNER_X, 'Laptop timetable', 'Monday: CS437 at 9');
      const button = await t.buttonFor('timetable', 'Laptop timetable');
      expect((await t.state.getPick(button.slice(2), t.clock.now))?.globalId).toBe(appItem);
      await t.send(callbackUpdate(button));
      expect(t.tg.to(USER_A.id).at(-2)?.text).toBe('Monday: CS437 at 9');
      expect(t.tg.to(USER_A.id).at(-1)?.text).toBe(TELEGRAM_REPLIES.openCta);
      // Only items saved here are recorded as saved through Telegram.
      expect(await t.state.savedItems(OWNER_X)).not.toContain(appItem);
    });

    it('sends a photo, a PDF and a note back, each with an Open in app button', async () => {
      const t = await setup();
      await t.link();
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
        const token = OPEN.exec(cta.replyMarkup?.inline_keyboard[0][0].url ?? '')![1];
        expect((await t.follow(token)).status).toBe(303);
      }
      expect(t.tg.state.answered.length - before).toBe(3);
    });

    it('matches items still being indexed by title, says when search is by keyword, and reports no match', async () => {
      const t = await setup({ engine: false });
      await t.link();
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
      await t.link();
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

  describe('T9 /delete and /logout', () => {
    it('erases only the items saved through Telegram, through the normal delete path, and unlinks', async () => {
      const t = await setup();
      const own = await t.link(USER_A, EMAIL_X);
      await t.link(USER_B, EMAIL_Y);
      const pdf = pdfBytes('Erase me. ');
      t.tg.addFile('erase', pdf);
      const [doc, note] = await t.send(
        documentUpdate({
          fileId: 'erase',
          size: pdf.length,
          mimeType: 'application/pdf',
          fileName: 'Erase.pdf',
        }),
        textUpdate('note Erase me too'),
      );
      await t.send(textUpdate('note B keeps this', USER_B));
      const appItem = await t.appNote(own, OWNER_X, 'Kept from the laptop', 'Laptop only');
      const item = (await t.store.getItem(OWNER_X, telegramGlobalId(t.keyOf(doc))))!;
      const appStored = (await t.store.getItem(OWNER_X, appItem))!;
      const [button] = await t.searchButtons('erase');
      const linkCookie = cookiesOf(await t.follow(await t.openLink())).recall_session;
      const unusedOpen = await t.openLink();
      const { epoch } = await t.store.vault(OWNER_X);
      const { cursor } = await t.changes(own, OWNER_X);

      await t.send(textUpdate('/delete'));
      const ask = t.tg.to(USER_A.id).at(-1)!;
      expect(ask.text).toBe(TELEGRAM_REPLIES.deleteAsk);
      expect(ask.text).toContain("Remove cloud library in the app's Settings");
      expect(ask.replyMarkup).toEqual({
        inline_keyboard: [[{ text: 'Yes, erase my Telegram items', callback_data: 'delete' }]],
      });
      expect(await t.liveItems()).toHaveLength(3);
      t.clock.now += 599;
      const [tap] = await t.send(callbackUpdate('delete'));
      expect(t.tg.textsTo(USER_A.id).at(-1)).toBe(TELEGRAM_REPLIES.deleted(2));
      // The tapped button is removed, so it is not offered again.
      expect(t.tg.state.removed).toContainEqual({
        chatId: USER_A.id,
        messageId: (tap.callback_query as { message: { message_id: number } }).message.message_id,
      });

      // Only the Telegram items are gone; the library, its epoch and its sessions stay.
      expect((await t.liveItems()).map((i) => i.globalId)).toEqual([appItem]);
      expect((await t.store.vault(OWNER_X)).epoch).toBe(epoch);
      expect(await t.objects.get(item.objectKey!)).toBeUndefined();
      expect(await t.objects.get(item.indexObjectKey!)).toBeUndefined();
      expect(await t.objects.get(appStored.objectKey!)).toBeDefined();
      for (const cookie of [own.cookie, linkCookie])
        expect((await t.get('/session', cookie)).status).toBe(200);
      // Other devices see the deletions as tombstones in the change feed.
      const later = await t.changes(own, OWNER_X, cursor);
      expect(later.changes.map((c) => [c.item.globalId, c.item.deleted]).sort()).toEqual(
        [
          [item.globalId, true],
          [telegramGlobalId(t.keyOf(note)), true],
        ].sort(),
      );
      expect((await t.store.getItem(OWNER_X, item.globalId))?.revision).toBe(item.revision + 1);
      expect(await t.state.savedItems(OWNER_X)).toEqual([]);
      // Unlinked, with its links and result buttons revoked.
      expect(await t.state.getAccount(String(USER_A.id))).toBeUndefined();
      expect((await t.follow(unusedOpen)).status).toBe(404);
      expect(await t.state.getPick(button.slice(2), t.clock.now)).toBeUndefined();
      expect((await t.bot.getInbound(t.keyOf(doc)))?.message).toEqual({
        id: t.keyOf(doc),
        type: 'message',
      });
      expect(await t.bot.senderState(String(USER_A.id))).toEqual({});
      expect((await t.bot.getSender(String(USER_A.id)))?.waId).toBeUndefined();
      // A redelivered update does not bring the item back; the next message asks for /login.
      await t.send(doc);
      expect(await t.store.getItem(OWNER_X, item.globalId)).toMatchObject({ deleted: true });
      await t.send(textUpdate('hello again'));
      expect(t.tg.textsTo(USER_A.id).at(-1)).toBe(TELEGRAM_REPLIES.loginFirst);
      // B is untouched.
      expect((await t.liveItems(OWNER_Y)).map((i) => i.title)).toEqual(['B keeps this']);
      expect(await t.state.getAccount(String(USER_B.id))).toBeDefined();
      expect((await t.bot.senderState(String(USER_B.id))).consentedAt).toBeDefined();
    });

    it('erases nothing without /delete, or when the button is tapped after 10 minutes', async () => {
      const t = await setup();
      await t.link();
      await t.send(textUpdate('note Keep me'));
      await t.send(callbackUpdate('delete'));
      expect(t.tg.textsTo(USER_A.id).at(-1)).toBe(TELEGRAM_REPLIES.deleteNotAsked);
      await t.send(textUpdate('/delete'));
      t.clock.now += 601;
      await t.send(callbackUpdate('delete'));
      expect(t.tg.textsTo(USER_A.id).at(-1)).toBe(TELEGRAM_REPLIES.deleteExpired);
      expect(await t.liveItems()).toHaveLength(1);
      expect(await t.state.getAccount(String(USER_A.id))).toBeDefined();
      // Those buttons are removed too (the stand-in's taps are on message 1).
      expect(t.tg.state.removed.slice(-2)).toEqual([
        { chatId: USER_A.id, messageId: 1 },
        { chatId: USER_A.id, messageId: 1 },
      ]);
    });

    it('/logout keeps what was saved in the library', async () => {
      const t = await setup();
      await t.link();
      await t.send(textUpdate('note Stays after logout'));
      await t.send(textUpdate('/logout'));
      expect((await t.liveItems()).map((i) => i.title)).toEqual(['Stays after logout']);
      expect(await t.state.getAccount(String(USER_A.id))).toBeUndefined();
      expect(await t.bot.senderState(String(USER_A.id))).toEqual({});
    });
  });

  describe('Error and refusal messages', () => {
    /** setup's account quota. */
    const QUOTA = 50_000_000;
    const LECTURE = 'Lecture 19_01_04_2026.pdf';
    /** Delivers updates and runs them with `telegram` (another bot than setup's, say). */
    const runWith = async (
      t: Awaited<ReturnType<typeof setup>>,
      telegram: ReturnType<typeof createTelegramBot>,
      ...updates: Record<string, unknown>[]
    ) => {
      await t.deliver(updates);
      await telegram.drain();
      await telegram.flush();
      return updates;
    };
    /** No reply shows an internal code, an error name or the engine's own wording. */
    const plainOnly = (texts: string[]) => {
      for (const text of texts) {
        expect(text).not.toMatch(/[A-Z]{2,}_[A-Z_]+|Error\b|\bat \S+:\d+/);
        for (const raw of Object.values(ENGINE_MESSAGES)) expect(text).not.toContain(raw);
      }
    };

    it('says a 71-page PDF is saved but over the 50-page search limit, and how to fix it', async () => {
      const t = await setup();
      await t.link();
      t.engine!.failures.push(
        new EngineIndexError('EXTRACTION_FAILED', ENGINE_MESSAGES.pageLimit, 71),
      );
      const pdf = pdfBytes('Lecture 19. ');
      t.tg.addFile('lecture', pdf);
      const [doc] = await t.send(
        documentUpdate({
          fileId: 'lecture',
          size: pdf.length,
          mimeType: 'application/pdf',
          fileName: LECTURE,
        }),
      );
      const item = await t.store.getItem(OWNER_X, telegramGlobalId(t.keyOf(doc)));
      expect(item).toMatchObject({ title: LECTURE, kind: 'pdf', deleted: false });
      expect(item?.index).toBeUndefined();
      expect(await t.bot.getJob(jobId('index', t.keyOf(doc)))).toMatchObject({
        state: 'failed',
        attempts: 1,
      });
      const expected =
        '"Lecture 19_01_04_2026.pdf" has 71 pages — search works on PDFs up to 50 pages. It\'s still saved; split it into smaller PDFs to make it searchable.';
      expect(
        TELEGRAM_REPLIES.notSearchable(
          { kind: 'too-many-pages', pageCount: 71 },
          { title: LECTURE, kind: 'pdf' },
          QUOTA,
        ),
      ).toBe(expected);
      const texts = t.tg.textsTo(USER_A.id);
      expect(texts.filter((text) => text === expected)).toHaveLength(1);
      expect(texts).toContain(REPLIES.saved(LECTURE));
      plainOnly(texts);
      // Told once: nothing more later, from this worker or another.
      t.clock.now += 86_400;
      expect(await t.telegram.drain()).toBe(0);
      expect(await t.makeBot().drain()).toBe(0);
      expect(t.tg.textsTo(USER_A.id)).toEqual(texts);
    });

    it('explains each other indexing failure with the file name, that it is still saved, and the fix', async () => {
      const t = await setup();
      await t.link();
      const cases = [
        [
          ENGINE_MESSAGES.pageLimit,
          'application/pdf',
          'Big lecture.pdf',
          { kind: 'too-many-pages' },
        ],
        [
          ENGINE_MESSAGES.password,
          'application/pdf',
          'Payslip.pdf',
          { kind: 'password-protected' },
        ],
        [
          ENGINE_MESSAGES.unreadablePdf,
          'application/pdf',
          'Broken.pdf',
          { kind: 'unreadable-pdf' },
        ],
        [ENGINE_MESSAGES.badImage, 'image/png', 'scan.png', { kind: 'bad-image' }],
        [
          ENGINE_MESSAGES.nothingSearchable,
          'application/pdf',
          'Blank page.pdf',
          { kind: 'nothing-searchable' },
        ],
        [
          ENGINE_MESSAGES.nothingSearchable,
          'image/jpeg',
          'Sky.jpg',
          { kind: 'nothing-searchable' },
        ],
        [
          'The engine stopped for an unknown reason.',
          'application/pdf',
          'Odd.pdf',
          { kind: 'other' },
        ],
      ] as const;
      let n = 0;
      for (const [message, mimeType, fileName, failure] of cases) {
        t.engine!.failures.push(new EngineIndexError('EXTRACTION_FAILED', message));
        const bytes =
          mimeType === 'application/pdf' ? pdfBytes(`File ${++n}. `) : jpegBytes(3000, ++n);
        t.tg.addFile(`f-${n}`, bytes);
        await t.send(documentUpdate({ fileId: `f-${n}`, size: bytes.length, mimeType, fileName }));
        const kind = mimeType === 'application/pdf' ? 'pdf' : 'image';
        expect(t.tg.textsTo(USER_A.id)).toContain(
          TELEGRAM_REPLIES.notSearchable(failure, { title: fileName, kind }, QUOTA),
        );
      }
      const texts = t.tg.textsTo(USER_A.id);
      expect(texts).toContain(
        '"Big lecture.pdf" has more than 50 pages — search works on PDFs up to 50 pages. It\'s still saved; split it into smaller PDFs to make it searchable.',
      );
      expect(texts).toContain(
        '"Payslip.pdf" is password-protected, so it can\'t be searched. It\'s still saved; remove the password (for example, print it to a new PDF) and send it again to make it searchable.',
      );
      // Every file is still saved, with a reply of its own about it.
      expect((await t.liveItems()).map((item) => item.title).sort()).toEqual(
        cases.map(([, , fileName]) => fileName).sort(),
      );
      for (const [, , fileName] of cases)
        expect(
          texts.filter(
            (text) => text.startsWith(`"${fileName}"`) || text.includes(` "${fileName}"`),
          ),
        ).toHaveLength(1);
      plainOnly(texts);
    });

    it('says when the library has no room to index, or to save, with the quota and how to free space', async () => {
      const t = await setup();
      await t.link();
      const pdf = pdfBytes('Mess menu. ');
      // Room for the first original, not for its index or anything more.
      const quota = pdf.length + 100;
      const small = t.makeBot(t.api, {
        quotaBytes: quota,
        onIndexJob: createTelegramIndexer({
          store: t.store,
          objects: t.objects,
          engine: t.engine!,
          quotaBytes: quota,
        }),
      });
      t.tg.addFile('menu', pdf);
      t.tg.addFile('second', pdf);
      await runWith(
        t,
        small,
        documentUpdate({
          fileId: 'menu',
          size: pdf.length,
          mimeType: 'application/pdf',
          fileName: 'Mess menu.pdf',
        }),
      );
      await runWith(
        t,
        small,
        documentUpdate({
          fileId: 'second',
          size: pdf.length,
          mimeType: 'application/pdf',
          fileName: 'Second.pdf',
        }),
        textUpdate(`note Bring the ID card. ${'Hostel rules for guests. '.repeat(10)}`),
      );
      expect((await t.liveItems()).map((item) => item.title)).toEqual(['Mess menu.pdf']);
      const texts = t.tg.textsTo(USER_A.id);
      expect(texts).toContain(
        TELEGRAM_REPLIES.notSearchable(
          { kind: 'library-full' },
          { title: 'Mess menu.pdf', kind: 'pdf' },
          quota,
        ),
      );
      expect(texts).toContain(TELEGRAM_REPLIES.full('Second.pdf', quota));
      expect(texts).toContain(TELEGRAM_REPLIES.full(undefined, quota));
      expect(TELEGRAM_REPLIES.full('Second.pdf', 200_000_000)).toBe(
        'Your Campus Recall cloud library has reached its 200 MB limit, so "Second.pdf" wasn\'t saved. Delete some items in the app to make room, then send it again.',
      );
      plainOnly(texts);
    });

    it('gives the general message when indexing keeps failing until the job gives up', async () => {
      const t = await setup();
      await t.link();
      const once = t.makeBot(t.api, { maxAttempts: 1 });
      t.engine!.failures.push(new Error('Engine host page crashed'));
      const pdf = pdfBytes('Timetable. ');
      t.tg.addFile('tt', pdf);
      await runWith(
        t,
        once,
        documentUpdate({
          fileId: 'tt',
          size: pdf.length,
          mimeType: 'application/pdf',
          fileName: 'Timetable.pdf',
        }),
      );
      expect(t.tg.textsTo(USER_A.id)).toContain(
        '"Timetable.pdf" is saved, but it couldn\'t be made searchable. You can still open it in the app.',
      );
      plainOnly(t.tg.textsTo(USER_A.id));
    });

    it('refuses what it cannot save, saying what was sent and what it can save', async () => {
      const t = await setup();
      await t.link();
      const file = { file_id: 'x', file_unique_id: 'ux' };
      await t.send(
        messageUpdate({ video_note: { ...file, length: 240, duration: 5 } }),
        messageUpdate({
          animation: { ...file, mime_type: 'video/mp4' },
          document: { ...file, mime_type: 'video/mp4', file_name: 'funny.gif.mp4' },
        }),
        messageUpdate({ contact: { phone_number: '+910000000000', first_name: 'Warden' } }),
        messageUpdate({ poll: { id: '1', question: 'Lunch?', options: [] } }),
        documentUpdate({
          fileId: 'nb',
          mimeType: 'application/x-ipynb+json',
          fileName: 'analysis.ipynb',
        }),
        documentUpdate({ fileId: 'heic', mimeType: 'image/heic', fileName: 'IMG_1234.HEIC' }),
        documentUpdate({
          fileId: 'pptx',
          mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        }),
        documentUpdate({ fileId: 'bin', mimeType: 'application/octet-stream' }),
        textUpdate(`note ${'a'.repeat(LIMITS.maxTextCodePoints + 1)}`),
        documentUpdate({
          fileId: 'big',
          size: 31_250_001,
          mimeType: 'application/pdf',
          fileName: 'Big notes.pdf',
        }),
        documentUpdate({
          fileId: 'poster',
          size: 23_400_000,
          mimeType: 'image/png',
          fileName: 'poster.png',
        }),
      );
      expect(await t.liveItems()).toEqual([]);
      expect(t.tg.state.getFileCalls).toEqual([]);
      expect(t.tg.textsTo(USER_A.id).slice(-11)).toEqual([
        TELEGRAM_REPLIES.videoNote,
        TELEGRAM_REPLIES.gif,
        TELEGRAM_REPLIES.contact,
        TELEGRAM_REPLIES.other,
        "Can't save .ipynb files. I can save photos, PDFs, text notes and links.",
        "Can't save .heic images. Send it as a photo, or as a JPEG, PNG or WebP file.",
        "Can't save .pptx files. Export it as a PDF and send that instead.",
        "Can't save this kind of file. I can save photos, PDFs, text notes and links.",
        TELEGRAM_REPLIES.longNote(LIMITS.maxTextCodePoints + 1),
        '"Big notes.pdf" is 31.3 MB, over the 20 MB limit for PDFs, so it wasn\'t saved. Compress it or split it into smaller PDFs, then send them again.',
        TELEGRAM_REPLIES.tooBig({ kind: 'image', name: 'poster.png', bytes: 23_400_000 }),
      ]);
      expect(TELEGRAM_REPLIES.longNote(20_001)).toBe(
        "This note is 20,001 characters, over the 20,000-character limit for notes, so it wasn't saved. Split it into shorter notes and send them one by one.",
      );
      plainOnly(t.tg.textsTo(USER_A.id));
    });

    it('asks to send a file again when it cannot be got from Telegram', async () => {
      const t = await setup();
      await t.link();
      const once = t.makeBot(t.api, { maxAttempts: 1 });
      const pdf = pdfBytes('Short. ');
      t.tg.addFile('short', pdf);
      t.tg.state.truncateDownloads = 1;
      await runWith(
        t,
        once,
        // Telegram no longer has this one; the other arrives a byte short.
        documentUpdate({ fileId: 'missing', size: 100, mimeType: 'application/pdf' }),
        documentUpdate({ fileId: 'short', size: pdf.length, mimeType: 'application/pdf' }),
      );
      expect(await t.liveItems()).toEqual([]);
      expect(t.tg.textsTo(USER_A.id).slice(-2)).toEqual([
        "Couldn't get that file from Telegram. Please send it again.",
        TELEGRAM_REPLIES.downloadFailed,
      ]);
    });

    it('says a problem on our side is ours, and to try again in a minute', async () => {
      const t = await setup();
      await t.link();
      const broken: PilotStore = Object.create(t.store, {
        changesAfter: {
          value: async () => {
            throw new Error('database unavailable');
          },
        },
      });
      const once = t.makeBot(t.api, { maxAttempts: 1, store: broken });
      await runWith(t, once, textUpdate('mess timings'));
      expect(t.tg.textsTo(USER_A.id).at(-1)).toBe(
        'Something went wrong on our side. Please try again in a minute.',
      );
      expect(TELEGRAM_REPLIES.serverError).toBe(t.tg.textsTo(USER_A.id).at(-1));
    });

    it('explains results matched only by title while their item is still being indexed', async () => {
      const t = await setup();
      await t.link();
      const waiting = t.makeBot(t.api, { onIndexJob: undefined });
      await runWith(t, waiting, textUpdate('note Badminton team signup'));
      await runWith(t, waiting, textUpdate('badminton'));
      const reply = t.tg.to(USER_A.id).at(-1)!;
      expect(reply.text).toContain('Badminton team signup (Note · still indexing)');
      expect(reply.text).toContain(TELEGRAM_REPLIES.stillIndexing);
      expect(reply.text).not.toContain(TELEGRAM_REPLIES.keywordOnly);
      await runWith(t, waiting, textUpdate('cricket'));
      expect(t.tg.textsTo(USER_A.id).at(-1)).toBe(
        'Nothing matched “cricket” in your Campus Recall library. Try other words.',
      );
    });
  });

  describe('Commands', () => {
    it('answers the menu commands once linked, and unknown commands with a pointer to /help', async () => {
      const t = await setup();
      await t.link();
      await t.send(
        textUpdate('/start'),
        textUpdate('/help@test_bot'),
        textUpdate('/privacy'),
        textUpdate('/resume'),
        textUpdate('/frobnicate'),
      );
      expect(t.tg.textsTo(USER_A.id).slice(-5)).toEqual([
        TELEGRAM_REPLIES.alreadyLinked(EMAIL_X),
        TELEGRAM_REPLIES.help(CONTACT),
        TELEGRAM_REPLIES.privacy(PRIVACY_URL),
        TELEGRAM_REPLIES.alreadyOn,
        TELEGRAM_REPLIES.unknownCommand('/frobnicate'),
      ]);
      // /help lists the bot's menu (BotFather's /setcommands list in docs/pilot/telegram-setup.md).
      for (const command of [
        '/login',
        '/open',
        '/logout',
        '/privacy',
        '/stop',
        '/resume',
        '/delete',
      ])
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
      await t.send(update, update, textUpdate('/start', other));
      expect(await t.bot.getInbound(t.keyOf(update))).toBeUndefined();
      expect(await t.bot.getSender(String(other.id))).toBeUndefined();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(t.tg.textsTo(other.id)).toEqual([TELEGRAM_REPLIES.notOpen, TELEGRAM_REPLIES.notOpen]);
      expect(await t.state.revokeLinks(String(other.id))).toEqual([]);
      // Allowed by ID and by username.
      await t.link(USER_A, EMAIL_X);
      await t.link(USER_B, EMAIL_Y);
      expect(await t.state.getAccount(String(USER_A.id))).toBeDefined();
      expect(await t.state.getAccount(String(USER_B.id))).toBeDefined();
    });
  });
});
