/// <reference types="node" />
// W7: server indexing of WhatsApp items, with a stand-in engine host. The real engine and models
// run in pilot/model-e2e/engine-host.spec.ts. Runs on memory stores, and on PostgreSQL and
// Azurite with npm run test:pilot:storage.
import 'fake-indexeddb/auto';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalEngine } from '../../src/engine';
import { CampusRecallDatabase, DexieLibraryRepository } from '../../src/storage';
import {
  PILOT_INDEX_VERSIONS,
  searchMetadataDigest,
  validateIndexBundle,
  type IndexBundle,
} from '../contract';
import { cloudSearchSegments, createEngineHost } from '../engine-host/host';
import { createPilotHandler } from '../server/app';
import { AzureBlobObjectStore } from '../server/blob';
import { MemoryObjectStore, MemoryPilotStore } from '../server/memory';
import { PostgresPilotStore } from '../server/postgres';
import type { ObjectStore, PilotStore } from '../server/store';
import { staticKeySource } from '../server/tokens';
import { EngineIndexError, FakeEngineHost } from '../server/whatsapp/engine-host';
import { createGraphClient } from '../server/whatsapp/graph';
import { createWhatsAppIndexer, ownerSearchItems } from '../server/whatsapp/indexer';
import {
  REPLIES,
  createWhatsAppIngest,
  globalIdFor,
  type WhatsAppWorkerOptions,
} from '../server/whatsapp/ingest';
import { PostgresBotStore } from '../server/whatsapp/postgres';
import { MemoryBotStore, jobId, type BotStore } from '../server/whatsapp/store';
import {
  ACCESS_TOKEN,
  APP_SECRET,
  BSUID_A,
  PHONE_NUMBER_ID,
  VERIFY_TOKEN,
  delivery,
  message,
  pdfBytes,
  sha256Hex,
  sign,
  startFakeGraph,
} from './whatsapp-helpers';

const DATABASE = process.env.PILOT_TEST_DATABASE_URL;
const BLOB = process.env.PILOT_TEST_BLOB_CONNECTION;
const ORIGIN = 'https://recall.example.test';
const OWNER_A = `wa:${BSUID_A}`;
const VERSION = PILOT_INDEX_VERSIONS[0];
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

