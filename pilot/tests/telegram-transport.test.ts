/// <reference types="node" />
// The Telegram channel's transports and Bot API client against the stand-in Bot API: long polling
// with a stored offset across a restart, the webhook mode's setWebhook, spacing replies to one
// chat, waiting out HTTP 429, the 20 MB download limit, and the bot token never appearing in an
// error or a log line.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryObjectStore, MemoryPilotStore } from '../server/memory';
import { TelegramError, createTelegramApi } from '../server/telegram/api';
import { TELEGRAM_REPLIES, createTelegramBot, refuseTelegramUser } from '../server/telegram/bot';
import { createTelegramIntake } from '../server/telegram/intake';
import { planTelegramMessage } from '../server/telegram/plan';
import {
  createTelegramPoller,
  describeFailure,
  startTelegramPolling,
} from '../server/telegram/poller';
import { MemoryTelegramStore, telegramSender } from '../server/telegram/store';
import { MediaTooLargeError } from '../server/whatsapp/graph';
import { MemoryBotStore } from '../server/whatsapp/store';
import {
  BOT_TOKEN,
  USER_A,
  forwardedUpdate,
  messageUpdate,
  startFakeTelegram,
  textUpdate,
} from './telegram-helpers';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function fake() {
  const tg = await startFakeTelegram();
  cleanups.push(tg.close);
  return tg;
}
/** The secret part of the token, which must never appear anywhere. */
const SECRET_PART = BOT_TOKEN.split(':')[1];
const leaks = (text: string) => text.includes(SECRET_PART) || text.includes(BOT_TOKEN);
const everything = (error: unknown) =>
  error instanceof Error
    ? `${error.name} ${error.message} ${error.stack} ${JSON.stringify(error)} ${String((error as { cause?: unknown }).cause)}`
    : String(error);

