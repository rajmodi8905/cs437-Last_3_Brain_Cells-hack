/// <reference types="node" />
// W6 in a real browser: a student asks the bot for a link, opens it, presses Continue, and the
// app shows the WhatsApp account with its item listed, without including the device library
// (P02). The shared e2e servers do not run the WhatsApp channel yet (settings come with #58), so
// this spec runs its own pilot server in process on the same built app, with the stand-in Graph
// API and the bot's real worker and conversation.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { createPilotHandler } from '../server/app';
import { MemoryObjectStore, MemoryPilotStore } from '../server/memory';
import { createStaticHandler } from '../server/static';
import { staticKeySource } from '../server/tokens';
import { createWhatsAppConversation } from '../server/whatsapp/conversation';
import { createGraphClient } from '../server/whatsapp/graph';
import { createWhatsAppIngest } from '../server/whatsapp/ingest';
import { MemoryBotStore } from '../server/whatsapp/store';
import {
  ACCESS_TOKEN,
  APP_SECRET,
  BSUID_A,
  PHONE_A,
  PHONE_NUMBER_ID,
  VERIFY_TOKEN,
  delivery,
  message,
  sign,
  startFakeGraph,
} from '../tests/whatsapp-helpers';

let server: Server;
let site = '';
let graph: Awaited<ReturnType<typeof startFakeGraph>>;
let send: (body: string) => Promise<void>;

test.beforeAll(async () => {
  graph = await startFakeGraph();
  const store = new MemoryPilotStore();
  const objects = new MemoryObjectStore();
  const bot = new MemoryBotStore();
  server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  site = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const api = createPilotHandler({
    clientId: 'pilot-e2e-whatsapp',
    allowedEmailDomain: 'iitgn.ac.in',
    origin: site,
    keys: staticKeySource({}),
    store,
    objects,
    quotaBytes: 50_000_000,
    whatsapp: {
      verifyToken: VERIFY_TOKEN,
      appSecret: APP_SECRET,
      bot,
      phoneNumberId: PHONE_NUMBER_ID,
    },
  });
  server.on('request', createStaticHandler(resolve('dist'), api));
  const client = createGraphClient({
    accessToken: ACCESS_TOKEN,
    phoneNumberId: PHONE_NUMBER_ID,
    baseUrl: graph.base,
  });
  // No engine host: the item is listed through the cloud catalogue, which is what W6 needs.
  const conversation = createWhatsAppConversation({
    bot,
    store,
    objects,
    graph: client,
    origin: site,
    privacyUrl: `${site}/#/privacy`,
    contactEmail: 'recall-team@example.test',
    noticeVersion: 'e2e',
  });
  const worker = createWhatsAppIngest({
    bot,
    store,
    objects,
    graph: client,
    quotaBytes: 50_000_000,
    ...conversation.hooks,
  });
  send = async (body: string) => {
    const payload = JSON.stringify(delivery([message('text', { body })]));
    const res = await fetch(`${site}/api/v1/whatsapp/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(payload) },
      body: payload,
    });
    expect(res.status).toBe(200);
    await worker.drain();
    await conversation.flush();
  };
});

test.afterAll(async () => {
  await new Promise<void>((done) => server?.close(() => done()));
  await graph?.close();
});

test('a WhatsApp link opens the app as that account and lists its item without uploading the device library', async ({
  page,
}) => {
  await send('hi');
  await send('AGREE');
  await send('note Hostel guest pass rules from WhatsApp');
  await send('OPEN');
  const texts = graph.textsTo(BSUID_A);
  const link = /(http:\/\/127\.0\.0\.1:\d+\/api\/v1\/whatsapp\/open\/[A-Za-z0-9_-]{43})/.exec(
    texts.at(-1)!,
  )![1];

  // The device has its own item, which must stay on the device.
  const writes: string[] = [];
  const outside: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith(site)) outside.push(request.url());
    if (/\/api\/v1\/(items|uploads)/.test(request.url()) && request.method() !== 'GET')
      writes.push(`${request.method()} ${request.url()}`);
  });
  await page.goto(`${site}/#/library`);
  await page.getByRole('button', { name: 'Open my library' }).click();
  await page.goto(`${site}/#/add`);
  await page.getByRole('tab', { name: 'Note' }).click();
  await page.getByLabel(/^Title/).fill('Device only note');
  await page.getByLabel('Note', { exact: true }).fill('This stays on this device.');
  await page.getByRole('button', { name: 'Save locally' }).click();
  await expect(page.getByRole('status')).toContainText('Saved locally');

  // The link shows who will be signed in, and uses nothing up until Continue.
  await page.goto(link);
  await expect(page.getByRole('heading', { name: 'Open your WhatsApp library' })).toBeVisible();
  await expect(page.getByText(`WhatsApp ••••${PHONE_A.slice(-4)}`)).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect.poll(() => page.url()).toBe(`${site}/#/settings`);
  const open = page.getByRole('button', { name: 'Open my library' });
  if (await open.isVisible()) await open.click();
  const sync = page.getByRole('region', { name: 'Auto-sync' });
  await expect(sync).toContainText(`Signed in as WhatsApp ••••${PHONE_A.slice(-4)}`);
  await expect(sync.getByRole('button', { name: "Include this device's library" })).toBeVisible();
  await expect(sync.getByRole('list', { name: 'In your cloud library' })).toContainText(
    'Hostel guest pass rules from WhatsApp',
  );
  await page.waitForTimeout(1500);
  expect(writes).toEqual([]);
  expect(outside).toEqual([]);

  // The link was used up: opening it again shows the error page and opens nothing.
  await page.goto(link);
  await expect(
    page.getByRole('heading', { name: "This link doesn't work any more" }),
  ).toBeVisible();
});
