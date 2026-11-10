/// <reference types="node" />
// W8 with the real engine and pinned models: a student sends the fixture PDF and photo to the
// bot, the server indexes them with the engine host, and for the queries of engine-host.spec.ts
// the bot's top result is the same item and location that the app's own search returns for the
// same WhatsApp vault, opened in the app from the bot's link. The pilot server runs in process
// with the stand-in Graph API (the shared servers do not run the channel until #58).
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { createPilotHandler } from '../server/app';
import { MemoryObjectStore, MemoryPilotStore } from '../server/memory';
import { createStaticHandler } from '../server/static';
import { staticKeySource } from '../server/tokens';
import { createWhatsAppConversation, parseRowId } from '../server/whatsapp/conversation';
import { PlaywrightEngineHost } from '../server/whatsapp/engine-host';
import { createGraphClient } from '../server/whatsapp/graph';
import { createWhatsAppIndexer } from '../server/whatsapp/indexer';
import { createWhatsAppIngest, globalIdFor } from '../server/whatsapp/ingest';
import { MemoryBotStore } from '../server/whatsapp/store';
import {
  ACCESS_TOKEN,
  APP_SECRET,
  BSUID_A,
  PHONE_NUMBER_ID,
  VERIFY_TOKEN,
  delivery,
  message,
  sha256Base64,
  sha256Hex,
  sign,
  startFakeGraph,
} from '../tests/whatsapp-helpers';

// The files, titles and queries of engine-host.spec.ts (corpus targets R3 and R1).
const PDF = 'tests/fixtures/sample-03.pdf';
const PDF_SHA256 = '5b124fb2928e9db137ff87b77d6351100f828b9853059733f39e61bab3480374';
const PDF_TITLE = 'Synced synthetic document';
const PDF_QUERY = 'How many classmates can work together for CS437?';
const IMAGE = 'tests/fixtures/sample-01.jpg';
const IMAGE_TITLE = 'Notice board photo';
const IMAGE_QUERY = 'Find the badminton team registration announcement';
const QUOTA = 200_000_000;

/** Sets the app's models up like a student would, answered from the local checksum mirror. */
async function prepareApp(context: BrowserContext, page: Page, site: string) {
  const manifest = JSON.parse(await readFile('public/asset-manifest.json', 'utf8')) as {
    assets: { url: string; sha256: string }[];
  };
  const external: string[] = [];
  let setup = true;
  await context.route(/^https?:\/\//, async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1') return route.continue();
    const asset = manifest.assets.find((entry) => entry.url === url.href);
    if (!setup || !asset) {
      external.push(`${route.request().method()} ${url.href}`);
      return route.abort();
    }
    return route.fulfill({
      status: 302,
      headers: {
        location: `http://127.0.0.1:4180/${asset.sha256}`,
        'access-control-allow-origin': '*',
      },
    });
  });
  await page.goto(`${site}/#/library`);
  await page.getByRole('button', { name: 'Open my library' }).click();
  await page.goto(`${site}/#/settings`);
  await page.getByRole('button', { name: 'Download offline search', exact: true }).click();
  await expect(page.getByText('Assets verified', { exact: true })).toBeVisible({
    timeout: 180_000,
  });
  setup = false;
  return external;
}

