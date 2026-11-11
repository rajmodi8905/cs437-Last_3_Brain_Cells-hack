/// <reference types="node" />
// T8 with the real engine and pinned models: a student links the Telegram bot to their account
// (development sign-in standing in for Google), sends the fixture PDF and photo, the server indexes
// them with the engine host into that account, and for the queries of engine-host.spec.ts the
// bot's top result is the same item and location that the app's own search returns for the same
// account, opened in the app from the bot's link. The pilot server runs in process with the
// stand-in Bot API; nothing calls Telegram or Google.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { createPilotHandler } from '../server/app';
import { MemoryObjectStore, MemoryPilotStore } from '../server/memory';
import { createStaticHandler } from '../server/static';
import { createTelegramApi } from '../server/telegram/api';
import {
  announceTelegramLink,
  createTelegramBot,
  createTelegramIndexer,
} from '../server/telegram/bot';
import { createTelegramIntake } from '../server/telegram/intake';
import { MemoryTelegramStore, telegramGlobalId } from '../server/telegram/store';
import { staticKeySource } from '../server/tokens';
import { PlaywrightEngineHost } from '../server/whatsapp/engine-host';
import { MemoryBotStore } from '../server/whatsapp/store';
import {
  BOT_TOKEN,
  CLIENT_ID,
  ID_KEY,
  ID_KEY_ID,
  USER_A,
  documentUpdate,
  ownerOf,
  signIdToken,
  startFakeTelegram,
  textUpdate,
} from '../tests/telegram-helpers';

// The files, titles and queries of engine-host.spec.ts (corpus targets R3 and R1).
const PDF = 'tests/fixtures/sample-03.pdf';
const PDF_SHA256 = '5b124fb2928e9db137ff87b77d6351100f828b9853059733f39e61bab3480374';
const PDF_TITLE = 'Synced synthetic document';
const PDF_QUERY = 'How many classmates can work together for CS437?';
const IMAGE = 'tests/fixtures/sample-01.jpg';
const IMAGE_TITLE = 'Notice board photo';
const IMAGE_QUERY = 'Find the badminton team registration announcement';
const QUOTA = 200_000_000;
const EMAIL = 'student.a@iitgn.ac.in';
const OWNER = ownerOf(EMAIL);

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