describe.each(backends)('W7 server indexing: %s', (name, available, open) => {
  if (!available) {
    it.skip(`needs PILOT_TEST_DATABASE_URL and PILOT_TEST_BLOB_CONNECTION for ${name}`);
    return;
  }

  async function setup(
    over: { quotaBytes?: number; worker?: Partial<WhatsAppWorkerOptions> } = {},
  ) {
    const stores = await open();
    const clock = { now: 1_762_300_010 };
    const graph = await startFakeGraph();
    cleanups.push(graph.close);
    const quotaBytes = over.quotaBytes ?? 50_000_000;
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
    const engine = new FakeEngineHost();
    const errors: string[] = [];
    const onIndexJob = createWhatsAppIndexer({ ...stores, engine, quotaBytes });
    const makeWorker = (options: Partial<WhatsAppWorkerOptions> = {}) =>
      createWhatsAppIngest({
        ...stores,
        graph: createGraphClient({
          accessToken: ACCESS_TOKEN,
          phoneNumberId: PHONE_NUMBER_ID,
          baseUrl: graph.base,
        }),
        quotaBytes,
        nowSeconds: () => clock.now,
        log: (message, detail) => errors.push(`${message}: ${String(detail)}`),
        onIndexJob,
        ...over.worker,
        ...options,
      });
    const worker = makeWorker();

    /** Sends a PDF document from student A and runs a worker; returns its message ID. */
    const sendPdf = async (
      filename = 'Hostel guest rules.pdf',
      bytes = pdfBytes(),
      using = worker,
    ) => {
      graph.addMedia('7001', bytes, 'application/pdf');
      const msg = message('document', {
        filename,
        mime_type: 'application/pdf',
        sha256: sha256Hex(bytes),
        id: '7001',
      });
      const body = JSON.stringify(delivery([msg]));
      const res = await fetch(`${base}/whatsapp/webhook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body) },
        body,
      });
      expect(res.status).toBe(200);
      await using.drain();
      return msg.id as string;
    };
    /** A session on a vault, as the app will have once WhatsApp sign-in exists. */
    const sessionFor = async (ownerKey: string) => {
      const cookie = randomBytes(32).toString('base64url');
      await stores.store.createSession({
        id: createHash('sha256').update(cookie).digest('hex'),
        csrf: 'csrf',
        ownerKey,
        email: '',
        expiresAt: clock.now + 3600,
      });
      return (path: string, init: { method?: string; body?: unknown } = {}) =>
        fetch(`${base}${path}`, {
          method: init.method ?? 'GET',
          headers: {
            cookie: `recall_session=${cookie}`,
            ...(init.body !== undefined
              ? { 'content-type': 'application/json', origin: ORIGIN, 'x-recall-csrf': 'csrf' }
              : {}),
          },
          ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        });
    };
    const item = (wamid: string) => stores.store.getItem(OWNER_A, globalIdFor(wamid));
    return {
      ...stores,
      clock,
      graph,
      engine,
      errors,
      worker,
      makeWorker,
      onIndexJob,
      sendPdf,
      sessionFor,
      item,
    };
  }

  it('indexes a stored item and publishes a bundle that passes the P05 checks', async () => {
    const { sendPdf, engine, item, sessionFor, bot, objects, graph } = await setup();
    const bytes = pdfBytes();
    const wamid = await sendPdf('Hostel guest rules.pdf', bytes);
    const globalId = globalIdFor(wamid);

    // The engine got the stored original and the item's own description.
    expect(engine.calls).toHaveLength(1);
    expect(engine.calls[0]).toMatchObject({
      kind: 'pdf',
      mimeType: 'application/pdf',
      title: 'Hostel guest rules.pdf',
      createdAt: 1_762_300_000_000,
    });
    expect(new Uint8Array(engine.calls[0].bytes)).toEqual(bytes);

    const stored = await item(wamid);
    const digest = await searchMetadataDigest({ title: 'Hostel guest rules.pdf' });
    expect(stored?.index).toEqual({
      indexVersion: VERSION,
      contentSha256: sha256Hex(bytes),
      searchMetadataDigest: digest,
      segmentCount: 1,
    });
    // Same object key and revision rules as a device's PUT /items/{id}/index.
    expect(stored?.revision).toBe(1);
    expect(stored?.indexObjectKey).toBe(`${OWNER_A}/1/${globalId}/index`);
    expect(await objects.list(`${OWNER_A}/`)).toEqual([
      `${OWNER_A}/1/${globalId}/index`,
      `${OWNER_A}/1/${globalId}/original`,
    ]);
    expect((await bot.getJob(jobId('index', wamid)))?.state).toBe('done');

    // The app reads it like any device's bundle: in the change feed and from GET .../index.
    const get = await sessionFor(OWNER_A);
    const feed = await (await get('/changes?epoch=1&after=0')).json();
    expect(feed.changes.at(-1).item).toMatchObject({ globalId, index: stored?.index });
    const res = await get(`/items/${globalId}/index`);
    expect(res.status).toBe(200);
    const bundle = (await res.json()) as IndexBundle;
    const valid = validateIndexBundle(
      bundle,
      { globalId, contentSha256: sha256Hex(bytes), searchMetadataDigest: digest },
      PILOT_INDEX_VERSIONS,
    );
    expect(valid).toEqual({ ok: true, value: stored?.index });
    expect(bundle).toMatchObject({ dimension: 768, indexVersion: VERSION });
    // Nothing but the confirmation was sent.
    expect(graph.textsTo(BSUID_A)).toEqual(['Saved to Campus Recall: Hostel guest rules.pdf']);
  });

  it('a device can still replace the server-made bundle through the usual route', async () => {
    const { sendPdf, item, sessionFor } = await setup();
    const wamid = await sendPdf();
    const globalId = globalIdFor(wamid);
    const before = await item(wamid);
    const put = await sessionFor(OWNER_A);
    const bundle: IndexBundle = {
      globalId,
      contentSha256: before!.contentSha256,
      searchMetadataDigest: await searchMetadataDigest(before!),
      indexVersion: VERSION,
      dimension: 768,
      segments: [1, 2].map((page) => ({
        modality: 'text' as const,
        location: { kind: 'page' as const, page },
        text: `Page ${page}`,
        vector: Array.from({ length: 768 }, (_, i) => (i === page ? 1 : 0)),
      })),
    };
    const res = await put(`/items/${globalId}/index`, {
      method: 'PUT',
      body: { opId: randomUUID(), epoch: 1, bundle },
    });
    expect(res.status).toBe(200);
    expect((await item(wamid))?.index?.segmentCount).toBe(2);
  });

  it('respects the account quota: no bundle is stored and the student is told once', async () => {
    const bytes = pdfBytes();
    // Room for the original, not for its index as well.
    const { sendPdf, item, objects, bot, graph, worker, clock, store } = await setup({
      quotaBytes: bytes.length + 100,
    });
    const wamid = await sendPdf('Mess menu.pdf', bytes);
    const stored = await item(wamid);
    expect(stored?.index).toBeUndefined();
    expect(stored?.indexObjectKey).toBeUndefined();
    expect(await objects.list(`${OWNER_A}/`)).toEqual([
      `${OWNER_A}/1/${globalIdFor(wamid)}/original`,
    ]);
    expect(await store.committedBytes(OWNER_A)).toBe(bytes.length);
    const job = await bot.getJob(jobId('index', wamid));
    expect(job).toMatchObject({ state: 'failed', attempts: 1 });
    expect(job?.lastError).toContain('quota');
    clock.now += 7200;
    expect(await worker.drain()).toBe(0);
    expect(graph.textsTo(BSUID_A)).toEqual([
      'Saved to Campus Recall: Mess menu.pdf',
      REPLIES.indexFull('Mess menu.pdf'),
    ]);
  });

  it('skips an item deleted before its index job runs', async () => {
    const { sendPdf, engine, sessionFor, bot, objects, worker, makeWorker, graph } = await setup();
    const wamid = await sendPdf('First.pdf', pdfBytes(), makeWorker({ onIndexJob: undefined }));
    expect((await bot.getJob(jobId('index', wamid)))?.state).toBe('pending');
    const write = await sessionFor(OWNER_A);
    const res = await write(`/items/${globalIdFor(wamid)}`, {
      method: 'DELETE',
      body: { opId: randomUUID(), epoch: 1, expectedRevision: 1 },
    });
    expect(res.status).toBe(200);
    expect(await worker.drain()).toBe(1);
    expect(engine.calls).toEqual([]);
    expect((await bot.getJob(jobId('index', wamid)))?.state).toBe('done');
    expect(await objects.list(`${OWNER_A}/`)).toEqual([]);
    expect(graph.textsTo(BSUID_A)).toEqual(['Saved to Campus Recall: First.pdf']);
  });

  it('publishes nothing for an item deleted while it was being indexed', async () => {
    const { sendPdf, engine, sessionFor, bot, objects, worker, makeWorker, item, graph } =
      await setup();
    const wamid = await sendPdf('Second.pdf', pdfBytes(), makeWorker({ onIndexJob: undefined }));
    const write = await sessionFor(OWNER_A);
    engine.onIndex = async () => {
      const res = await write(`/items/${globalIdFor(wamid)}`, {
        method: 'DELETE',
        body: { opId: randomUUID(), epoch: 1, expectedRevision: 1 },
      });
      expect(res.status).toBe(200);
    };
    await worker.drain();
    expect(engine.calls).toHaveLength(1);
    expect(await item(wamid)).toMatchObject({ deleted: true, revision: 2 });
    expect((await item(wamid))?.index).toBeUndefined();
    expect(await objects.list(`${OWNER_A}/`)).toEqual([]);
    expect((await bot.getJob(jobId('index', wamid)))?.state).toBe('done');
    expect(graph.textsTo(BSUID_A)).toEqual(['Saved to Campus Recall: Second.pdf']);
  });

  it('indexes again with the new title when the item is renamed meanwhile', async () => {
    const { sendPdf, engine, sessionFor, worker, makeWorker, item } = await setup();
    const wamid = await sendPdf('Rules.pdf', pdfBytes(), makeWorker({ onIndexJob: undefined }));
    const write = await sessionFor(OWNER_A);
    engine.onIndex = async () => {
      engine.onIndex = undefined;
      const res = await write(`/items/${globalIdFor(wamid)}`, {
        method: 'PATCH',
        body: { opId: randomUUID(), epoch: 1, expectedRevision: 1, title: 'Hostel guest rules' },
      });
      expect(res.status).toBe(200);
    };
    await worker.drain();
    expect(engine.calls.map((call) => call.title)).toEqual(['Rules.pdf', 'Hostel guest rules']);
    const stored = await item(wamid);
    expect(stored).toMatchObject({ title: 'Hostel guest rules', revision: 2 });
    expect(stored?.index?.searchMetadataDigest).toBe(
      await searchMetadataDigest({ title: 'Hostel guest rules' }),
    );
  });

  it('a refused original fails at once and the student is told once in plain words', async () => {
    const { sendPdf, engine, bot, worker, makeWorker, clock, item, graph } = await setup();
    engine.failures.push(
      new EngineIndexError(
        'EXTRACTION_FAILED',
        'This PDF could not be read. Re-export or print it to a new PDF and add it again.',
      ),
    );
    const wamid = await sendPdf('Scanned notice.pdf');
    const job = await bot.getJob(jobId('index', wamid));
    expect(job).toMatchObject({ state: 'failed', attempts: 1 });
    expect(job?.lastError).toContain('could not be read');
    expect((await item(wamid))?.index).toBeUndefined();
    // Neither this worker nor another sends anything more.
    clock.now += 86_400;
    expect(await worker.drain()).toBe(0);
    expect(await makeWorker().drain()).toBe(0);
    expect(engine.calls).toHaveLength(1);
    expect(graph.textsTo(BSUID_A)).toEqual([
      'Saved to Campus Recall: Scanned notice.pdf',
      'Couldn\'t make "Scanned notice.pdf" searchable, but it is still saved in Campus Recall.',
    ]);
  });

  it('retries an engine host failure with the job backoff, without telling anyone', async () => {
    const { sendPdf, engine, bot, worker, clock, item, graph } = await setup();
    engine.failures.push(new Error('Engine host page crashed'), new Error('Indexing timed out'));
    const wamid = await sendPdf('Lab manual.pdf');
    expect(await bot.getJob(jobId('index', wamid))).toMatchObject({
      state: 'pending',
      attempts: 1,
      lastError: 'Engine host page crashed',
    });
    clock.now += 29;
    expect(await worker.drain()).toBe(0);
    clock.now += 1;
    await worker.drain();
    expect(await bot.getJob(jobId('index', wamid))).toMatchObject({
      state: 'pending',
      attempts: 2,
      lastError: 'Indexing timed out',
    });
    clock.now += 60;
    await worker.drain();
    expect((await bot.getJob(jobId('index', wamid)))?.state).toBe('done');
    expect((await item(wamid))?.index?.indexVersion).toBe(VERSION);
    expect(engine.calls).toHaveLength(3);
    expect(graph.textsTo(BSUID_A)).toEqual(['Saved to Campus Recall: Lab manual.pdf']);
  });

  it('after the last attempt the job fails and the student is told once', async () => {
    const { sendPdf, engine, bot, worker, clock, graph } = await setup({
      worker: { maxAttempts: 2 },
    });
    engine.failures.push(new Error('crashed'), new Error('crashed'), new Error('crashed'));
    const wamid = await sendPdf('Timetable.pdf');
    clock.now += 3600;
    await worker.drain();
    expect(await bot.getJob(jobId('index', wamid))).toMatchObject({
      state: 'failed',
      attempts: 2,
    });
    clock.now += 3600;
    expect(await worker.drain()).toBe(0);
    expect(graph.textsTo(BSUID_A)).toEqual([
      'Saved to Campus Recall: Timetable.pdf',
      REPLIES.notSearchable('Timetable.pdf'),
    ]);
  });

  it("lists an owner's usable bundles for search, leaving out stale and deleted ones", async () => {
    const { sendPdf, store, objects, sessionFor, engine } = await setup();
    const kept = await sendPdf('Kept.pdf', pdfBytes('Kept page. '));
    const renamed = await sendPdf('Renamed.pdf', pdfBytes('Renamed page. '));
    const removed = await sendPdf('Removed.pdf', pdfBytes('Removed page. '));
    expect(engine.calls).toHaveLength(3);
    const write = await sessionFor(OWNER_A);
    // A rename after indexing leaves a bundle for the old title; it must not be searched.
    await write(`/items/${globalIdFor(renamed)}`, {
      method: 'PATCH',
      body: { opId: randomUUID(), epoch: 1, expectedRevision: 1, title: 'New title' },
    });
    await write(`/items/${globalIdFor(removed)}`, {
      method: 'DELETE',
      body: { opId: randomUUID(), epoch: 1, expectedRevision: 1 },
    });
    const items = await ownerSearchItems(store, objects, OWNER_A);
    expect(items).toEqual([
      {
        globalId: globalIdFor(kept),
        kind: 'pdf',
        indexVersion: VERSION,
        segments: [expect.objectContaining({ text: 'Kept.pdf' })],
      },
    ]);
    expect(await ownerSearchItems(store, objects, 'wa:someone-else')).toEqual([]);
  });

  it('a job run again after its bundle was published does not index twice', async () => {
    const { sendPdf, engine, bot, onIndexJob, item } = await setup();
    const wamid = await sendPdf();
    const before = await item(wamid);
    // As after a crash between publishing and finishing the job.
    await onIndexJob((await bot.getJob(jobId('index', wamid)))!);
    expect(engine.calls).toHaveLength(1);
    expect(await item(wamid)).toEqual(before);
  });
});

describe('Engine host page logic', () => {
  const unit = (axis: number) => Array.from({ length: 768 }, (_, i) => (i === axis ? 1 : 0));
  function host() {
    const repository = new DexieLibraryRepository(
      new CampusRecallDatabase(`engine-host-test-${Math.random().toString(16).slice(2)}`),
    );
    const engine = new LocalEngine(repository);
    engine.ready = true;
    // Stands in for the query model; ranking is the app's own.
    Object.defineProperty(engine, 'models', {
      value: { query: async () => Float32Array.from(unit(3)) },
    });
    return { engine, ...createEngineHost(engine) };
  }

  it('maps bundles exactly as the app maps synced items', () => {
    const segments = cloudSearchSegments([
      {
        globalId: 'g1',
        kind: 'pdf',
        indexVersion: VERSION,
        segments: [
          { modality: 'text', location: { kind: 'page', page: 1 }, text: 'a', vector: unit(1) },
          { modality: 'visual', location: { kind: 'page', page: 2 }, vector: unit(2) },
        ],
      },
    ]);
    expect(segments).toEqual([
      {
        id: 'cloud:g1:0',
        itemId: 'cloud:g1',
        itemKind: 'pdf',
        modality: 'text',
        location: { kind: 'page', page: 1 },
        text: 'a',
        vector: Float32Array.from(unit(1)),
        indexVersion: VERSION,
      },
      {
        id: 'cloud:g1:1',
        itemId: 'cloud:g1',
        itemKind: 'pdf',
        modality: 'visual',
        location: { kind: 'page', page: 2 },
        text: undefined,
        vector: Float32Array.from(unit(2)),
        indexVersion: VERSION,
      },
    ]);
  });

  it("ranks an owner's bundles with the app's search and keeps the page", async () => {
    const { search, engine } = host();
    const hits = await search('when do guests need a pass', [
      {
        globalId: 'g-pdf',
        kind: 'pdf',
        indexVersion: VERSION,
        segments: [
          {
            modality: 'text',
            location: { kind: 'page', page: 2 },
            text: 'Guests need a pass from the warden before 6 pm.',
            vector: unit(3),
          },
        ],
      },
      {
        globalId: 'g-old',
        kind: 'pdf',
        indexVersion: 'older-model-v7',
        segments: [{ modality: 'text', location: { kind: 'whole' }, text: 'x', vector: unit(3) }],
      },
      {
        globalId: 'g-far',
        kind: 'image',
        indexVersion: VERSION,
        segments: [{ modality: 'visual', location: { kind: 'whole' }, vector: unit(9) }],
      },
    ]);
    expect(hits).toEqual([
      expect.objectContaining({
        globalId: 'g-pdf',
        itemId: 'cloud:g-pdf',
        segmentId: 'cloud:g-pdf:0',
        location: { kind: 'page', page: 2 },
        matchKind: 'text',
        excerpt: expect.stringContaining('Guests need a pass'),
      }),
    ]);
    // Search leaves no cloud segments behind for the next call.
    expect(engine.extraSegments).toBeUndefined();
  });

  it('refuses to work without the default model set up', async () => {
    const { search, engine } = host();
    engine.ready = false;
    await expect(search('guests', [])).rejects.toThrow('no models set up');
  });

  it('loads Playwright only when a browser host starts', async () => {
    const source = await readFile('pilot/server/whatsapp/engine-host.ts', 'utf8');
    expect(source).not.toMatch(/^import[^;]*playwright/m);
    expect(source).toContain("await import('@playwright/test')");
  });
});