test("W8: the bot's top result is the item and location the app's own search returns", async ({
  browser,
}, testInfo) => {
  test.setTimeout(1_200_000);
  const pdf = new Uint8Array(await readFile(PDF));
  const image = new Uint8Array(await readFile(IMAGE));
  expect(createHash('sha256').update(pdf).digest('hex')).toBe(PDF_SHA256);

  const graph = await startFakeGraph();
  const engine = new PlaywrightEngineHost({
    distDir: '.cache/engine-host-dist',
    modelsDir: '.models',
    log: (text, detail) => console.log(text, detail ?? ''),
  });
  const server: Server = createServer();
  try {
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const site = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const store = new MemoryPilotStore();
    const objects = new MemoryObjectStore();
    const bot = new MemoryBotStore();
    server.on(
      'request',
      createStaticHandler(
        resolve('dist'),
        createPilotHandler({
          clientId: 'pilot-model-whatsapp',
          allowedEmailDomain: 'iitgn.ac.in',
          origin: site,
          keys: staticKeySource({}),
          store,
          objects,
          quotaBytes: QUOTA,
          whatsapp: { verifyToken: VERIFY_TOKEN, appSecret: APP_SECRET, bot },
        }),
      ),
    );
    const client = createGraphClient({
      accessToken: ACCESS_TOKEN,
      phoneNumberId: PHONE_NUMBER_ID,
      baseUrl: graph.base,
    });
    const conversation = createWhatsAppConversation({
      bot,
      store,
      objects,
      graph: client,
      engine,
      origin: site,
      privacyUrl: `${site}/#/privacy`,
      contactEmail: 'recall-team@example.test',
      noticeVersion: 'model-e2e',
    });
    const worker = createWhatsAppIngest({
      bot,
      store,
      objects,
      graph: client,
      quotaBytes: QUOTA,
      ...conversation.hooks,
      onIndexJob: createWhatsAppIndexer({ store, objects, engine, quotaBytes: QUOTA }),
    });
    const send = async (messages: Record<string, unknown>[]) => {
      const body = JSON.stringify(delivery(messages));
      const res = await fetch(`${site}/api/v1/whatsapp/webhook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body) },
        body,
      });
      expect(res.status).toBe(200);
      await worker.drain();
      await conversation.flush();
    };
    const text = (body: string) => message('text', { body });

    await send([text('hi')]);
    await send([text('AGREE')]);
    graph.addMedia('w8-pdf', pdf, 'application/pdf');
    const imageUrl = graph.addMedia('w8-image', image, 'image/jpeg');
    const pdfMessage = message('document', {
      id: 'w8-pdf',
      mime_type: 'application/pdf',
      sha256: sha256Hex(pdf),
      filename: 'sample-03.pdf',
      caption: PDF_TITLE,
    });
    const imageMessage = message('image', {
      id: 'w8-image',
      mime_type: 'image/jpeg',
      sha256: sha256Base64(image),
      url: imageUrl,
      caption: IMAGE_TITLE,
    });
    await send([pdfMessage, imageMessage]);
    const pdfId = globalIdFor(pdfMessage.id);
    const imageId = globalIdFor(imageMessage.id);
    for (const id of [pdfId, imageId])
      expect((await store.getItem(`wa:${BSUID_A}`, id))?.index).toBeTruthy();

    /** The bot's answer to a typed search: its rows, best first. */
    const botSearch = async (query: string) => {
      const before = graph.messagesTo(BSUID_A).length;
      await send([text(query)]);
      const [reply] = graph.messagesTo(BSUID_A).slice(before);
      expect(reply.type).toBe('interactive');
      const rows = (reply.interactive as { action: { sections: { rows: { id: string }[] }[] } })
        .action.sections[0].rows;
      return rows.map((row) => parseRowId(row.id)!);
    };
    const botPdf = await botSearch(PDF_QUERY);
    const botImage = await botSearch(IMAGE_QUERY);
    expect(botPdf[0]).toEqual({ globalId: pdfId, location: { kind: 'page', page: 2 } });
    expect(botImage[0]).toEqual({ globalId: imageId, location: { kind: 'whole' } });

    // The app: open the bot's link, then search the synced WhatsApp vault locally.
    await send([text('OPEN')]);
    const link = /(http:\/\/127\.0\.0\.1:\d+\/api\/v1\/whatsapp\/open\/[A-Za-z0-9_-]{43})/.exec(
      (graph.messagesTo(BSUID_A).at(-1)!.text as { body: string }).body,
    )![1];
    const context = await browser.newContext();
    const page = await context.newPage();
    const external = await prepareApp(context, page, site);
    await page.goto(link);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect.poll(() => page.url()).toBe(`${site}/#/settings`);
    const sync = page.getByRole('region', { name: 'Auto-sync' });
    const listed = sync.getByRole('list', { name: 'In your cloud library' });
    await expect(listed).toContainText(PDF_TITLE);
    await expect(listed).toContainText(IMAGE_TITLE);
    await page.goto(`${site}/#/library`);

    /** The app's top result for a query: its cloud item ID and visible text. */
    const appSearch = async (query: string, expectTitle: string) => {
      const input = page.getByRole('textbox', { name: 'Search saved information' });
      await input.fill(query);
      await input.press('Enter');
      const results = page.locator('[data-cloud-item-id]');
      await expect(results.filter({ hasText: expectTitle })).toHaveCount(1, { timeout: 180_000 });
      const top = results.first();
      return { id: await top.getAttribute('data-cloud-item-id'), text: await top.innerText() };
    };
    const appPdf = await appSearch(PDF_QUERY, PDF_TITLE);
    expect(appPdf.id).toBe(botPdf[0].globalId);
    expect(appPdf.text).toContain('Page 2');
    const appImage = await appSearch(IMAGE_QUERY, IMAGE_TITLE);
    expect(appImage.id).toBe(botImage[0].globalId);
    expect(appImage.text).not.toMatch(/Page \d/);
    expect(external).toEqual([]);
    expect(engine.blockedRequests).toEqual([]);
    await context.close();

    const report = { bot: { pdf: botPdf, image: botImage }, app: { pdf: appPdf, image: appImage } };
    await testInfo.attach('whatsapp-search-report', {
      body: JSON.stringify(report, null, 2),
      contentType: 'application/json',
    });
    console.log('WHATSAPP SEARCH REPORT', JSON.stringify(report));
  } finally {
    await engine.close();
    await new Promise<void>((done) => server.close(() => done()));
    await graph.close();
  }
});
