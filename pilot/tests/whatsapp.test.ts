/// <reference types="node" />
// The WhatsApp channel against a real local API server and a stand-in for Meta's Graph API:
// webhook verification and signatures, storing into per-sender vaults, kinds, limits and
// retries. Runs on memory stores, and on PostgreSQL and Azurite with npm run test:pilot:storage.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createPilotHandler } from '../server/app';
import { AzureBlobObjectStore } from '../server/blob';
import type { RateLimits } from '../server/limits';
import { MemoryObjectStore, MemoryPilotStore } from '../server/memory';
import { PostgresPilotStore } from '../server/postgres';
import type { ObjectStore, PilotStore } from '../server/store';
import { staticKeySource } from '../server/tokens';
import { createGraphClient } from '../server/whatsapp/graph';
import {
  REPLIES,
  createWhatsAppIngest,
  globalIdFor,
  sameSha256,
  startWhatsAppWorker,
  type WhatsAppWorkerOptions,
} from '../server/whatsapp/ingest';
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
  statusDelivery,
  type From,
} from './whatsapp-helpers';

const DATABASE = process.env.PILOT_TEST_DATABASE_URL;
const BLOB = process.env.PILOT_TEST_BLOB_CONNECTION;
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

const FROM_B: From = { bsuid: BSUID_B, phone: PHONE_B, name: 'Student B' };
const SENT_AT_MS = 1_762_300_000_000;

