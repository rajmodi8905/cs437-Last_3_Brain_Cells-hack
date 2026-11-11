/// <reference types="node" />
// T6 in a real browser: a student asks the Telegram bot for a link, opens it, presses Continue,
// and the app shows the Telegram account with its item listed, without including the device
// library (P02). The spec runs its own pilot server in process on the same built app, with the
// stand-in Bot API and the bot's real worker and conversation; nothing calls Telegram.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { createPilotHandler } from '../server/app';
import { MemoryObjectStore, MemoryPilotStore } from '../server/memory';
import { createStaticHandler } from '../server/static';
import { createTelegramApi } from '../server/telegram/api';
import { createTelegramBot } from '../server/telegram/bot';
import { createTelegramIntake } from '../server/telegram/intake';
import { MemoryTelegramStore } from '../server/telegram/store';
import { staticKeySource } from '../server/tokens';
import { MemoryBotStore } from '../server/whatsapp/store';
import {
  BOT_TOKEN,
  USER_A,
  callbackUpdate,
  startFakeTelegram,
  textUpdate,
} from '../tests/telegram-helpers';

let server: Server;
let site = '';
let tg: Awaited<ReturnType<typeof startFakeTelegram>>;
let send: (update: Record<string, unknown>) => Promise<void>;

test.beforeAll(async () => {
  tg = await startFakeTelegram();
  const store = new MemoryPilotStore();
  const objects = new MemoryObjectStore();
  const bot = new MemoryBotStore();
  server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  site = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const api = createPilotHandler({
    clientId: 'pilot-e2e-telegram',
    allowedEmailDomain: 'iitgn.ac.in',
    origin: site,
    keys: staticKeySource({}),
    store,
    objects,
    quotaBytes: 50_000_000,
    telegram: { bot },
  });
  server.on('request', createStaticHandler(resolve('dist'), api));
  // No engine host: the item is listed through the cloud catalogue, which is what T6 needs.
  const telegram = createTelegramBot({
    bot,
    state: new MemoryTelegramStore(),
    store,
    objects,
    api: createTelegramApi({ token: BOT_TOKEN, baseUrl: tg.base, minIntervalMs: 0 }),
    quotaBytes: 50_000_000,
    origin: site,
    privacyUrl: `${site}/#/privacy`,
    contactEmail: 'recall-team@example.test',
    noticeVersion: 'e2e',
  });
  const intake = createTelegramIntake({ bot });
  send = async (update) => {
    expect(await intake(update)).toBe(true);
    await telegram.drain();
    await telegram.flush();
  };
});

test.afterAll(async () => {
  await new Promise<void>((done) => server?.close(() => done()));
  await tg?.close();
});

test('a Telegram link opens the app as that account and lists its item without uploading the device library', async ({
  page,
}) => {
  await send(textUpdate('/start'));
  await send(callbackUpdate('agree'));
  await send(textUpdate('note Hostel guest pass rules from Telegram'));
  await send(textUpdate('/open'));
  const button = tg.to(USER_A.id).at(-1)!.replyMarkup!.inline_keyboard[0][0];
  expect(button.text).toBe('Open in app');
  const link = button.url!;
  expect(link).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/api\/v1\/telegram\/open\/[A-Za-z0-9_-]{43}$/);

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
  await expect(page.getByRole('heading', { name: 'Open your Telegram library' })).toBeVisible();
  await expect(page.getByText(`Telegram @${USER_A.username}`)).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect.poll(() => page.url()).toBe(`${site}/#/settings`);
  const open = page.getByRole('button', { name: 'Open my library' });
  if (await open.isVisible()) await open.click();
  const sync = page.getByRole('region', { name: 'Auto-sync' });
  await expect(sync).toContainText(`Signed in as Telegram @${USER_A.username}`);
  await expect(sync.getByRole('button', { name: "Include this device's library" })).toBeVisible();
  await expect(sync.getByRole('list', { name: 'In your cloud library' })).toContainText(
    'Hostel guest pass rules from Telegram',
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