test("T8: the Telegram bot's top result is the item and location the app's own search returns", async ({
  browser,
}, testInfo) => {
  test.setTimeout(1_200_000);
  const pdf = new Uint8Array(await readFile(PDF));
  const image = new Uint8Array(await readFile(IMAGE));
  expect(createHash('sha256').update(pdf).digest('hex')).toBe(PDF_SHA256);

  const tg = await startFakeTelegram();
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
    const state = new MemoryTelegramStore();
    const api = createTelegramApi({ token: BOT_TOKEN, baseUrl: tg.base, minIntervalMs: 0 });
    const notices: Promise<unknown>[] = [];
    server.on(
      'request',
      createStaticHandler(
        resolve('dist'),
        createPilotHandler({
          clientId: CLIENT_ID,
          allowedEmailDomain: 'iitgn.ac.in',
          origin: site,
          keys: staticKeySource({ [ID_KEY_ID]: ID_KEY.publicKey }),
          store,
          objects,
          quotaBytes: QUOTA,
          devSigner: (email) => signIdToken(email),
          telegram: {
            bot,
            state,
            noticeVersion: 'model-e2e',
            onLinked: (linked) => notices.push(announceTelegramLink(api, linked)),
          },
        }),
      ),
    );
    const telegram = createTelegramBot({
      bot,
      state,
      store,
      objects,
      api,
      quotaBytes: QUOTA,
      engine,
      onIndexJob: createTelegramIndexer({ store, objects, engine, quotaBytes: QUOTA }),
      origin: site,
      privacyUrl: `${site}/#/privacy`,
      contactEmail: 'recall-team@example.test',
    });
    const intake = createTelegramIntake({ bot });
    const send = async (...updates: Record<string, unknown>[]) => {
      for (const update of updates) expect(await intake(update)).toBe(true);
      await telegram.drain();
      await telegram.flush();
    };
    const keyOf = (update: Record<string, unknown>) => {
      const message = update.message as { message_id: number; chat: { id: number } };
      return `m:${message.chat.id}:${message.message_id}`;
    };

    // Link the chat to the account: the bot's login link, the account's own sign-in, Continue.
    await send(textUpdate('/start'));
    const login = tg.to(USER_A.id).at(-1)!.replyMarkup!.inline_keyboard[0][0].url!;
    const signedIn = await fetch(`${site}/api/v1/session`, {
      method: 'POST',
      headers: { origin: site, 'content-type': 'application/json' },
      body: JSON.stringify({ idToken: signIdToken(EMAIL) }),
    });
    expect(signedIn.status).toBe(200);
    const cookie = /recall_session=([^;]+)/.exec(signedIn.headers.get('set-cookie') ?? '')![1];
    const linked = await fetch(login, {
      method: 'POST',
      headers: {
        origin: site,
        cookie: `recall_session=${cookie}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: '',
    });
    expect(linked.status).toBe(200);
    await Promise.all(notices);
    tg.addFile('t8-pdf', pdf);
    tg.addFile('t8-image', image);
    // The PDF as a file and the photo as a file, which keeps the original bytes.
    const pdfUpdate = documentUpdate(
      {
        fileId: 't8-pdf',
        size: pdf.length,
        mimeType: 'application/pdf',
        fileName: 'sample-03.pdf',
      },
      USER_A,
      PDF_TITLE,
    );
    const imageUpdate = documentUpdate(
      { fileId: 't8-image', size: image.length, mimeType: 'image/jpeg', fileName: 'sample-01.jpg' },
      USER_A,
      IMAGE_TITLE,
    );
    await send(pdfUpdate, imageUpdate);
    const pdfId = telegramGlobalId(keyOf(pdfUpdate));
    const imageId = telegramGlobalId(keyOf(imageUpdate));
    for (const id of [pdfId, imageId]) expect((await store.getItem(OWNER, id))?.index).toBeTruthy();

    /** The bot's answer to a typed search: its rows' item and place, best first. */
    const botSearch = async (query: string) => {
      const before = tg.to(USER_A.id).length;
      await send(textUpdate(query));
      const [reply] = tg.to(USER_A.id).slice(before);
      const buttons = reply.replyMarkup?.inline_keyboard ?? [];
      expect(buttons.length).toBeGreaterThan(0);
      const rows = [];
      for (const [button] of buttons) {
        const found = await state.getPick(button.callback_data!.slice(2), 0);
        rows.push({ globalId: found!.globalId, location: found!.location });
      }
      return rows;
    };
    const botPdf = await botSearch(PDF_QUERY);
    const botImage = await botSearch(IMAGE_QUERY);
    expect(botPdf[0]).toEqual({ globalId: pdfId, location: { kind: 'page', page: 2 } });
    expect(botImage[0]).toEqual({ globalId: imageId, location: { kind: 'whole' } });

    // The app: open the bot's link (the same account, as after its sign-in), include this
    // device (it has nothing of its own), then search the synced account locally.
    await send(textUpdate('/open'));
    const link = tg.to(USER_A.id).at(-1)!.replyMarkup!.inline_keyboard[0][0].url!;
    expect(link).toMatch(/\/api\/v1\/telegram\/open\/[A-Za-z0-9_-]{43}$/);
    const context = await browser.newContext();
    const page = await context.newPage();
    const external = await prepareApp(context, page, site);
    await page.goto(link);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect.poll(() => page.url()).toBe(`${site}/#/settings`);
    const sync = page.getByRole('region', { name: 'Auto-sync' });
    await expect(sync).toContainText(`Signed in as ${EMAIL}`);
    await sync.getByRole('button', { name: "Include this device's library" }).click();
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
    await testInfo.attach('telegram-search-report', {
      body: JSON.stringify(report, null, 2),
      contentType: 'application/json',
    });
    console.log('TELEGRAM SEARCH REPORT', JSON.stringify(report));
  } finally {
    await engine.close();
    await new Promise<void>((done) => server.close(() => done()));
    await tg.close();
  }
});
