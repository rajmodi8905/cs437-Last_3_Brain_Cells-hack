/// <reference types="node" />
// The WhatsApp bot's conversation against a real local API server, the stand-in Graph API and
// FakeEngineHost: consent (W1), commands, batched confirmations, search replies (W8), one-time
// app links (W6) and DELETE ALL (W9). Runs on memory stores, and on PostgreSQL and Azurite with
// npm run test:pilot:storage.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createApiClient } from '../client/api';
import { MemoryLocalLibrary, MemoryRemoteIndexStore, MemorySyncStateStore } from '../client/memory';
import { SyncEngine } from '../client/sync';
import { createPilotHandler } from '../server/app';
import { backupDatabase, restoreDatabase } from '../server/backup';
import { AzureBlobObjectStore } from '../server/blob';
import { MemoryObjectStore, MemoryPilotStore } from '../server/memory';
import { BACKUP_TABLES, PostgresPilotStore } from '../server/postgres';
import type { ObjectStore, PilotStore } from '../server/store';
import { staticKeySource } from '../server/tokens';
import {
  BOT_REPLIES,
  META_LIMITS,
  clip,
  createWhatsAppConversation,
  parseRowId,
  rowId,
  type ConversationOptions,
} from '../server/whatsapp/conversation';
import { EngineHostUnavailableError, FakeEngineHost } from '../server/whatsapp/engine-host';
import { createGraphClient, type GraphClient } from '../server/whatsapp/graph';
import { createWhatsAppIndexer } from '../server/whatsapp/indexer';
import { REPLIES, createWhatsAppIngest, globalIdFor } from '../server/whatsapp/ingest';
import { hashLinkToken } from '../server/whatsapp/links';
import { PostgresBotStore } from '../server/whatsapp/postgres';
import { MemoryBotStore, jobId, type BotStore } from '../server/whatsapp/store';
import {
  ACCESS_TOKEN,
  APP_SECRET,
  BSUID_A,
  BSUID_B,
  PHONE_A,
  PHONE_B,
  PHONE_NUMBER_ID,
  VERIFY_TOKEN,
  delivery,
  jpeg,
  message,
  pdfBytes,
  sha256Base64,
  sha256Hex,
  sign,
  startFakeGraph,
  type From,
} from './whatsapp-helpers';

const DATABASE = process.env.PILOT_TEST_DATABASE_URL;
const BLOB = process.env.PILOT_TEST_BLOB_CONNECTION;
const ORIGIN = 'https://recall.example.test';
const PRIVACY_URL = 'https://recall.example.test/privacy.html';
const CONTACT = 'recall-team@example.test';
const NOTICE_VERSION = '2026-11-test';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

interface Stores {
  store: PilotStore;
  objects: ObjectStore;
  bot: BotStore;
}
const backends: [string, boolean, () => Promise<Stores>][] = [
  [
    'memory',
    true,
    async () => ({
      store: new MemoryPilotStore(),
      objects: new MemoryObjectStore(),
      bot: new MemoryBotStore(),
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
      return { store, objects, bot: new PostgresBotStore(store) };
    },
  ],
];

const FROM_A: From = { bsuid: BSUID_A, phone: PHONE_A, name: 'Student A' };
const FROM_B: From = { bsuid: BSUID_B, phone: PHONE_B, name: 'Student B' };
const OWNER_A = `wa:${BSUID_A}`;
const OWNER_B = `wa:${BSUID_B}`;
const LINK = /https:\/\/recall\.example\.test\/api\/v1\/whatsapp\/open\/([A-Za-z0-9_-]{43})/;
const text = (body: string, over: Record<string, unknown> = {}, from = FROM_A) =>
  message('text', { body }, from, over);
const listReply = (id: string, from = FROM_A) =>
  message(
    'interactive',
    { type: 'list_reply', list_reply: { id, title: 'x', description: 'y' } },
    from,
  );
const cookieOf = (res: Response) =>
  /recall_session=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1];

