/// <reference types="node" />
// T6 in a real browser: a student signs in to the app (development sign-in, standing in for
// Google), taps the Telegram bot's login link, presses Continue, and what they then send the bot
// is listed in the app for that account once they include the device's library (P02: nothing is
// uploaded before that). Then the bot's "Open in app" link opens the app as that same account. The
// spec runs its own pilot server in process on the same built app, with the stand-in Bot API and
// the bot's real worker and conversation; nothing calls Telegram or Google.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { createPilotHandler } from '../server/app';
import { MemoryObjectStore, MemoryPilotStore } from '../server/memory';
import { createStaticHandler } from '../server/static';
import { createTelegramApi } from '../server/telegram/api';
import { announceTelegramLink, createTelegramBot } from '../server/telegram/bot';
import { createTelegramIntake } from '../server/telegram/intake';
import { MemoryTelegramStore } from '../server/telegram/store';
import { staticKeySource } from '../server/tokens';
import { MemoryBotStore } from '../server/whatsapp/store';
import {
  BOT_TOKEN,
  CLIENT_ID,
  ID_KEY,
  ID_KEY_ID,
  USER_A,
  signIdToken,
  startFakeTelegram,
  textUpdate,
} from '../tests/telegram-helpers';

const EMAIL = 'student.a@iitgn.ac.in';
let server: Server;
let site = '';
let tg: Awaited<ReturnType<typeof startFakeTelegram>>;
let send: (update: Record<string, unknown>) => Promise<void>;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  tg = await startFakeTelegram();
  const store = new MemoryPilotStore();
  const objects = new MemoryObjectStore();
  const bot = new MemoryBotStore();
  const state = new MemoryTelegramStore();
  const api = createTelegramApi({ token: BOT_TOKEN, baseUrl: tg.base, minIntervalMs: 0 });
  server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  site = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const handler = createPilotHandler({
    clientId: CLIENT_ID,
    allowedEmailDomain: 'iitgn.ac.in',
    origin: site,
    keys: staticKeySource({ [ID_KEY_ID]: ID_KEY.publicKey }),
    store,
    objects,
    quotaBytes: 50_000_000,
    // Development sign-in in the app, as on the local e2e server.
    devSigner: (email) => signIdToken(email),
    limits: { signInBurst: 1000 },
    telegram: {
      bot,
      state,
      noticeVersion: 'e2e',
      privacyUrl: `${site}/#/privacy`,
      onLinked: (linked) => announceTelegramLink(api, linked),
    },
  });
  server.on('request', createStaticHandler(resolve('dist'), handler));
  // No engine host: the item is listed through the cloud catalogue, which is what T6 needs.
  const telegram = createTelegramBot({
    bot,
    state,
    store,
    objects,
    api,
    quotaBytes: 50_000_000,
    origin: site,
    privacyUrl: `${site}/#/privacy`,
    contactEmail: 'recall-team@example.test',
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

/** Records writes to the cloud library and any request leaving the pilot origin. */
function watch(page: Page) {
  const writes: string[] = [];
  const outside: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith(site)) outside.push(request.url());
    if (/\/api\/v1\/(items|uploads)/.test(request.url()) && request.method() !== 'GET')
      writes.push(`${request.method()} ${request.url()}`);
  });
  return { writes, outside };
}