describe('Telegram long polling', () => {
  it('stores the next offset, so a restarted poller neither repeats nor loses updates', async () => {
    const tg = await fake();
    const api = createTelegramApi({ token: BOT_TOKEN, baseUrl: tg.base, minIntervalMs: 0 });
    const bot = new MemoryBotStore();
    const state = new MemoryTelegramStore();
    const intake = createTelegramIntake({ bot });
    const first = [textUpdate('one'), textUpdate('two')];
    tg.state.updates.push(...first);
    let woken = 0;
    const poller = createTelegramPoller({ api, state, intake, onRecorded: () => woken++ });
    expect(await poller.pollOnce()).toBe(2);
    const last = first[1].update_id;
    expect(await state.getOffset()).toBe(last + 1);
    expect(tg.state.offsets).toEqual([undefined]);
    expect(woken).toBe(1);

    // A new process with the same stored state: it asks from the stored offset.
    const later = textUpdate('three');
    tg.state.updates.push(later);
    const restarted = createTelegramPoller({ api, state, intake });
    expect(await restarted.pollOnce()).toBe(1);
    expect(tg.state.offsets).toEqual([undefined, last + 1]);
    expect(await state.getOffset()).toBe(later.update_id + 1);
    // Every message recorded once, with its ingest job.
    for (const update of [...first, later]) {
      const message = update.message as { chat: { id: number }; message_id: number };
      expect(await bot.getInbound(`m:${message.chat.id}:${message.message_id}`)).toBeDefined();
    }
  });

  it('records an update delivered again (a crash before the offset was stored) only once', async () => {
    const tg = await fake();
    const api = createTelegramApi({ token: BOT_TOKEN, baseUrl: tg.base, minIntervalMs: 0 });
    const bot = new MemoryBotStore();
    const intake = createTelegramIntake({ bot });
    const update = textUpdate('again');
    tg.state.updates.push(update);
    // Two pollers whose offsets were never stored see the same update.
    await createTelegramPoller({ api, state: new MemoryTelegramStore(), intake }).pollOnce();
    await createTelegramPoller({ api, state: new MemoryTelegramStore(), intake }).pollOnce();
    let jobs = 0;
    while (await bot.claimJob(['ingest'], Number.MAX_SAFE_INTEGER, 60)) jobs++;
    expect(jobs).toBe(1);
  });

  it('turns webhook delivery off first, keeps going after failures and logs no token', async () => {
    const tg = await fake();
    const api = createTelegramApi({ token: BOT_TOKEN, baseUrl: tg.base, minIntervalMs: 0 });
    const bot = new MemoryBotStore();
    const state = new MemoryTelegramStore();
    tg.state.webhook = { url: 'https://old.example/hook', secret_token: 'x', allowed_updates: [] };
    tg.state.failGetUpdates = 2;
    tg.state.updates.push(textUpdate('hello'));
    const logs: string[] = [];
    const recorded = new Promise<void>((resolve) => {
      const polling = startTelegramPolling({
        api,
        state,
        intake: createTelegramIntake({ bot }),
        onRecorded: resolve,
        retryMs: () => 1,
        log: (message, detail) => logs.push(`${message} ${String(detail)}`),
      });
      cleanups.push(() => polling.stop());
    });
    await recorded;
    expect(tg.state.deleteWebhookCalls).toBe(1);
    expect(tg.state.webhook).toBeUndefined();
    expect(logs).toHaveLength(2);
    expect(logs[0]).toContain('Telegram getUpdates failed with HTTP 502');
    expect(logs.some(leaks)).toBe(false);
  });

  it('stops promptly while a long poll is waiting', async () => {
    // A Bot API that never answers getUpdates, as during a 30-second long poll.
    const hanging: Server = createServer((req, res) => {
      if (req.url?.endsWith('/deleteWebhook'))
        return res.writeHead(200).end(JSON.stringify({ ok: true, result: true }));
    });
    await new Promise<void>((resolve) => hanging.listen(0, '127.0.0.1', resolve));
    cleanups.push(async () => {
      hanging.closeAllConnections();
      await new Promise<void>((resolve) => hanging.close(() => resolve()));
    });
    const api = createTelegramApi({
      token: BOT_TOKEN,
      baseUrl: `http://127.0.0.1:${(hanging.address() as AddressInfo).port}`,
    });
    const polling = startTelegramPolling({
      api,
      state: new MemoryTelegramStore(),
      intake: async () => false,
      log: () => undefined,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const started = Date.now();
    await polling.stop();
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('Telegram webhook mode', () => {
  it('sets the webhook with the secret token and only the update types the bot reads', async () => {
    const tg = await fake();
    const api = createTelegramApi({ token: BOT_TOKEN, baseUrl: tg.base });
    await api.setWebhook({
      url: 'https://recall.example.test/api/v1/telegram/webhook',
      secretToken: 'a-webhook-secret-0123456789',
    });
    expect(tg.state.webhook).toMatchObject({
      url: 'https://recall.example.test/api/v1/telegram/webhook',
      secret_token: 'a-webhook-secret-0123456789',
      allowed_updates: ['message', 'callback_query'],
    });
  });
});

describe('Telegram Bot API client', () => {
  it('spaces messages to one chat at least the interval apart, and not across chats', async () => {
    const tg = await fake();
    let clock = 0;
    const sleeps: number[] = [];
    const api = createTelegramApi({
      token: BOT_TOKEN,
      baseUrl: tg.base,
      minIntervalMs: 1000,
      nowMs: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
    });
    const sentAt: number[] = [];
    await Promise.all(
      [1, 2, 3].map((n) => api.sendMessage(USER_A.id, `m${n}`).then(() => sentAt.push(clock))),
    );
    expect(tg.textsTo(USER_A.id)).toEqual(['m1', 'm2', 'm3']);
    expect(sleeps).toEqual([1000, 1000]);
    expect(sentAt).toEqual([0, 1000, 2000]);
    // Another chat is not held up by the first one's spacing.
    await api.sendMessage(USER_A.id + 1, 'other');
    expect(sleeps).toEqual([1000, 1000]);
  });

  it("waits out Telegram's retry_after on HTTP 429, then sends once", async () => {
    const tg = await fake();
    const sleeps: number[] = [];
    const api = createTelegramApi({
      token: BOT_TOKEN,
      baseUrl: tg.base,
      minIntervalMs: 0,
      sleep: async (ms) => void sleeps.push(ms),
    });
    tg.state.rateLimits.push(3);
    await api.sendMessage(USER_A.id, 'after the wait');
    expect(sleeps).toEqual([3000]);
    expect(tg.textsTo(USER_A.id)).toEqual(['after the wait']);
    tg.state.rateLimits.push(3, 3, 3);
    await expect(api.sendMessage(USER_A.id, 'gives up')).rejects.toMatchObject({
      status: 429,
      retryAfter: 3,
    });
  });

  it('sends a chat action without message spacing, and does not wait out HTTP 429 for it', async () => {
    const tg = await fake();
    const sleeps: number[] = [];
    const api = createTelegramApi({
      token: BOT_TOKEN,
      baseUrl: tg.base,
      minIntervalMs: 1000,
      sleep: async (ms) => void sleeps.push(ms),
    });
    await api.sendMessage(USER_A.id, 'first');
    await api.sendChatAction(USER_A.id, 'typing');
    await api.sendChatAction(USER_A.id, 'typing');
    expect(tg.state.chatActions).toMatchObject([
      { chatId: USER_A.id, action: 'typing' },
      { chatId: USER_A.id, action: 'typing' },
    ]);
    expect(sleeps).toEqual([]);
    tg.state.chatActionRateLimits.push(3);
    await expect(api.sendChatAction(USER_A.id, 'typing')).rejects.toMatchObject({
      status: 429,
      retryAfter: 3,
    });
    expect(sleeps).toEqual([]);
    expect(tg.state.chatActions).toHaveLength(2);
  });

  it('stops a download as soon as it passes the limit', async () => {
    const tg = await fake();
    const api = createTelegramApi({ token: BOT_TOKEN, baseUrl: tg.base });
    tg.addFile('big', new Uint8Array(2048));
    const { filePath } = await api.getFile('big');
    await expect(api.download(filePath!, 1024)).rejects.toBeInstanceOf(MediaTooLargeError);
    expect((await api.download(filePath!, 4096)).length).toBe(2048);
    await expect(api.download('../../etc/passwd', 4096)).rejects.toBeInstanceOf(TelegramError);
  });

  it('never puts the token into an error, whatever fails', async () => {
    const tg = await fake();
    // Telegram refusing the call, an unreachable server, a wrong token and a missing file.
    const failures: unknown[] = [];
    const capture = (promise: Promise<unknown>) =>
      promise.then(
        () => failures.push('no error'),
        (error: unknown) => failures.push(error),
      );
    const api = createTelegramApi({ token: BOT_TOKEN, baseUrl: tg.base, minIntervalMs: 0 });
    tg.state.failSends = 1;
    await capture(api.sendMessage(USER_A.id, 'x'));
    await capture(api.getFile('missing'));
    await capture(api.download('documents/missing.bin', 10));
    const closed = await startFakeTelegram();
    await closed.close();
    const unreachable = createTelegramApi({ token: BOT_TOKEN, baseUrl: closed.base });
    await capture(unreachable.getUpdates({ timeoutSeconds: 0 }));
    await capture(unreachable.download('documents/file_1.bin', 10));
    const wrongToken = createTelegramApi({
      token: `${BOT_TOKEN}x`,
      baseUrl: tg.base,
      minIntervalMs: 0,
    });
    await capture(wrongToken.getMe());
    expect(failures).toHaveLength(6);
    for (const failure of failures) {
      expect(failure).toBeInstanceOf(TelegramError);
      expect(leaks(everything(failure))).toBe(false);
      expect(leaks(describeFailure(failure))).toBe(false);
      expect(everything(failure)).not.toContain(tg.base);
    }
    expect((failures[3] as TelegramError).message).toMatch(/got no answer: a network error/);
  });

  it('logs no token from the bot when replies and downloads fail', async () => {
    const tg = await fake();
    const api = createTelegramApi({ token: BOT_TOKEN, baseUrl: tg.base, minIntervalMs: 0 });
    const bot = new MemoryBotStore();
    const state = new MemoryTelegramStore();
    const logs: string[] = [];
    const telegram = createTelegramBot({
      bot,
      state,
      store: new MemoryPilotStore(),
      objects: new MemoryObjectStore(),
      api,
      quotaBytes: 1_000_000,
      origin: 'https://recall.example.test',
      privacyUrl: 'https://recall.example.test/privacy',
      contactEmail: 'team@example.test',
      log: (message, detail) =>
        logs.push(`${message} ${detail instanceof Error ? everything(detail) : String(detail)}`),
      retryDelaySeconds: () => 0,
    });
    const intake = createTelegramIntake({ bot });
    // Linked to an account directly, so the bot downloads (and fails to).
    await state.linkAccount({
      userId: String(USER_A.id),
      ownerKey: 'google:subject-a',
      email: 'student.a@iitgn.ac.in',
      linkedAt: 1,
    });
    tg.state.failSends = 5;
    await intake(textUpdate('/start'));
    await telegram.drain();
    await intake(textUpdate('/open'));
    await telegram.drain();
    await intake(
      messageUpdate({ document: { file_id: 'gone', mime_type: 'application/pdf', file_size: 10 } }),
    );
    await telegram.drain();
    expect(logs.length).toBeGreaterThan(1);
    expect(logs.some(leaks)).toBe(false);
  });

  it('answers people outside the allowed users without storing anything', async () => {
    const tg = await fake();
    const api = createTelegramApi({ token: BOT_TOKEN, baseUrl: tg.base, minIntervalMs: 0 });
    await refuseTelegramUser(api, { chatId: 42 });
    await refuseTelegramUser(api, { chatId: 42, callbackQueryId: '77' });
    expect(tg.textsTo(42)).toEqual([TELEGRAM_REPLIES.notOpen]);
    expect(tg.state.answered).toEqual([{ id: '77', text: 'Not open yet.' }]);
  });
});

describe('Telegram messages', () => {
  it('reads forwarded messages from forward_origin and from the older forward_date', () => {
    const forwarded = forwardedUpdate('Exam at 9').message as Parameters<
      typeof planTelegramMessage
    >[0];
    expect(planTelegramMessage(forwarded)).toMatchObject({ action: 'save', kind: 'note' });
    const older = messageUpdate({ text: 'Exam at 9', forward_date: 1_762_000_000 })
      .message as Parameters<typeof planTelegramMessage>[0];
    expect(planTelegramMessage(older)).toMatchObject({ action: 'save', kind: 'note' });
    const typed = textUpdate('Exam at 9').message as Parameters<typeof planTelegramMessage>[0];
    expect(planTelegramMessage(typed)).toEqual({ action: 'text', text: 'Exam at 9' });
  });

  it('accepts only numeric user IDs that are not bots', () => {
    expect(telegramSender({ id: 12345, username: 'a_student' })).toEqual({
      userId: '12345',
      ownerKey: 'tg:12345',
      waId: 'a_student',
    });
    for (const user of [
      { id: 0 },
      { id: -5 },
      { id: 1.5 },
      { id: Number.MAX_SAFE_INTEGER + 2 },
      { id: '12' as unknown as number },
      { id: 7, is_bot: true },
    ])
      expect(telegramSender(user)).toBeUndefined();
    // An odd username is not kept for display, but the user is still known by ID.
    expect(telegramSender({ id: 9, username: '<b>x</b>' })).toEqual({
      userId: '9',
      ownerKey: 'tg:9',
    });
  });
});