describe.each(backends)('WhatsApp conversation: %s', (name, available, open) => {
  if (!available) {
    it.skip(`needs PILOT_TEST_DATABASE_URL and PILOT_TEST_BLOB_CONNECTION for ${name}`);
    return;
  }

  async function setup(
    over: {
      engine?: FakeEngineHost | false;
      index?: boolean;
      conversation?: Partial<ConversationOptions>;
    } = {},
  ) {
    const stores = await open();
    const clock = { now: 1_762_300_010 };
    const graph = await startFakeGraph();
    cleanups.push(graph.close);
    const quotaBytes = 50_000_000;
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
        whatsapp: {
          verifyToken: VERIFY_TOKEN,
          appSecret: APP_SECRET,
          bot: stores.bot,
          phoneNumberId: PHONE_NUMBER_ID,
        },
      }),
    );
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
    const engine = over.engine === false ? undefined : (over.engine ?? new FakeEngineHost());
    const errors: string[] = [];
    const graphClient = createGraphClient({
      accessToken: ACCESS_TOKEN,
      phoneNumberId: PHONE_NUMBER_ID,
      baseUrl: graph.base,
    });
    // Batch windows run on these timers, fired by the test, never by the clock.
    const timers = new Set<() => void>();
    const conversation = createWhatsAppConversation({
      ...stores,
      graph: graphClient,
      schedule: (run) => {
        timers.add(run);
        return () => timers.delete(run);
      },
      ...(engine ? { engine } : {}),
      origin: ORIGIN,
      privacyUrl: PRIVACY_URL,
      contactEmail: CONTACT,
      noticeVersion: NOTICE_VERSION,
      batchMs: 60_000,
      nowSeconds: () => clock.now,
      log: (message, detail) => errors.push(`${message}: ${String(detail)}`),
      ...over.conversation,
    });
    /** A worker with this conversation; tests may run several, as several processes would. */
    const makeWorker = (graphFor: GraphClient = graphClient) =>
      createWhatsAppIngest({
        ...stores,
        graph: graphFor,
        quotaBytes,
        nowSeconds: () => clock.now,
        log: (message, detail) => errors.push(`${message}: ${String(detail)}`),
        ...conversation.hooks,
        ...(engine && over.index !== false
          ? { onIndexJob: createWhatsAppIndexer({ ...stores, engine, quotaBytes }) }
          : {}),
      });
    const worker = makeWorker();
    /** Ends every waiting batch window, as if it had run out. */
    const fireTimers = () => {
      for (const run of [...timers]) {
        timers.delete(run);
        run();
      }
    };
    /** Delivers a payload to the webhook without running a worker. */
    const deliverOnly = async (messages: Record<string, unknown>[], from: From = FROM_A) => {
      const body = JSON.stringify(delivery(messages, from));
      const res = await fetch(`${base}/whatsapp/webhook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body) },
        body,
      });
      expect(res.status).toBe(200);
      return messages.map((m) => m.id as string);
    };

    /** Delivers messages from one sender, runs the worker and sends waiting confirmations. */
    const send = async (messages: Record<string, unknown>[], from: From = FROM_A) => {
      const body = JSON.stringify(delivery(messages, from));
      const res = await fetch(`${base}/whatsapp/webhook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body) },
        body,
      });
      expect(res.status).toBe(200);
      await worker.drain();
      await conversation.flush();
      return messages.map((m) => m.id as string);
    };
    /** Sends the notice and agrees, as every student does first. */
    const agree = async (from: From = FROM_A) => {
      await send([text('hi', {}, from)], from);
      await send([text('AGREE', {}, from)], from);
    };
    const to = (from: From = FROM_A) => graph.messagesTo(from.bsuid ?? from.phone!);
    /** Text bodies sent to the student. */
    const texts = (from: From = FROM_A) =>
      to(from)
        .filter((sent) => sent.type === 'text')
        .map((sent) => (sent.text as { body: string }).body);
    const liveItems = async (ownerKey = OWNER_A) => {
      const { changes } = await stores.store.changesAfter(ownerKey, 0);
      const found = [];
      for (const id of new Set(changes.map((change) => change.item.globalId))) {
        const item = await stores.store.getItem(ownerKey, id);
        if (item && !item.deleted) found.push(item);
      }
      return found;
    };
    const pdf = (filename: string, bytes = pdfBytes(`${filename} `), from = FROM_A) => {
      const id = `m${randomBytes(4).toString('hex')}`;
      graph.addMedia(id, bytes, 'application/pdf');
      return message(
        'document',
        { filename, mime_type: 'application/pdf', sha256: sha256Hex(bytes), id },
        from,
      );
    };
    /** A session opened through the store, like the existing vault tests. */
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
    /** Asks the bot for a link and returns its token. */
    const openLink = async (from: From = FROM_A) => {
      await send([text('OPEN', {}, from)], from);
      const match = LINK.exec(texts(from).at(-1) ?? '');
      expect(match).not.toBeNull();
      return match![1];
    };
    const follow = (token: string, origin: string | null = ORIGIN) =>
      fetch(`${base}/whatsapp/open/${token}`, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          ...(origin ? { origin } : {}),
        },
        body: '',
      });
    return {
      ...stores,
      clock,
      graph,
      engine,
      errors,
      base,
      conversation,
      worker,
      makeWorker,
      graphClient,
      timers,
      fireTimers,
      deliverOnly,
      send,
      agree,
      to,
      texts,
      liveItems,
      pdf,
      sessionFor,
      get,
      openLink,
      follow,
    };
  }

  describe('W1 consent before anything is stored', () => {
    it('sends the notice once, stores nothing before AGREE and keeps no message content', async () => {
      const { send, texts, liveItems, bot, graph } = await setup();
      const photo = jpeg();
      const url = graph.addMedia('9001', photo, 'image/jpeg');
      const [first, second, third] = await send([
        text('Hostel curfew is 11 pm', { context: { forwarded: true } }),
        message('image', { id: '9001', mime_type: 'image/jpeg', sha256: sha256Base64(photo), url }),
        text('note Mess timings 8 to 10'),
      ]);
      expect(await liveItems()).toEqual([]);
      const sent = texts();
      expect(sent).toHaveLength(1);
      const notice = sent[0];
      expect(notice).toBe(BOT_REPLIES.notice(PRIVACY_URL));
      for (const part of ['18 or older', '30 days', 'Meta', 'DELETE ALL', PRIVACY_URL, 'server'])
        expect(notice).toContain(part);
      expect(notice.endsWith('Reply AGREE to start.')).toBe(true);
      for (const wamid of [first, second, third]) {
        const kept = await bot.getInbound(wamid);
        expect(JSON.stringify(kept!.message)).not.toMatch(/curfew|Mess|9001/);
      }
      expect(graph.state.downloads).toEqual([]);

      // Still before AGREE: no second notice.
      await send([text('note Library closes at 2')]);
      expect(texts()).toHaveLength(1);
      expect(await liveItems()).toEqual([]);
    });

    it('records consent with the notice version, asks to send things again, then saves', async () => {
      const { send, texts, liveItems, bot } = await setup();
      await send([text('note before agreeing')]);
      await send([text('agree')]);
      expect(texts().at(-1)).toBe(BOT_REPLIES.agreed);
      expect(texts().at(-1)).toMatch(/send it again/);
      const state = await bot.senderState(BSUID_A);
      expect(state.consentedAt).toBe(1_762_300_010);
      expect(state.noticeVersion).toBe(NOTICE_VERSION);
      expect(await liveItems()).toEqual([]);
      await send([text('note Mess timings 8 to 10')]);
      expect((await liveItems()).map((item) => item.title)).toEqual(['Mess timings 8 to 10']);
      expect(texts().at(-1)).toBe(REPLIES.saved('Mess timings 8 to 10'));
    });

    it('an AGREE before the notice was seen only gets the notice', async () => {
      const { send, texts, bot } = await setup();
      await send([text('AGREE')]);
      expect(texts()).toEqual([BOT_REPLIES.notice(PRIVACY_URL)]);
      expect((await bot.senderState(BSUID_A)).consentedAt).toBeUndefined();
    });

    it('answers HELP and PRIVACY before AGREE without storing anything', async () => {
      const { send, texts, liveItems } = await setup();
      await send([text('hello')]);
      await send([text('HELP')]);
      await send([text('privacy')]);
      expect(texts().slice(1)).toEqual([
        BOT_REPLIES.help(CONTACT),
        BOT_REPLIES.privacy(PRIVACY_URL),
      ]);
      expect(await liveItems()).toEqual([]);
    });

    it('each sender consents for themselves', async () => {
      const { agree, send, texts, liveItems } = await setup();
      await agree(FROM_A);
      await send([text('note from B', {}, FROM_B)], FROM_B);
      expect(texts(FROM_B)).toEqual([BOT_REPLIES.notice(PRIVACY_URL)]);
      expect(await liveItems(OWNER_B)).toEqual([]);
    });

    it('a student who never messages the bot has no sender, link or session rows', async () => {
      const { bot, store } = await setup();
      expect(await bot.getSender(BSUID_A)).toBeUndefined();
      expect(await bot.senderState(BSUID_A)).toEqual({});
      expect(await store.changesAfter(OWNER_A, 0)).toEqual({ cursor: 0, changes: [] });
    });
  });

  describe('commands', () => {
    it('HELP lists the commands and the contact; case and a full stop do not matter', async () => {
      const { agree, send, texts } = await setup();
      await agree();
      await send([text('  Help. ')]);
      const help = texts().at(-1)!;
      expect(help).toBe(BOT_REPLIES.help(CONTACT));
      for (const command of ['OPEN', 'PRIVACY', 'STOP', 'START', 'DELETE ALL', CONTACT])
        expect(help).toContain(command);
    });

    it('PRIVACY sends the privacy URL', async () => {
      const { agree, send, texts } = await setup();
      await agree();
      await send([text('PRIVACY')]);
      expect(texts().at(-1)).toContain(PRIVACY_URL);
    });

    it('a command must be the whole message; forwarded text is saved even if it says HELP', async () => {
      const { agree, send, texts, liveItems } = await setup();
      await agree();
      await send([text('HELP', { context: { forwarded: true } })]);
      expect((await liveItems()).map((item) => item.title)).toEqual(['HELP']);
      await send([text('help me find the timetable')]);
      expect(texts().at(-1)).not.toBe(BOT_REPLIES.help(CONTACT));
    });

    it('STOP stops saving and replying except to START, keeps the data, and START resumes', async () => {
      const { agree, send, texts, liveItems, to } = await setup();
      await agree();
      await send([text('note Kept through STOP')]);
      await send([text('stop')]);
      expect(texts().at(-1)).toBe(BOT_REPLIES.stopped);
      expect(texts().at(-1)).toMatch(/kept/);
      const before = to().length;
      await send([text('note Not saved while stopped'), text('HELP'), text('DELETE ALL')]);
      await send([text('timetable')]);
      expect(to()).toHaveLength(before);
      expect((await liveItems()).map((item) => item.title)).toEqual(['Kept through STOP']);
      await send([text('START')]);
      expect(texts().at(-1)).toBe(BOT_REPLIES.started);
      await send([text('note Saved again')]);
      expect((await liveItems()).map((item) => item.title).sort()).toEqual([
        'Kept through STOP',
        'Saved again',
      ]);
    });

    it('START while on says so', async () => {
      const { agree, send, texts } = await setup();
      await agree();
      await send([text('START')]);
      expect(texts().at(-1)).toBe(BOT_REPLIES.alreadyOn);
    });
  });

  describe('W9 DELETE ALL', () => {
    it('without CONFIRM DELETE nothing is erased', async () => {
      const { agree, send, texts, liveItems } = await setup();
      await agree();
      await send([text('note Keep me')]);
      await send([text('DELETE ALL')]);
      expect(texts().at(-1)).toBe(BOT_REPLIES.deleteAsk);
      expect(texts().at(-1)).toMatch(/CONFIRM DELETE within 10 minutes/);
      await send([text('note Another')]);
      expect(await liveItems()).toHaveLength(2);
    });

    it('CONFIRM DELETE with no request, or after 10 minutes, erases nothing', async () => {
      const { agree, send, texts, liveItems, clock } = await setup();
      await agree();
      await send([text('note Keep me')]);
      await send([text('CONFIRM DELETE')]);
      expect(texts().at(-1)).toBe(BOT_REPLIES.deleteNotAsked);
      await send([text('DELETE ALL')]);
      clock.now += 601;
      await send([text('confirm delete')]);
      expect(texts().at(-1)).toBe(BOT_REPLIES.deleteExpired);
      expect(await liveItems()).toHaveLength(1);
      // The expired request is gone: confirming again still does nothing.
      await send([text('CONFIRM DELETE')]);
      expect(texts().at(-1)).toBe(BOT_REPLIES.deleteNotAsked);
      expect(await liveItems()).toHaveLength(1);
    });

    it('erases the vault through the reset path, revokes links and sessions, and leaves others alone', async () => {
      const t = await setup();
      await t.agree(FROM_A);
      await t.agree(FROM_B);
      const [pdfId] = await t.send([t.pdf('Guest rules.pdf'), text('note Mess timings')]);
      await t.send([text('note B keeps this', {}, FROM_B)], FROM_B);
      const item = (await t.store.getItem(OWNER_A, globalIdFor(pdfId)))!;
      expect(item.indexObjectKey).toBeTruthy();
      const keys = [item.objectKey!, item.indexObjectKey!];
      expect(await t.objects.get(keys[0])).toBeDefined();
      const { epoch } = await t.store.vault(OWNER_A);

      // A link session, a session from the store, an unused link, and B's session.
      const used = await t.openLink();
      const linkCookie = cookieOf(await t.follow(used))!;
      const storeCookie = await t.sessionFor(OWNER_A);
      const unused = await t.openLink();
      const cookieB = await t.sessionFor(OWNER_B);
      expect((await t.get('/session', linkCookie)).status).toBe(200);

      await t.send([text('DELETE ALL')]);
      t.clock.now += 599;
      await t.send([text('CONFIRM DELETE')]);
      expect(t.texts().at(-1)).toBe(BOT_REPLIES.deleted);

      expect(await t.liveItems()).toEqual([]);
      expect((await t.store.vault(OWNER_A)).epoch).toBe(epoch + 1);
      for (const key of keys) expect(await t.objects.get(key)).toBeUndefined();
      for (const cookie of [linkCookie, storeCookie])
        expect((await t.get('/session', cookie)).status).toBe(401);
      expect((await t.get(`/whatsapp/open/${unused}`)).status).toBe(404);
      expect((await t.follow(unused)).status).toBe(404);

      // B is untouched.
      expect((await t.liveItems(OWNER_B)).map((i) => i.title)).toEqual(['B keeps this']);
      expect((await t.get('/session', cookieB)).status).toBe(200);
      expect((await t.bot.senderState(BSUID_B)).consentedAt).toBeDefined();

      // Only what dedupe needs is kept: the message ID, not its content or the number.
      const kept = await t.bot.getInbound(pdfId);
      expect(kept!.message).toEqual({ id: pdfId, type: 'document' });
      expect((await t.bot.getSender(BSUID_A))!.waId).toBeUndefined();
      expect(await t.bot.senderState(BSUID_A)).toEqual({});

      // A repeated delivery of an erased message does not bring it back.
      const again = JSON.stringify(delivery([{ ...t.pdf('Guest rules.pdf'), id: pdfId }], FROM_A));
      await fetch(`${t.base}/whatsapp/webhook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(again) },
        body: again,
      });
      await t.worker.drain();
      expect(await t.liveItems()).toEqual([]);

      // Starting again needs consent again.
      await t.send([text('note New start')]);
      expect(t.texts().at(-1)).toBe(BOT_REPLIES.notice(PRIVACY_URL));
      expect(await t.liveItems()).toEqual([]);
    });
  });

  describe('batched confirmations', () => {
    it('confirms a burst in one reply and each message at most once', async () => {
      const { agree, send, texts, worker, conversation, bot } = await setup();
      await agree();
      const before = texts().length;
      const ids = await send([text('note One'), text('note Two'), text('note Three')]);
      // Jobs that arrive together run in queue order, so the titles may come in any order.
      const replies = texts().slice(before);
      expect(replies).toHaveLength(1);
      expect(replies[0]).toMatch(/^Saved 3 items to AnyRecall: /);
      expect(replies[0].split(': ')[1].split(', ').sort()).toEqual(['One', 'Three', 'Two']);
      // Running again sends nothing more: every reply was claimed.
      await worker.drain();
      await conversation.flush();
      expect(texts().slice(before)).toHaveLength(1);
      for (const id of ids) expect(await bot.claimReply(id)).toBe(false);
    });

    it('a single save keeps the usual confirmation', async () => {
      const { agree, send, texts } = await setup();
      await agree();
      await send([text('note Only one')]);
      expect(texts().at(-1)).toBe(REPLIES.saved('Only one'));
    });

    it('saves further apart than the window are confirmed separately', async () => {
      const t = await setup();
      await t.agree();
      const before = t.texts().length;
      await t.deliverOnly([text('note First')]);
      await t.worker.drain();
      // The window runs out before the next save arrives.
      t.fireTimers();
      await t.conversation.flush();
      await t.deliverOnly([text('note Second')]);
      await t.worker.drain();
      t.fireTimers();
      await t.conversation.flush();
      expect(t.texts().slice(before)).toEqual([REPLIES.saved('First'), REPLIES.saved('Second')]);
    });

    it('waits for the window, then sends one reply on its own', async () => {
      const t = await setup();
      await t.agree();
      const before = t.texts().length;
      await t.deliverOnly([text('note Alpha'), text('note Beta')]);
      await t.worker.drain();
      // Each save restarted the window: one timer waits, and nothing is sent yet.
      expect(t.timers.size).toBe(1);
      expect(t.texts().slice(before)).toEqual([]);
      t.fireTimers();
      // flush has nothing left to send but waits for the confirmation the timer started.
      await t.conversation.flush();
      const replies = t.texts().slice(before);
      expect(replies).toHaveLength(1);
      expect(replies[0].split(': ')[1].split(', ').sort()).toEqual(['Alpha', 'Beta']);
    });

    it('sends at once when a burst reaches the maximum', async () => {
      const t = await setup({ conversation: { batchMax: 2 } });
      await t.agree();
      const before = t.texts().length;
      const body = JSON.stringify(delivery([text('note A1'), text('note A2'), text('note A3')]));
      await fetch(`${t.base}/whatsapp/webhook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body) },
        body,
      });
      await t.worker.drain();
      const first = t.texts().slice(before);
      expect(first).toHaveLength(1);
      expect(first[0]).toMatch(/^Saved 2 items/);
      await t.conversation.flush();
      const replies = t.texts().slice(before);
      expect(replies).toHaveLength(2);
      expect(replies[1]).toMatch(/^Saved to AnyRecall: A\d$/);
    });
  });

  describe('W8 search in WhatsApp', () => {
    const lists = (t: Awaited<ReturnType<typeof setup>>) =>
      t
        .to()
        .filter((sent) => sent.type === 'interactive')
        .map((sent) => sent.interactive as Record<string, any>)
        .filter((interactive) => interactive.type === 'list');

    it('answers typed text with a list of at most 5 results within Meta limits', async () => {
      const t = await setup();
      await t.agree();
      const long = 'Hostel guest rules and visiting hours for every block on campus.pdf';
      await t.send([t.pdf(long), ...Array.from({ length: 6 }, (_, i) => text(`note Item ${i}`))]);
      await t.send([text('when can guests visit')]);
      const [list] = lists(t);
      expect(list.body.text).toContain('when can guests visit');
      expect(Array.from(list.action.button as string).length).toBeLessThanOrEqual(
        META_LIMITS.listButton,
      );
      const rows = list.action.sections[0].rows as {
        id: string;
        title: string;
        description: string;
      }[];
      expect(rows).toHaveLength(5);
      for (const row of rows) {
        expect(Array.from(row.title).length).toBeLessThanOrEqual(META_LIMITS.rowTitle);
        expect(Array.from(row.description).length).toBeLessThanOrEqual(META_LIMITS.rowDescription);
        expect(row.id.length).toBeLessThanOrEqual(META_LIMITS.rowId);
        expect(parseRowId(row.id)).toBeDefined();
      }
      // The engine's best hit comes first, with its page and an excerpt.
      const pdfItem = (await t.liveItems()).find((item) => item.kind === 'pdf')!;
      expect(rows[0].id).toBe(rowId(pdfItem.globalId, { kind: 'page', page: 1 }));
      expect(rows[0].title).toBe(`${Array.from(long).slice(0, 23).join('').trimEnd()}…`);
      expect(rows[0].description).toMatch(/^p\. 1 · /);
      expect(list.footer).toBeUndefined();
    });

    it('also matches items still being indexed by title, marked as such', async () => {
      const t = await setup({ index: false });
      await t.agree();
      await t.send([text('note Bus timetable for weekends')]);
      await t.send([text('bus timetable')]);
      const rows = lists(t)[0].action.sections[0].rows;
      expect(rows).toHaveLength(1);
      expect(rows[0].title).toBe('Bus timetable for weeke…');
      expect(rows[0].description).toBe('Note · still indexing');
    });

    it('without an engine host searches titles by keyword only and says so', async () => {
      const t = await setup({ engine: false });
      await t.agree();
      await t.send([text('note Library hours in exam week'), text('note Mess menu')]);
      await t.send([text('library')]);
      const [list] = lists(t);
      expect(list.footer.text).toBe(BOT_REPLIES.keywordOnly);
      expect(list.action.sections[0].rows.map((row: { title: string }) => row.title)).toEqual([
        'Library hours in exam w…',
      ]);
      await t.send([text('swimming pool')]);
      expect(t.texts().at(-1)).toBe(BOT_REPLIES.noResults('swimming pool', true));
      expect(t.texts().at(-1)).toMatch(/only things you sent here are searched/);
      expect(t.texts().at(-1)).toMatch(/only titles/);
    });

    it('falls back to keywords when the engine host is unavailable', async () => {
      const engine = new FakeEngineHost();
      engine.search = async () => {
        throw new EngineHostUnavailableError('Browser crashed.');
      };
      const t = await setup({ engine });
      await t.agree();
      await t.send([text('note Sports complex timings')]);
      await t.send([text('sports')]);
      const [list] = lists(t);
      expect(list.footer.text).toBe(BOT_REPLIES.keywordOnly);
      expect(list.action.sections[0].rows[0].description).toBe('Note · title match');
    });

    it('says nothing matched when there are no results', async () => {
      const t = await setup({ index: false });
      await t.agree();
      await t.send([text('note Mess menu')]);
      await t.send([text('quantum physics')]);
      expect(t.texts().at(-1)).toBe(BOT_REPLIES.noResults('quantum physics', false));
      expect(lists(t)).toEqual([]);
    });

    it("searches only the sender's own items", async () => {
      const t = await setup({ index: false });
      await t.agree(FROM_A);
      await t.agree(FROM_B);
      await t.send([text('note Secret plan for B', {}, FROM_B)], FROM_B);
      await t.send([text('secret plan')]);
      expect(t.texts().at(-1)).toBe(BOT_REPLIES.noResults('secret plan', false));
    });
  });

  describe('W8 sending the original back', () => {
    /** Searches and picks the row with this title (FakeEngineHost does not rank by meaning). */
    const pickFirst = async (t: Awaited<ReturnType<typeof setup>>, title: string) => {
      await t.send([text(title)]);
      const list = t
        .to()
        .filter((sent) => sent.type === 'interactive')
        .map((sent) => sent.interactive as Record<string, any>)
        .findLast((interactive) => interactive.type === 'list')!;
      const rows = list.action.sections[0].rows as { id: string; title: string }[];
      const id = rows.find((row) =>
        title.toLowerCase().startsWith(row.title.replace(/…$/, '').toLowerCase()),
      )!.id;
      const before = t.to().length;
      await t.send([listReply(id)]);
      return t.to().slice(before);
    };

    it('uploads the PDF, sends it as a document with its title, then an Open in app link', async () => {
      const t = await setup();
      await t.agree();
      const bytes = pdfBytes('Guests must sign in at the gate. ');
      await t.send([t.pdf('Guest rules.pdf', bytes)]);
      const sent = await pickFirst(t, 'Guest rules.pdf');
      expect(sent.map((s) => s.type)).toEqual(['document', 'interactive']);
      const document = sent[0].document as Record<string, string>;
      const upload = t.graph.state.uploads.get(document.id)!;
      expect(sha256Hex(upload.bytes)).toBe(sha256Hex(bytes));
      expect(upload.mimeType).toBe('application/pdf');
      expect(document.caption).toBe('Guest rules.pdf (p. 1)');
      expect(document.filename).toBe('Guest rules.pdf');
      const cta = sent[1].interactive as Record<string, any>;
      expect(cta.type).toBe('cta_url');
      expect(cta.action.parameters.display_text).toBe('Open in app');
      expect(Array.from(cta.action.parameters.display_text as string).length).toBeLessThanOrEqual(
        META_LIMITS.ctaLabel,
      );
      const token = LINK.exec(cta.action.parameters.url as string)![1];
      expect((await t.follow(token)).status).toBe(303);
    });

    it('sends a photo as an image and a note as its text', async () => {
      const t = await setup();
      await t.agree();
      const photo = jpeg(6000, 7);
      const url = t.graph.addMedia('9101', photo, 'image/jpeg');
      await t.send([
        message('image', {
          id: '9101',
          mime_type: 'image/jpeg',
          sha256: sha256Base64(photo),
          url,
          caption: 'Lab safety poster',
        }),
      ]);
      const sentPhoto = await pickFirst(t, 'Lab safety poster');
      expect(sentPhoto.map((s) => s.type)).toEqual(['image', 'interactive']);
      const image = sentPhoto[0].image as Record<string, string>;
      expect(image.caption).toBe('Lab safety poster');
      expect(sha256Hex(t.graph.state.uploads.get(image.id)!.bytes)).toBe(sha256Hex(photo));

      await t.send([text('note Wifi password is on the notice board')]);
      const sentNote = await pickFirst(t, 'Wifi password is on the notice board');
      expect(sentNote.map((s) => s.type)).toEqual(['text', 'interactive']);
      expect((sentNote[0].text as { body: string }).body).toBe(
        'Wifi password is on the notice board',
      );
    });

    it('answers a pick once, and never sends another vault’s item', async () => {
      const t = await setup({ index: false });
      await t.agree(FROM_A);
      await t.agree(FROM_B);
      const [bNote] = await t.send([text('note B only', {}, FROM_B)], FROM_B);
      const before = t.to().length;
      const pick = listReply(rowId(globalIdFor(bNote), { kind: 'whole' }));
      await t.send([pick]);
      expect(
        t
          .to()
          .slice(before)
          .map((s) => s.type),
      ).toEqual(['text']);
      expect(t.texts().at(-1)).toBe(BOT_REPLIES.gone);
      expect(t.graph.state.uploads.size).toBe(0);
      // A repeated delivery of the same pick sends nothing more.
      await t.send([pick]);
      expect(t.to()).toHaveLength(before + 1);
    });

    it('a deleted item is reported as gone', async () => {
      const t = await setup({ index: false });
      await t.agree();
      const [id] = await t.send([text('note Soon deleted')]);
      const item = (await t.store.getItem(OWNER_A, globalIdFor(id)))!;
      await t.store.publish(
        OWNER_A,
        { ...item, deleted: true, revision: item.revision + 1 },
        (await t.store.vault(OWNER_A)).epoch,
      );
      await t.send([listReply(rowId(item.globalId, { kind: 'whole' }))]);
      expect(t.texts().at(-1)).toBe(BOT_REPLIES.gone);
    });
  });

  describe('W6 one-time links into the app', () => {
    it('OPEN replies with a path token that is stored only as its hash', async () => {
      const t = await setup();
      await t.agree();
      const token = await t.openLink();
      expect(t.texts().at(-1)).toContain(`${ORIGIN}/api/v1/whatsapp/open/${token}`);
      expect(t.texts().at(-1)).toMatch(/once, for 10 minutes/);
      expect(Buffer.from(token, 'base64url')).toHaveLength(32);
      expect(await t.bot.peekLink(token, t.clock.now)).toBeUndefined();
      expect(await t.bot.peekLink(hashLinkToken(token), t.clock.now)).toMatchObject({
        ownerKey: OWNER_A,
        label: `WhatsApp ••••${PHONE_A.slice(-4)}`,
        expiresAt: t.clock.now + 600,
      });
    });

    it('GET shows a self-contained confirmation page and uses nothing up', async () => {
      const t = await setup();
      await t.agree();
      const token = await t.openLink();
      for (let i = 0; i < 2; i++) {
        const res = await t.get(`/whatsapp/open/${token}`);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
        const csp = res.headers.get('content-security-policy')!;
        expect(csp).toContain("default-src 'none'");
        expect(csp).toContain("form-action 'self'");
        expect(csp).toContain("frame-ancestors 'none'");
        expect(csp).not.toMatch(/unsafe-inline|script-src/);
        expect(res.headers.get('cache-control')).toBe('no-store');
        expect(res.headers.get('set-cookie')).toBeNull();
        const html = await res.text();
        expect(html).toContain(`WhatsApp ••••${PHONE_A.slice(-4)}`);
        expect(html).not.toContain(PHONE_A);
        expect(html).toContain('<form method="post">');
        expect(html).not.toMatch(/<script|src=|href=/i);
      }
    });

    it('Continue opens a normal session for the WhatsApp vault and redirects to the app', async () => {
      const t = await setup();
      await t.agree();
      await t.send([text('note Visible in the app')]);
      const token = await t.openLink();
      const res = await t.follow(token);
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe(`${ORIGIN}/?signin=whatsapp#/settings`);
      const cookie = res.headers.get('set-cookie')!;
      expect(cookie).toMatch(/Path=\/api;/);
      expect(cookie).toMatch(/HttpOnly; Secure; SameSite=Lax/);
      const session = await (await t.get('/session', cookieOf(res))).json();
      expect(session.email).toBe(`WhatsApp ••••${PHONE_A.slice(-4)}`);
      expect(session.account).toBe(createHash('sha256').update(OWNER_A).digest('hex').slice(0, 32));
      const changes = await (
        await t.get(`/changes?epoch=${session.vault.epoch}&after=0`, cookieOf(res))
      ).json();
      // The item and then its index bundle: two changes for one item.
      expect(
        new Set(changes.changes.map((c: { item: { title: string } }) => c.item.title)),
      ).toEqual(new Set(['Visible in the app']));
      // Writes need the CSRF token and origin like any session.
      const write = await fetch(`${t.base}/vault`, {
        method: 'DELETE',
        headers: { cookie: `recall_session=${cookieOf(res)}`, 'content-type': 'application/json' },
        body: JSON.stringify({ confirm: 'remove-cloud-library', epoch: session.vault.epoch }),
      });
      expect(write.status).toBe(403);
      expect(await t.liveItems()).toHaveLength(1);
    });

    it('a link works once', async () => {
      const t = await setup();
      await t.agree();
      const token = await t.openLink();
      expect((await t.follow(token)).status).toBe(303);
      const again = await t.follow(token);
      expect(again.status).toBe(404);
      expect(again.headers.get('set-cookie')).toBeNull();
      expect(await again.text()).toMatch(/doesn't work any more/);
      expect((await t.get(`/whatsapp/open/${token}`)).status).toBe(404);
    });

    it('a link expires after 10 minutes', async () => {
      const t = await setup();
      await t.agree();
      const token = await t.openLink();
      t.clock.now += 601;
      expect((await t.get(`/whatsapp/open/${token}`)).status).toBe(404);
      const res = await t.follow(token);
      expect(res.status).toBe(404);
      expect(res.headers.get('set-cookie')).toBeNull();
    });

    it('a POST from another origin, or with none, opens nothing and leaves the link usable', async () => {
      const t = await setup();
      await t.agree();
      const token = await t.openLink();
      for (const origin of ['https://evil.example', 'null', null]) {
        const res = await t.follow(token, origin);
        expect(res.status).toBe(403);
        expect(res.headers.get('set-cookie')).toBeNull();
      }
      expect((await t.follow(token)).status).toBe(303);
    });

    it('an unknown or malformed token shows the error page', async () => {
      const t = await setup();
      for (const token of [randomBytes(32).toString('base64url'), 'short', 'a'.repeat(200)]) {
        const res = await t.get(`/whatsapp/open/${token}`);
        expect(res.status).toBe(404);
        expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
        expect((await t.follow(token)).status).toBe(404);
      }
    });

    it('the session reads only its own wa: vault', async () => {
      const t = await setup();
      await t.agree(FROM_A);
      await t.agree(FROM_B);
      const [bNote] = await t.send([text('note B private', {}, FROM_B)], FROM_B);
      const cookie = cookieOf(await t.follow(await t.openLink(FROM_A)))!;
      const res = await t.get(`/items/${globalIdFor(bNote)}/original`, cookie);
      expect(res.status).toBe(404);
      expect((await res.json()).error.code).toBe('NOT_FOUND');
    });

    it('a sender known only by BSUID is shown as their WhatsApp account', async () => {
      const t = await setup();
      const onlyBsuid: From = { bsuid: 'IN.55555555555555555555', name: 'C' };
      await t.agree(onlyBsuid);
      const token = await t.openLink(onlyBsuid);
      expect(await (await t.get(`/whatsapp/open/${token}`)).text()).toContain(
        'your WhatsApp account',
      );
    });

    it('the app lists and can search the vault without sending the device library (P02)', async () => {
      const t = await setup();
      await t.agree();
      await t.send([t.pdf('Guest rules.pdf')]);
      const cookie = cookieOf(await t.follow(await t.openLink()))!;
      const log: string[] = [];
      const api = createApiClient({
        base: t.base,
        fetch: async (input, init) => {
          log.push(`${init?.method ?? 'GET'} ${String(input).replace(t.base, '')}`);
          const headers = new Headers(init?.headers);
          headers.set('cookie', `recall_session=${cookie}`);
          headers.set('origin', ORIGIN);
          return fetch(input, { ...init, headers });
        },
      });
      const session = (await api.restoreSession())!;
      expect(session.kind).toBe('whatsapp');
      const library = new MemoryLocalLibrary();
      library.add(
        { kind: 'note', title: 'Device only', mimeType: 'text/plain;charset=utf-8' },
        new TextEncoder().encode('stays here'),
      );
      const remoteIndex = new MemoryRemoteIndexStore();
      const engine = new SyncEngine({
        api,
        library,
        state: new MemorySyncStateStore(),
        remoteIndex,
        libraryId: 'laptop',
      });
      await engine.browse(session.vault.epoch);
      expect((await engine.catalogue()).map((item) => item.title)).toEqual(['Guest rules.pdf']);
      const segments = await engine.cloudSegments();
      expect(segments.length).toBeGreaterThan(0);
      expect(log.every((line) => line.startsWith('GET '))).toBe(true);
      expect(log.some((line) => /\/items|\/uploads/.test(line) && !line.startsWith('GET'))).toBe(
        false,
      );
      // Running the normal pass without inclusion still sends nothing.
      await engine.runOnce();
      expect(log.every((line) => line.startsWith('GET '))).toBe(true);
      // A Google-style session body has no kind.
      const plain = await t.sessionFor('google:someone');
      expect((await (await t.get('/session', plain)).json()).kind).toBeUndefined();
    });

    it('does not exist without the WhatsApp channel', async () => {
      const stores = await open();
      const server = createServer(
        createPilotHandler({
          clientId: 'pilot-client',
          allowedEmailDomain: 'iitgn.ac.in',
          origin: ORIGIN,
          keys: staticKeySource({}),
          store: stores.store,
          objects: stores.objects,
          quotaBytes: 1000,
        }),
      );
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
      const res = await fetch(
        `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/whatsapp/open/${randomBytes(32).toString('base64url')}`,
      );
      expect(res.status).toBe(404);
      expect((await res.json()).error.code).toBe('NOT_FOUND');
    });
  });

  describe('review fixes', () => {
    it('a save in flight during DELETE ALL in another worker stores nothing and says nothing', async () => {
      const t = await setup();
      await t.agree();
      const photo = jpeg(4000, 3);
      const url = t.graph.addMedia('9301', photo, 'image/jpeg');
      // The first worker blocks in the download until the vault has been erased.
      let started!: () => void;
      const downloading = new Promise<void>((done) => (started = done));
      let release!: () => void;
      const gate = new Promise<void>((done) => (release = done));
      const slow = t.makeWorker({
        ...t.graphClient,
        download: async (from, max) => {
          started();
          await gate;
          return t.graphClient.download(from, max);
        },
      });
      const [photoId] = await t.deliverOnly([
        message('image', { id: '9301', mime_type: 'image/jpeg', sha256: sha256Base64(photo), url }),
      ]);
      const running = slow.runOnce();
      await downloading;
      await t.send([text('DELETE ALL')]);
      await t.send([text('CONFIRM DELETE')]);
      expect(t.texts().at(-1)).toBe(BOT_REPLIES.deleted);
      release();
      await running;
      await t.worker.drain();
      await t.conversation.flush();
      expect(await t.liveItems()).toEqual([]);
      expect(t.texts().at(-1)).toBe(BOT_REPLIES.deleted);
      expect(t.texts().some((body) => body.startsWith('Saved'))).toBe(false);
      expect(await t.bot.getJob(jobId('index', photoId))).toBeUndefined();
      expect((await t.bot.getInbound(photoId))!.message).toEqual({ id: photoId, type: 'image' });
    });

    it('START after a STOP sent before AGREE asks for AGREE', async () => {
      const t = await setup();
      await t.send([text('hi')]);
      await t.send([text('STOP')]);
      await t.send([text('START')]);
      expect(t.texts().at(-1)).toBe(BOT_REPLIES.agreeFirst);
      await t.send([text('AGREE')]);
      expect(t.texts().at(-1)).toBe(BOT_REPLIES.agreed);
    });

    it('a notice that could not be sent is sent with the next message', async () => {
      const t = await setup();
      t.graph.state.failSends = 1;
      await t.send([text('hi')]);
      expect(t.texts()).toEqual([]);
      await t.send([text('hello?')]);
      expect(t.texts()).toEqual([BOT_REPLIES.notice(PRIVACY_URL)]);
      await t.send([text('third')]);
      expect(t.texts()).toHaveLength(1);
    });

    it('a list reply before AGREE or during STOP sends nothing back', async () => {
      const t = await setup({ index: false });
      await t.agree(FROM_B);
      const [bNote] = await t.send([text('note Not for A', {}, FROM_B)], FROM_B);
      const pick = () => listReply(rowId(globalIdFor(bNote), { kind: 'whole' }), FROM_B);
      await t.send([text('STOP', {}, FROM_B)], FROM_B);
      const during = t.to(FROM_B).length;
      await t.send([pick()], FROM_B);
      expect(t.to(FROM_B)).toHaveLength(during);
      // Before AGREE (A never agreed): only the notice, once, and no upload.
      await t.send([listReply(rowId(globalIdFor(bNote), { kind: 'whole' }))]);
      await t.send([listReply(rowId(globalIdFor(bNote), { kind: 'whole' }))]);
      expect(t.to().map((sent) => sent.type)).toEqual(['text']);
      expect(t.graph.state.uploads.size).toBe(0);
    });

    it('an item the chat cannot carry gets a pointer to the app instead', async () => {
      const t = await setup({ index: false });
      await t.agree();
      const [id] = await t.send([text('note Lecture recording')]);
      const item = (await t.store.getItem(OWNER_A, globalIdFor(id)))!;
      // As if it came from an included device library: an audio item.
      await t.store.publish(
        OWNER_A,
        { ...item, kind: 'audio', mimeType: 'audio/mpeg', revision: item.revision + 1 },
        (await t.store.vault(OWNER_A)).epoch,
      );
      const before = t.to().length;
      await t.send([listReply(rowId(item.globalId, { kind: 'whole' }))]);
      const sent = t.to().slice(before);
      expect(sent.map((s) => s.type)).toEqual(['text', 'interactive']);
      expect((sent[0].text as { body: string }).body).toBe(BOT_REPLIES.appOnly);
      expect(t.graph.state.uploads.size).toBe(0);
    });

    it('two uses of one link at the same time open one session', async () => {
      const t = await setup();
      await t.agree();
      const token = await t.openLink();
      const results = await Promise.all([t.follow(token), t.follow(token), t.follow(token)]);
      expect(results.map((res) => res.status).sort()).toEqual([303, 404, 404]);
      expect(results.filter((res) => cookieOf(res))).toHaveLength(1);
    });

    it('following a link again on a browser already signed in to that vault works', async () => {
      const t = await setup();
      await t.agree();
      const first = cookieOf(await t.follow(await t.openLink()))!;
      const token = await t.openLink();
      const res = await fetch(`${t.base}/whatsapp/open/${token}`, {
        method: 'POST',
        redirect: 'manual',
        headers: { origin: ORIGIN, cookie: `recall_session=${first}` },
      });
      expect(res.status).toBe(303);
      expect((await t.get('/session', cookieOf(res))).status).toBe(200);
      expect((await t.get('/session', first)).status).toBe(401);
    });

    it('clips between whole characters', () => {
      expect(clip('Café notes 👩‍💻👩‍💻👩‍💻', 13)).toBe('Café notes…');
      expect(clip('🇮🇳🇮🇳🇮🇳🇮🇳', 5)).toBe('🇮🇳🇮🇳…');
      expect(Array.from(clip('é'.normalize('NFD').repeat(30), 24)).length).toBeLessThanOrEqual(24);
      expect(clip('short', 24)).toBe('short');
    });
  });

  it('stores the new consent state', async () => {
    expect(BACKUP_TABLES).toContain('wa_links');
    const { bot } = await setup();
    await bot.recordInbound(
      { userId: BSUID_A, ownerKey: OWNER_A, waId: PHONE_A },
      {
        wamid: 'wamid.x',
        senderId: BSUID_A,
        ownerKey: OWNER_A,
        receivedAt: 5,
        message: { id: 'wamid.x', type: 'text', text: { body: 'hi' } },
      },
    );
    expect(await bot.claimNotice(BSUID_A, 6)).toBe(true);
    expect(await bot.claimNotice(BSUID_A, 7)).toBe(false);
    await bot.setConsent(BSUID_A, 8, 'v1');
    await bot.setDeleteRequest(BSUID_A, 9);
    expect(await bot.senderState(BSUID_A)).toEqual({
      noticeSentAt: 6,
      consentedAt: 8,
      noticeVersion: 'v1',
      deleteRequestedAt: 9,
    });
    await bot.setDeleteRequest(BSUID_A, undefined);
    await bot.setStopped(BSUID_A, 10);
    expect((await bot.senderState(BSUID_A)).stoppedAt).toBe(10);
    await bot.setConsent(BSUID_A, 11, 'v2');
    expect(await bot.senderState(BSUID_A)).toEqual({
      noticeSentAt: 6,
      consentedAt: 11,
      noticeVersion: 'v2',
    });
  });
});