describe.each(backends)('WhatsApp channel: %s', (name, available, open) => {
  if (!available) {
    it.skip(`needs PILOT_TEST_DATABASE_URL and PILOT_TEST_BLOB_CONNECTION for ${name}`);
    return;
  }

  async function setup(
    over: {
      quotaBytes?: number;
      limits?: Partial<RateLimits>;
      whatsapp?: boolean;
      worker?: Partial<WhatsAppWorkerOptions>;
      /** Wraps the store the worker uses, to inject failures. */
      wrapStore?: (store: PilotStore) => PilotStore;
    } = {},
  ) {
    const stores = await open();
    const clock = { now: 1_762_300_010 };
    const graph = await startFakeGraph();
    cleanups.push(graph.close);
    const quotaBytes = over.quotaBytes ?? 50_000_000;
    let recorded = 0;
    const server: Server = createServer(
      createPilotHandler({
        clientId: 'pilot-client',
        allowedEmailDomain: 'iitgn.ac.in',
        origin: 'https://recall.example.test',
        keys: staticKeySource({}),
        store: stores.store,
        objects: stores.objects,
        nowSeconds: () => clock.now,
        quotaBytes,
        limits: over.limits,
        ...(over.whatsapp === false
          ? {}
          : {
              whatsapp: {
                verifyToken: VERIFY_TOKEN,
                appSecret: APP_SECRET,
                bot: stores.bot,
                phoneNumberId: PHONE_NUMBER_ID,
                onRecorded: () => recorded++,
              },
            }),
      }),
    );
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
    const errors: string[] = [];
    /** A worker on this test's stores; tests may run several, as several processes would. */
    const makeWorker = (options: Partial<WhatsAppWorkerOptions> = {}) =>
      createWhatsAppIngest({
        ...stores,
        store: over.wrapStore ? over.wrapStore(stores.store) : stores.store,
        graph: createGraphClient({
          accessToken: ACCESS_TOKEN,
          phoneNumberId: PHONE_NUMBER_ID,
          baseUrl: graph.base,
        }),
        quotaBytes,
        nowSeconds: () => clock.now,
        log: (message, detail) => errors.push(`${message}: ${String(detail)}`),
        ...over.worker,
        ...options,
      });
    const worker = makeWorker();

    /** Delivers a payload to the webhook as Meta does, signed unless told otherwise. */
    const deliver = (payload: unknown, signature?: string | null) => {
      const body = JSON.stringify(payload);
      return fetch(`${base}/whatsapp/webhook`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(signature === null ? {} : { 'x-hub-signature-256': signature ?? sign(body) }),
        },
        body,
      });
    };
    /** Delivers and processes messages from one sender; returns their message IDs. */
    const send = async (messages: Record<string, unknown>[], from?: From) => {
      const res = await deliver(delivery(messages, from));
      expect(res.status).toBe(200);
      await worker.drain();
      return messages.map((m) => m.id as string);
    };
    /** A session on a vault, opened through the store (the app sign-in comes later). */
    const sessionFor = async (ownerKey: string) => {
      const cookie = randomBytes(32).toString('base64url');
      await stores.store.createSession({
        id: createHash('sha256').update(cookie).digest('hex'),
        csrf: 'csrf',
        ownerKey,
        email: '',
        expiresAt: clock.now + 3600,
      });
      return (path: string) =>
        fetch(`${base}${path}`, { headers: { cookie: `recall_session=${cookie}` } });
    };
    const itemsOf = async (ownerKey: string) => {
      const { epoch } = await stores.store.vault(ownerKey);
      expect(epoch).toBe(1);
      return (await stores.store.changesAfter(ownerKey, 0)).changes.map((change) => change.item);
    };
    return {
      ...stores,
      clock,
      graph,
      base,
      worker,
      makeWorker,
      errors,
      deliver,
      send,
      sessionFor,
      itemsOf,
      recorded: () => recorded,
    };
  }
  const OWNER_A = `wa:${BSUID_A}`;
  const OWNER_B = `wa:${BSUID_B}`;

  describe('webhook subscription', () => {
    it("answers Meta's verification request with the challenge", async () => {
      const { base } = await setup();
      const res = await fetch(
        `${base}/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=1158201444`,
      );
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/^text\/plain/);
      expect(await res.text()).toBe('1158201444');
    });

    it.each([
      ['a wrong verify token', 'hub.mode=subscribe&hub.verify_token=guess&hub.challenge=1'],
      ['a different mode', `hub.mode=unsubscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=1`],
      ['no token', 'hub.mode=subscribe&hub.challenge=1'],
    ])('refuses %s', async (_case, query) => {
      const { base } = await setup();
      const res = await fetch(`${base}/whatsapp/webhook?${query}`);
      expect(res.status).toBe(403);
      expect(await res.text()).not.toContain('1"');
    });

    it('does not exist when the channel is not configured', async () => {
      const { base, deliver } = await setup({ whatsapp: false });
      const get = await fetch(
        `${base}/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=1`,
      );
      expect(get.status).toBe(404);
      expect((await get.json()).error.code).toBe('NOT_FOUND');
      const post = await deliver(delivery([message('text', { body: 'note hi' })]));
      expect(post.status).toBe(404);
    });
  });

  describe('W4 only signed deliveries are accepted', () => {
    const payload = () => delivery([message('text', { body: 'note Hostel curfew is 11 pm' })]);

    it.each([
      ['no signature', null, 401],
      ['a signature made with another secret', 'other', 403],
      ['a malformed signature header', 'garbage', 403],
    ])('rejects a delivery with %s and stores nothing', async (_case, kind, status) => {
      const { deliver, bot, worker, graph, itemsOf, recorded } = await setup();
      const body = payload();
      const wamid = body.entry[0].changes[0].value.messages[0].id as string;
      const signature =
        kind === null
          ? null
          : kind === 'other'
            ? sign(JSON.stringify(body), 'not-the-secret')
            : 'sha1=abc';
      const res = await deliver(body, signature);
      expect(res.status).toBe(status);
      expect(await bot.getInbound(wamid)).toBeUndefined();
      expect(await bot.getJob(jobId('ingest', wamid))).toBeUndefined();
      expect(await worker.drain()).toBe(0);
      expect(await itemsOf(OWNER_A)).toEqual([]);
      expect(graph.state.sent).toEqual([]);
      expect(recorded()).toBe(0);
    });

    it('rejects a body changed after signing', async () => {
      const { base, bot, worker, itemsOf } = await setup();
      const body = JSON.stringify(payload());
      const tampered = body.replace('11 pm', '1 am');
      const res = await fetch(`${base}/whatsapp/webhook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body) },
        body: tampered,
      });
      expect(res.status).toBe(403);
      expect(await worker.drain()).toBe(0);
      expect(await itemsOf(OWNER_A)).toEqual([]);
      const wamid = JSON.parse(body).entry[0].changes[0].value.messages[0].id;
      expect(await bot.getInbound(wamid)).toBeUndefined();
    });

    it('refuses bodies over 3 MB before checking anything else', async () => {
      const { base } = await setup();
      const body = JSON.stringify({ padding: 'x'.repeat(3 * 1024 * 1024) });
      const res = await fetch(`${base}/whatsapp/webhook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body) },
        body,
      });
      expect(res.status).toBe(413);
    });

    it('records a correctly signed delivery and answers 200 before processing', async () => {
      const { deliver, bot, itemsOf, recorded } = await setup();
      const body = payload();
      const wamid = body.entry[0].changes[0].value.messages[0].id as string;
      expect((await deliver(body)).status).toBe(200);
      expect((await bot.getInbound(wamid))?.ownerKey).toBe(OWNER_A);
      expect((await bot.getJob(jobId('ingest', wamid)))?.state).toBe('pending');
      expect(await itemsOf(OWNER_A)).toEqual([]);
      expect(recorded()).toBe(1);
    });

    it('ignores status updates and messages to another business number', async () => {
      const { deliver, worker } = await setup();
      expect((await deliver(statusDelivery())).status).toBe(200);
      const other = delivery([message('text', { body: 'note x' })]);
      other.entry[0].changes[0].value.metadata.phone_number_id = '999';
      expect((await deliver(other)).status).toBe(200);
      expect(await worker.drain()).toBe(0);
    });

    it("is not limited by the browsers' per-address rate limit", async () => {
      const { base, deliver } = await setup({
        limits: { addressBurst: 2, addressPerSecond: 0.001 },
      });
      for (let i = 0; i < 5; i++)
        expect((await deliver(delivery([message('text', { body: `note ${i}` })]))).status).toBe(
          200,
        );
      await fetch(`${base}/config`);
      await fetch(`${base}/config`);
      expect((await fetch(`${base}/config`)).status).toBe(429);
    });
  });

  describe('W2 the stored original is exactly what WhatsApp sent', () => {
    it("stores a photo byte for byte, checked against the webhook's base64 SHA-256", async () => {
      const { graph, send, sessionFor, itemsOf, bot } = await setup();
      const bytes = jpeg(48_000);
      const url = graph.addMedia('1003383421387256', bytes, 'image/jpeg');
      const [wamid] = await send([
        message('image', {
          caption: 'Hostel notice board',
          mime_type: 'image/jpeg',
          sha256: sha256Base64(bytes),
          id: '1003383421387256',
          url,
        }),
      ]);
      const globalId = globalIdFor(wamid);
      expect(globalId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(await itemsOf(OWNER_A)).toEqual([
        {
          globalId,
          kind: 'image',
          title: 'Hostel notice board',
          mimeType: 'image/jpeg',
          byteLength: bytes.length,
          contentSha256: sha256Hex(bytes),
          createdAt: SENT_AT_MS,
          revision: 1,
          deleted: false,
        },
      ]);
      // The webhook's URL was used directly; no lookup was needed.
      expect(graph.state.lookups).toEqual([]);

      const get = await sessionFor(OWNER_A);
      const res = await get(`/items/${globalId}/original`);
      expect(res.status).toBe(200);
      const downloaded = new Uint8Array(await res.arrayBuffer());
      expect(downloaded).toEqual(bytes);
      expect(Buffer.from(createHash('sha256').update(downloaded).digest()).toString('base64')).toBe(
        sha256Base64(bytes),
      );
      expect(graph.textsTo(BSUID_A)).toEqual(['Saved to Campus Recall: Hostel notice board']);
      // The seam for server indexing: the stored item has an index job waiting.
      expect((await bot.getJob(jobId('index', wamid)))?.state).toBe('pending');
    });

    it('looks the media up when the webhook has no URL, and accepts a hex SHA-256', async () => {
      const { graph, send, sessionFor, itemsOf } = await setup();
      const bytes = pdfBytes();
      graph.addMedia('2001', bytes, 'application/pdf');
      const [wamid] = await send([
        message('document', {
          filename: 'Mess menu November.pdf',
          mime_type: 'application/pdf',
          sha256: sha256Hex(bytes),
          id: '2001',
        }),
      ]);
      expect(graph.state.lookups).toEqual(['2001']);
      const [item] = await itemsOf(OWNER_A);
      expect(item).toMatchObject({
        kind: 'pdf',
        title: 'Mess menu November.pdf',
        mimeType: 'application/pdf',
        contentSha256: sha256Hex(bytes),
      });
      const res = await (await sessionFor(OWNER_A))(`/items/${globalIdFor(wamid)}/original`);
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
    });

    it('never stores bytes that do not match, and gives up after the last attempt', async () => {
      const { graph, send, worker, itemsOf, bot, clock, objects } = await setup({
        worker: { maxAttempts: 3 },
      });
      const bytes = jpeg(2000);
      const [wamid] = await send([
        message('image', {
          mime_type: 'image/jpeg',
          sha256: sha256Base64(jpeg(2000, 9)),
          id: '3001',
          url: graph.addMedia('3001', bytes, 'image/jpeg'),
        }),
      ]);
      expect(await bot.getJob(jobId('ingest', wamid))).toMatchObject({
        state: 'pending',
        attempts: 1,
        lastError: 'Downloaded bytes do not match the SHA-256 WhatsApp sent.',
      });
      for (let i = 0; i < 2; i++) {
        clock.now += 3600;
        await worker.drain();
      }
      expect((await bot.getJob(jobId('ingest', wamid)))?.state).toBe('failed');
      expect(await itemsOf(OWNER_A)).toEqual([]);
      expect(await objects.list(`${OWNER_A}/`)).toEqual([]);
      expect(graph.textsTo(BSUID_A)).toEqual([REPLIES.failed]);
    });
  });

  describe('W3 retries and repeated deliveries never duplicate', () => {
    it('stores a delivery that arrives twice once, with one confirmation', async () => {
      const { deliver, worker, graph, itemsOf } = await setup();
      const body = delivery([
        message('image', {
          caption: 'Timetable',
          mime_type: 'image/png',
          sha256: sha256Base64(jpeg(3000)),
          id: '4001',
          url: graph.addMedia('4001', jpeg(3000), 'image/png'),
        }),
      ]);
      expect((await deliver(body)).status).toBe(200);
      await worker.drain();
      expect((await deliver(body)).status).toBe(200);
      await worker.drain();
      expect(await itemsOf(OWNER_A)).toHaveLength(1);
      expect(graph.textsTo(BSUID_A)).toEqual(['Saved to Campus Recall: Timetable']);
    });

    it('stores two concurrent deliveries of one message once', async () => {
      const { deliver, worker, graph, itemsOf } = await setup();
      const body = delivery([message('text', { body: 'note Library closes at 2 am' })]);
      const answers = await Promise.all([deliver(body), deliver(body), deliver(body)]);
      expect(answers.map((res) => res.status)).toEqual([200, 200, 200]);
      // Two workers at once, as with two server processes.
      await Promise.all([worker.drain(), worker.drain()]);
      expect(await itemsOf(OWNER_A)).toHaveLength(1);
      expect(graph.textsTo(BSUID_A)).toEqual(['Saved to Campus Recall: Library closes at 2 am']);
    });

    it('a job retried after it had stored the item stores nothing new', async () => {
      // The item is published, then the worker loses its connection before finishing the job.
      let crash = true;
      const { deliver, worker, clock, graph, itemsOf, bot } = await setup({
        wrapStore: (store) =>
          new Proxy(store, {
            get(target, key, receiver) {
              if (key !== 'publish') return Reflect.get(target, key, receiver);
              return async (...args: Parameters<PilotStore['publish']>) => {
                const change = await target.publish(...args);
                if (crash) {
                  crash = false;
                  throw new Error('Connection lost');
                }
                return change;
              };
            },
          }),
      });
      const msg = message('text', { body: 'save Bus leaves at 8' });
      await deliver(delivery([msg]));
      await worker.drain();
      expect(crash).toBe(false);
      clock.now += 3600;
      await worker.drain();
      expect((await itemsOf(OWNER_A)).map((item) => item.globalId)).toEqual([globalIdFor(msg.id)]);
      expect(graph.textsTo(BSUID_A)).toEqual(['Saved to Campus Recall: Bus leaves at 8']);
      expect((await bot.getJob(jobId('ingest', msg.id)))?.state).toBe('done');
    });

    it('a job whose worker stopped is taken again after its lease', async () => {
      const { deliver, worker, bot, clock, itemsOf, graph } = await setup();
      const body = delivery([message('text', { body: 'note Lab report due Friday' })]);
      await deliver(body);
      const wamid = body.entry[0].changes[0].value.messages[0].id as string;
      // Another worker claimed it and then disappeared.
      expect((await bot.claimJob(['ingest'], clock.now, 300))?.id).toBe(jobId('ingest', wamid));
      expect(await worker.drain()).toBe(0);
      clock.now += 301;
      await worker.drain();
      expect(await itemsOf(OWNER_A)).toHaveLength(1);
      expect(graph.textsTo(BSUID_A)).toHaveLength(1);
    });
    it('a worker that finishes after its lease ran out sends no second confirmation', async () => {
      const { graph, deliver, worker, makeWorker, clock, itemsOf } = await setup();
      const bytes = jpeg(2500);
      // This worker stalls in the download until released.
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let stalled!: () => void;
      const reachedDownload = new Promise<void>((resolve) => (stalled = resolve));
      const real = createGraphClient({
        accessToken: ACCESS_TOKEN,
        phoneNumberId: PHONE_NUMBER_ID,
        baseUrl: graph.base,
      });
      const slow = makeWorker({
        graph: {
          ...real,
          async download(url, maxBytes) {
            stalled();
            await gate;
            return real.download(url, maxBytes);
          },
        },
      });
      await deliver(
        delivery([
          message('image', {
            caption: 'Slow photo',
            mime_type: 'image/jpeg',
            sha256: sha256Base64(bytes),
            id: '4101',
            url: graph.addMedia('4101', bytes, 'image/jpeg'),
          }),
        ]),
      );
      const first = slow.runOnce();
      await reachedDownload;
      clock.now += 301;
      await worker.drain();
      release();
      await first;
      expect(await itemsOf(OWNER_A)).toHaveLength(1);
      expect(graph.textsTo(BSUID_A)).toEqual(['Saved to Campus Recall: Slow photo']);
    });
  });

  describe('W5 each sender has a separate vault', () => {
    it("keeps senders' items apart from each other and from Google accounts", async () => {
      const { send, sessionFor, itemsOf, objects } = await setup();
      const [fromA] = await send([message('text', { body: 'note A: locker code 4471' })]);
      const [fromB] = await send(
        [message('text', { body: 'note B: wifi password' }, FROM_B)],
        FROM_B,
      );
      expect((await itemsOf(OWNER_A)).map((item) => item.globalId)).toEqual([globalIdFor(fromA)]);
      expect((await itemsOf(OWNER_B)).map((item) => item.globalId)).toEqual([globalIdFor(fromB)]);
      expect(await objects.list(`${OWNER_A}/`)).toEqual([
        `${OWNER_A}/1/${globalIdFor(fromA)}/original`,
      ]);

      const asA = await sessionFor(OWNER_A);
      const asB = await sessionFor(OWNER_B);
      const asGoogle = await sessionFor('google:subject-a');
      expect((await asA(`/items/${globalIdFor(fromA)}/original`)).status).toBe(200);
      for (const other of [asB, asGoogle]) {
        const res = await other(`/items/${globalIdFor(fromA)}/original`);
        expect(res.status).toBe(404);
        expect((await res.json()).error.code).toBe('NOT_FOUND');
      }
      const feed = await (await asB('/changes?epoch=1&after=0')).json();
      expect(feed.changes.map((c: { item: { globalId: string } }) => c.item.globalId)).toEqual([
        globalIdFor(fromB),
      ]);
      const google = await (await asGoogle('/changes?epoch=1&after=0')).json();
      expect(google.changes).toEqual([]);
    });

    it('a payload without a BSUID gets a separate phone-derived vault and replies by number', async () => {
      const { send, itemsOf, graph, bot } = await setup();
      const phoneOnly: From = { phone: PHONE_A };
      const [wamid] = await send(
        [message('text', { body: 'note old payload' }, phoneOnly)],
        phoneOnly,
      );
      const inbound = await bot.getInbound(wamid);
      expect(inbound?.ownerKey).toMatch(/^wa:phone-[0-9a-f]{32}$/);
      expect(inbound?.ownerKey).not.toContain(PHONE_A);
      expect(await itemsOf(inbound!.ownerKey)).toHaveLength(1);
      expect(await itemsOf(OWNER_A)).toEqual([]);
      expect(graph.state.sent).toEqual([
        expect.objectContaining({
          to: PHONE_A,
          text: { body: 'Saved to Campus Recall: old payload', preview_url: false },
        }),
      ]);
      expect(graph.state.sent[0]).not.toHaveProperty('recipient');
    });

    it('takes the BSUID from the contact when the message lacks from_user_id', async () => {
      const { send, itemsOf, bot } = await setup();
      const msg = message('text', { body: 'note from contact' }, { phone: PHONE_A });
      await send([msg], { bsuid: BSUID_A, phone: PHONE_A });
      expect(await itemsOf(OWNER_A)).toHaveLength(1);
      expect(await bot.getSender(BSUID_A)).toEqual({
        userId: BSUID_A,
        ownerKey: OWNER_A,
        waId: PHONE_A,
      });
    });
  });

  describe('Kinds: what is saved and what is answered', () => {
    it.each([
      ['a forwarded text', { forwarded: true }],
      ['a frequently forwarded text', { frequently_forwarded: true }],
    ])('saves %s as a note', async (_case, context) => {
      const { send, sessionFor, itemsOf } = await setup();
      const text = 'Reminder: the  physics quiz moved to\nThursday 10 am in AB 1/101.';
      const [wamid] = await send([message('text', { body: text }, undefined, { context })]);
      const [item] = await itemsOf(OWNER_A);
      expect(item).toMatchObject({
        kind: 'note',
        mimeType: 'text/plain;charset=utf-8',
        title: 'Reminder: the physics quiz moved to Thursday 10 am in AB…',
        createdAt: SENT_AT_MS,
      });
      expect(item).not.toHaveProperty('sourceUrl');
      const res = await (await sessionFor(OWNER_A))(`/items/${globalIdFor(wamid)}/original`);
      expect(await res.text()).toBe(text);
    });

    it.each([
      ['note ', 'note Buy lab coat'],
      ['Note ', 'Note Buy lab coat'],
      ['save ', 'save Buy lab coat'],
    ])('saves text starting with "%s" as a note without the prefix', async (_case, body) => {
      const { send, itemsOf, graph } = await setup();
      await send([message('text', { body })]);
      expect(await itemsOf(OWNER_A)).toMatchObject([
        { kind: 'note', title: 'Buy lab coat', byteLength: 12 },
      ]);
      expect(graph.textsTo(BSUID_A)).toEqual(['Saved to Campus Recall: Buy lab coat']);
    });

    it('saves a message that is only a link as a note with its source URL', async () => {
      const { send, itemsOf, sessionFor } = await setup();
      const link = 'https://iitgn.ac.in/academics/calendar';
      const [wamid] = await send([message('text', { body: ` ${link} ` })]);
      expect(await itemsOf(OWNER_A)).toMatchObject([
        { kind: 'note', sourceUrl: link, title: link },
      ]);
      const res = await (await sessionFor(OWNER_A))(`/items/${globalIdFor(wamid)}/original`);
      expect(await res.text()).toBe(link);
    });

    it('answers typed text with a one-line help and saves nothing', async () => {
      const { send, itemsOf, graph } = await setup();
      await send([message('text', { body: 'hello?' })]);
      await send([message('text', { body: 'see https://example.com later' })]);
      expect(await itemsOf(OWNER_A)).toEqual([]);
      expect(graph.textsTo(BSUID_A)).toEqual([REPLIES.help, REPLIES.help]);
    });

    it('hands typed text to the text hook instead, when one is set', async () => {
      const seen: unknown[] = [];
      const { send, itemsOf, graph } = await setup({
        worker: {
          onText: async (sender, text, msg) => {
            seen.push([sender, text, msg.id]);
          },
        },
      });
      const [wamid] = await send([message('text', { body: 'where is the mess menu' })]);
      expect(seen).toEqual([
        [{ userId: BSUID_A, ownerKey: OWNER_A, waId: PHONE_A }, 'where is the mess menu', wamid],
      ]);
      expect(await itemsOf(OWNER_A)).toEqual([]);
      expect(graph.state.sent).toEqual([]);
    });

    it('saves a photo sent as a document, titled by its file name', async () => {
      const { graph, send, itemsOf } = await setup();
      const bytes = jpeg(4000);
      await send([
        message('document', {
          filename: 'whiteboard.png',
          mime_type: 'image/png',
          sha256: sha256Base64(bytes),
          id: '5001',
          url: graph.addMedia('5001', bytes, 'image/png'),
        }),
      ]);
      expect(await itemsOf(OWNER_A)).toMatchObject([
        { kind: 'image', mimeType: 'image/png', title: 'whiteboard.png' },
      ]);
    });

    it('titles an uncaptioned photo by its date', async () => {
      const { graph, send, itemsOf } = await setup();
      const bytes = jpeg(1000);
      await send([
        message('image', {
          mime_type: 'image/webp',
          sha256: sha256Base64(bytes),
          id: '5002',
          url: graph.addMedia('5002', bytes, 'image/webp'),
        }),
      ]);
      expect(await itemsOf(OWNER_A)).toMatchObject([
        { kind: 'image', mimeType: 'image/webp', title: 'WhatsApp photo 2025-11-04' },
      ]);
    });

    it.each([
      [
        'a voice note',
        'audio',
        { mime_type: 'audio/ogg; codecs=opus', sha256: 'x', id: '6001', voice: true },
        REPLIES.voice,
      ],
      [
        'an audio file',
        'audio',
        { mime_type: 'audio/mpeg', sha256: 'x', id: '6002' },
        REPLIES.audio,
      ],
      ['a video', 'video', { mime_type: 'video/mp4', sha256: 'x', id: '6003' }, REPLIES.video],
      [
        'a sticker',
        'sticker',
        { mime_type: 'image/webp', sha256: 'x', id: '6004' },
        REPLIES.sticker,
      ],
      [
        'a Word document',
        'document',
        {
          filename: 'essay.docx',
          mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          sha256: 'x',
          id: '6005',
        },
        REPLIES.file,
      ],
      [
        'a location',
        'location',
        { latitude: 23.2, longitude: 72.68, name: 'IITGN' },
        REPLIES.location,
      ],
      ['a contact card', 'contacts', [{ name: { formatted_name: 'Warden' } }], REPLIES.contacts],
    ])('does not save %s and says why', async (_case, type, content, reply) => {
      const { send, itemsOf, graph, objects } = await setup();
      await send([message(type, content)]);
      expect(await itemsOf(OWNER_A)).toEqual([]);
      expect(await objects.list(`${OWNER_A}/`)).toEqual([]);
      expect(graph.state.downloads).toEqual([]);
      expect(graph.textsTo(BSUID_A)).toEqual([reply]);
    });

    it('explains files WhatsApp could not deliver and ignores reactions', async () => {
      const { send, graph } = await setup();
      await send([
        message('unsupported', { type: 'document' }, undefined, {
          errors: [{ code: 131052, title: 'Media file size too big' }],
        }),
      ]);
      await send([message('reaction', { message_id: 'wamid.out1', emoji: '👍' })]);
      expect(graph.textsTo(BSUID_A)).toEqual([REPLIES.tooBigForWhatsApp]);
    });
  });

  describe('Limits and quota', () => {
    it('refuses a photo over 20 MB without storing any of it', async () => {
      const { graph, send, itemsOf, objects } = await setup({ quotaBytes: 100_000_000 });
      const bytes = new Uint8Array(20_000_001);
      await send([
        message('image', {
          mime_type: 'image/jpeg',
          sha256: sha256Base64(bytes),
          id: '7001',
          url: graph.addMedia('7001', bytes, 'image/jpeg'),
        }),
      ]);
      expect(await itemsOf(OWNER_A)).toEqual([]);
      expect(await objects.list(`${OWNER_A}/`)).toEqual([]);
      expect(graph.textsTo(BSUID_A)).toEqual([REPLIES.bigImage]);
      expect(REPLIES.bigImage).toBe('This photo is over 20 MB, so it was not saved.');
    });

    it('refuses a PDF over 20 MB', async () => {
      const { graph, send, itemsOf } = await setup({ quotaBytes: 100_000_000 });
      const bytes = new Uint8Array(20_000_001);
      await send([
        message('document', {
          filename: 'big.pdf',
          mime_type: 'application/pdf',
          sha256: sha256Base64(bytes),
          id: '7002',
          url: graph.addMedia('7002', bytes, 'application/pdf'),
        }),
      ]);
      expect(await itemsOf(OWNER_A)).toEqual([]);
      expect(graph.textsTo(BSUID_A)).toEqual([REPLIES.bigPdf]);
    });

    it('refuses a note over 20,000 code points and accepts one at the limit', async () => {
      const { send, itemsOf, graph } = await setup();
      await send([message('text', { body: `note ${'😀'.repeat(20_001)}` })]);
      expect(await itemsOf(OWNER_A)).toEqual([]);
      await send([message('text', { body: `note ${'😀'.repeat(20_000)}` })]);
      expect(await itemsOf(OWNER_A)).toMatchObject([{ kind: 'note', byteLength: 80_000 }]);
      expect(graph.textsTo(BSUID_A)[0]).toBe(REPLIES.longNote);
    });

    it('refuses what would pass the account quota and publishes nothing', async () => {
      const { graph, send, itemsOf, objects } = await setup({ quotaBytes: 6000 });
      const first = jpeg(4000, 1);
      const second = jpeg(4000, 2);
      await send([
        message('image', {
          caption: 'first',
          mime_type: 'image/jpeg',
          sha256: sha256Base64(first),
          id: '8001',
          url: graph.addMedia('8001', first, 'image/jpeg'),
        }),
      ]);
      await send([
        message('image', {
          caption: 'second',
          mime_type: 'image/jpeg',
          sha256: sha256Base64(second),
          id: '8002',
          url: graph.addMedia('8002', second, 'image/jpeg'),
        }),
      ]);
      expect((await itemsOf(OWNER_A)).map((item) => item.title)).toEqual(['first']);
      expect(await objects.list(`${OWNER_A}/`)).toHaveLength(1);
      expect(graph.textsTo(BSUID_A)).toEqual(['Saved to Campus Recall: first', REPLIES.full]);
    });
  });

  describe('Media download and retries', () => {
    it('fetches a fresh URL once when the webhook URL has expired', async () => {
      const { graph, send, itemsOf } = await setup();
      const bytes = jpeg(3000);
      graph.addMedia('9001', bytes, 'image/jpeg');
      await send([
        message('image', {
          caption: 'expired link',
          mime_type: 'image/jpeg',
          sha256: sha256Base64(bytes),
          id: '9001',
          url: graph.expiredUrl('9001'),
        }),
      ]);
      expect(graph.state.lookups).toEqual(['9001']);
      expect(graph.state.downloads).toHaveLength(2);
      expect(await itemsOf(OWNER_A)).toMatchObject([{ title: 'expired link' }]);
    });

    it('retries later with growing delays when the fresh URL fails too', async () => {
      const { graph, send, worker, bot, clock, itemsOf } = await setup();
      const bytes = jpeg(3000);
      graph.addMedia('9002', bytes, 'image/jpeg');
      graph.state.expireLookups = true;
      const [wamid] = await send([
        message('image', {
          mime_type: 'image/jpeg',
          sha256: sha256Base64(bytes),
          id: '9002',
          url: graph.expiredUrl('9002'),
        }),
      ]);
      const id = jobId('ingest', wamid);
      expect(await bot.getJob(id)).toMatchObject({
        state: 'pending',
        attempts: 1,
        runAfter: clock.now + 30,
        lastError: 'Media download failed with HTTP 404.',
      });
      // Not before its time.
      expect(await worker.drain()).toBe(0);
      clock.now += 30;
      await worker.drain();
      expect(await bot.getJob(id)).toMatchObject({ attempts: 2, runAfter: clock.now + 60 });
      graph.state.expireLookups = false;
      clock.now += 60;
      await worker.drain();
      expect((await bot.getJob(id))?.state).toBe('done');
      expect(await itemsOf(OWNER_A)).toHaveLength(1);
      expect(graph.textsTo(BSUID_A)).toHaveLength(1);
    });

    it('fails for good after the last attempt and says so once', async () => {
      const { graph, send, worker, bot, clock, itemsOf } = await setup({
        worker: { maxAttempts: 3 },
      });
      const bytes = jpeg(3000);
      graph.state.failDownloads = 100;
      const [wamid] = await send([
        message('image', {
          mime_type: 'image/jpeg',
          sha256: sha256Base64(bytes),
          id: '9003',
          url: graph.addMedia('9003', bytes, 'image/jpeg'),
        }),
      ]);
      for (let i = 0; i < 5; i++) {
        clock.now += 3600;
        await worker.drain();
      }
      expect(await bot.getJob(jobId('ingest', wamid))).toMatchObject({
        state: 'failed',
        attempts: 3,
        lastError: 'Media download failed with HTTP 500.',
      });
      expect(await itemsOf(OWNER_A)).toEqual([]);
      expect(graph.textsTo(BSUID_A)).toEqual([REPLIES.failed]);
    });

    it('a failed confirmation is not sent again', async () => {
      const { graph, send, itemsOf, worker } = await setup();
      graph.state.failSends = 1;
      await send([message('text', { body: 'note kept anyway' })]);
      await worker.drain();
      expect(await itemsOf(OWNER_A)).toHaveLength(1);
      expect(graph.state.sent).toEqual([]);
    });

    it('limits how fast one sender is handled, without dropping messages', async () => {
      const { deliver, worker, clock, itemsOf, bot } = await setup({
        worker: { senderBurst: 2, senderPerMinute: 2 },
      });
      const notes = [1, 2, 3].map((n) => message('text', { body: `note item ${n}` }));
      await deliver(delivery(notes));
      await worker.drain();
      expect(await itemsOf(OWNER_A)).toHaveLength(2);
      const waiting = await bot.getJob(jobId('ingest', notes[2].id));
      expect(waiting).toMatchObject({ state: 'pending', attempts: 0 });
      // Another sender is not held up.
      await deliver(delivery([message('text', { body: 'note from B' }, FROM_B)], FROM_B));
      await worker.drain();
      expect(await itemsOf(OWNER_B)).toHaveLength(1);
      clock.now += 30;
      await worker.drain();
      expect(await itemsOf(OWNER_A)).toHaveLength(3);
    });
  });
});