test('a signed-in student links Telegram, and what they send the bot is listed in the app', async ({
  page,
}) => {
  // The device has its own item, which must stay on the device until the student includes it.
  const { writes, outside } = watch(page);
  await page.goto(`${site}/#/library`);
  await page.getByRole('button', { name: 'Open my library' }).click();
  await page.goto(`${site}/#/add`);
  await page.getByRole('tab', { name: 'Note' }).click();
  await page.getByLabel(/^Title/).fill('Device only note');
  await page.getByLabel('Note', { exact: true }).fill('This stays on this device.');
  await page.getByRole('button', { name: 'Save locally' }).click();
  await expect(page.getByRole('status')).toContainText('Saved locally');

  // Development sign-in in the app, standing in for Google.
  await page.goto(`${site}/#/settings`);
  const sync = page.getByRole('region', { name: 'Auto-sync' });
  await sync.getByRole('button', { name: 'Set up Auto-sync' }).click();
  await sync.getByLabel('IITGN email').fill(EMAIL);
  await sync.getByRole('button', { name: 'Sign in (development)' }).click();
  await expect(sync).toContainText(`Signed in as ${EMAIL}`);

  // Before login the bot stores nothing.
  await send(textUpdate('note Sent before login'));
  expect(tg.textsTo(USER_A.id).at(-1)).toBe('Log in first with /login.');

  await send(textUpdate('/start'));
  const button = tg.to(USER_A.id).at(-1)!.replyMarkup!.inline_keyboard[0][0];
  expect(button.text).toBe('Log in with IITGN');
  const link = button.url!;
  expect(link).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/api\/v1\/telegram\/link\/[A-Za-z0-9_-]{43}$/);

  // The link page names both sides and links only on Continue.
  await page.goto(link);
  await expect(page.getByRole('heading', { name: 'Link Telegram to Campus Recall' })).toBeVisible();
  await expect(page.getByText(`Link Telegram @${USER_A.username} to ${EMAIL}?`)).toBeVisible();
  await expect(page.getByText('not end-to-end encrypted')).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Telegram is linked' })).toBeVisible();
  await expect
    .poll(() => tg.textsTo(USER_A.id).at(-1))
    .toBe(
      'Linked to s•••a@iitgn.ac.in. Forward or send files to save them; type anything to search.',
    );
  // The used login button is removed from the chat.
  await expect.poll(() => tg.state.removed.length).toBe(1);

  await send(textUpdate('note Hostel guest pass rules from Telegram'));
  expect(tg.textsTo(USER_A.id).at(-1)).toBe(
    'Saved to Campus Recall: Hostel guest pass rules from Telegram',
  );

  // The app: the same account, which behaves as after Google sign-in. Nothing is uploaded until
  // the student includes the device's library; then the Telegram item is listed.
  await page.goto(`${site}/#/settings`);
  const open = page.getByRole('button', { name: 'Open my library' });
  if (await open.isVisible()) await open.click();
  await expect(sync).toContainText(`Signed in as ${EMAIL}`);
  const include = sync.getByRole('button', { name: "Include this device's library" });
  await expect(include).toBeVisible();
  await page.waitForTimeout(1500);
  expect(writes).toEqual([]);
  await include.click();
  await expect(sync.getByRole('list', { name: 'In your cloud library' })).toContainText(
    'Hostel guest pass rules from Telegram',
  );
  await expect(sync).not.toContainText('Sent before login');
  // Including uploaded the device's own note, as the student chose.
  await expect.poll(() => writes.length).toBeGreaterThan(0);
  expect(outside).toEqual([]);

  // The link was used up: opening it again shows the error page and links nothing.
  await page.goto(link);
  await expect(
    page.getByRole('heading', { name: "This link doesn't work any more" }),
  ).toBeVisible();
});

test('an Open in app link opens the app as the linked account without uploading the device library', async ({
  page,
}) => {
  const { writes, outside } = watch(page);
  await send(textUpdate('/open'));
  const button = tg.to(USER_A.id).at(-1)!.replyMarkup!.inline_keyboard[0][0];
  expect(button.text).toBe('Open in app');
  const link = button.url!;
  expect(link).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/api\/v1\/telegram\/open\/[A-Za-z0-9_-]{43}$/);

  await page.goto(`${site}/#/library`);
  await page.getByRole('button', { name: 'Open my library' }).click();
  await page.goto(`${site}/#/add`);
  await page.getByRole('tab', { name: 'Note' }).click();
  await page.getByLabel(/^Title/).fill('Second device note');
  await page.getByLabel('Note', { exact: true }).fill('This stays on this device.');
  await page.getByRole('button', { name: 'Save locally' }).click();
  await expect(page.getByRole('status')).toContainText('Saved locally');

  // The link shows who will be signed in, and uses nothing up until Continue.
  await page.goto(link);
  await expect(
    page.getByRole('heading', { name: 'Open your Campus Recall library' }),
  ).toBeVisible();
  await expect(page.getByText(EMAIL)).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect.poll(() => page.url()).toBe(`${site}/#/settings`);
  const open = page.getByRole('button', { name: 'Open my library' });
  if (await open.isVisible()) await open.click();
  const sync = page.getByRole('region', { name: 'Auto-sync' });
  await expect(sync).toContainText(`Signed in as ${EMAIL}`);
  await expect(sync.getByRole('button', { name: "Include this device's library" })).toBeVisible();
  await page.waitForTimeout(1500);
  expect(writes).toEqual([]);
  expect(outside).toEqual([]);

  await page.goto(link);
  await expect(
    page.getByRole('heading', { name: "This link doesn't work any more" }),
  ).toBeVisible();
});