describe('WhatsApp conversation: PostgreSQL backup', () => {
  it.skipIf(!DATABASE)('backs up and restores consent, STOP and link rows', async () => {
    expect(BACKUP_TABLES).toContain('wa_links');
    const pilot = await PostgresPilotStore.open({
      connectionString: DATABASE!,
      schema: `test_${randomUUID().replaceAll('-', '')}`,
    });
    cleanups.push(async () => {
      await pilot.dropSchemaForTests();
      await pilot.close();
    });
    const bot = new PostgresBotStore(pilot);
    const sender = { userId: BSUID_A, ownerKey: OWNER_A, waId: PHONE_A };
    await bot.recordInbound(sender, {
      wamid: 'wamid.backup',
      senderId: BSUID_A,
      ownerKey: OWNER_A,
      receivedAt: 5,
      message: { id: 'wamid.backup', type: 'text', text: { body: 'hi' } },
    });
    await bot.claimNotice(BSUID_A, 6);
    await bot.setConsent(BSUID_A, 7, 'v1');
    await bot.setStopped(BSUID_A, 8);
    await bot.setDeleteRequest(BSUID_A, 9);
    const link = {
      tokenHash: 'a'.repeat(64),
      ownerKey: OWNER_A,
      label: 'WhatsApp ••••3210',
      createdAt: 10,
      expiresAt: 610,
    };
    await bot.createLink(link);
    const target = new MemoryObjectStore();
    const backup = await backupDatabase({ store: pilot, target, now: () => 1_762_300_000_000 });
    expect(backup.counts).toMatchObject({ wa_senders: 1, wa_links: 1 });

    const restored = await restoreDatabase({
      source: target,
      key: backup.key,
      connectionString: DATABASE!,
      schema: `test_${randomUUID().replaceAll('-', '')}`,
    });
    cleanups.push(async () => {
      await restored.store.dropSchemaForTests();
      await restored.store.close();
    });
    const again = new PostgresBotStore(restored.store);
    expect(await again.senderState(BSUID_A)).toEqual({
      noticeSentAt: 6,
      consentedAt: 7,
      noticeVersion: 'v1',
      stoppedAt: 8,
      deleteRequestedAt: 9,
    });
    expect(await again.peekLink(link.tokenHash, 100)).toEqual(link);
    expect(await again.takeLink(link.tokenHash, 100)).toEqual(link);
    expect(await again.takeLink(link.tokenHash, 100)).toBeUndefined();
  });
});