describe('WhatsApp worker parts', () => {
  it('accepts WhatsApp SHA-256 values as hex or base64 only', () => {
    const bytes = jpeg(100);
    const hex = sha256Hex(bytes);
    expect(sameSha256(hex, hex)).toBe(true);
    expect(sameSha256(hex.toUpperCase(), hex)).toBe(true);
    expect(sameSha256(sha256Base64(bytes), hex)).toBe(true);
    expect(sameSha256(sha256Base64(bytes).replace('=', ''), hex)).toBe(true);
    expect(sameSha256(sha256Base64(jpeg(100, 2)), hex)).toBe(false);
    expect(sameSha256(hex.slice(2), hex)).toBe(false);
    expect(sameSha256('', hex)).toBe(false);
  });

  it('derives the same UUID v4 from a message ID every time', () => {
    const id = globalIdFor('wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQTRBNjU5OUFFRTAzODEwMTQ0RgA=');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(globalIdFor('wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQTRBNjU5OUFFRTAzODEwMTQ0RgA=')).toBe(id);
    expect(globalIdFor('wamid.other')).not.toBe(id);
  });

  it('runs in the background, starts at once when woken and stops cleanly', async () => {
    const graph = await startFakeGraph();
    cleanups.push(graph.close);
    const store = new MemoryPilotStore();
    const bot = new MemoryBotStore();
    const worker = startWhatsAppWorker({
      bot,
      store,
      objects: new MemoryObjectStore(),
      graph: createGraphClient({
        accessToken: ACCESS_TOKEN,
        phoneNumberId: PHONE_NUMBER_ID,
        baseUrl: graph.base,
      }),
      quotaBytes: 1_000_000,
      idleMs: 60_000,
    });
    cleanups.push(() => worker.stop());
    const msg = message('text', { body: 'note woken' });
    await bot.recordInbound(
      { userId: BSUID_A, ownerKey: `wa:${BSUID_A}` },
      {
        wamid: msg.id,
        senderId: BSUID_A,
        ownerKey: `wa:${BSUID_A}`,
        receivedAt: 1,
        message: msg,
      },
    );
    worker.wake();
    for (let i = 0; i < 100 && graph.state.sent.length === 0; i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    expect(graph.textsTo(BSUID_A)).toEqual(['Saved to Campus Recall: woken']);
    await worker.stop();
  });
});
