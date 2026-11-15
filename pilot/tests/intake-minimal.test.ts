/// <reference types="node" />
// Issue #68 (T1, W1): a message from someone who has not linked or agreed is stored as its key and
// type only, at the moment the webhook records it, with no worker running. A linked or consenting
// sender's messages are still stored in full, and the commands the login or consent gate answers
// survive as their command word.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createTelegramIntake } from '../server/telegram/intake';
import { messageKey } from '../server/telegram/store';
import { commandOf } from '../server/whatsapp/conversation';
import { MemoryBotStore } from '../server/whatsapp/store';
import { createWhatsAppWebhook } from '../server/whatsapp/webhook';
import {
  APP_SECRET,
  PHONE_NUMBER_ID,
  VERIFY_TOKEN,
  delivery,
  message,
  sign,
} from './whatsapp-helpers';
import {
  USER_A,
  callbackUpdate,
  forwardedUpdate,
  photoUpdate,
  textUpdate,
} from './telegram-helpers';

const keyOf = (update: Record<string, unknown>) => messageKey(update.message as never);

describe('T1 an unlinked Telegram user is stored as a key and a type only', () => {
  it('keeps no text, caption, file or forward of an unlinked sender, without a worker', async () => {
    const bot = new MemoryBotStore();
    const intake = createTelegramIntake({ bot });
    const updates = [
      textUpdate('private text'),
      forwardedUpdate('Hostel curfew is 11 pm'),
      textUpdate('note Mess timings 8 to 10'),
      photoUpdate([{ fileId: 'p-1', size: 10, width: 8, height: 8 }], USER_A, 'secret caption'),
    ];
    for (const update of updates) expect(await intake(update)).toBe(true);
    for (const update of updates) {
      const kept = await bot.getInbound(keyOf(update));
      expect(kept?.message).toEqual({ id: keyOf(update), type: 'message' });
    }
  });

  it('keeps the command word and first name the login gate needs, and nothing after it', async () => {
    const bot = new MemoryBotStore();
    const intake = createTelegramIntake({ bot });
    const start = textUpdate('/start secret-argument');
    await intake(start);
    const kept = (await bot.getInbound(keyOf(start)))!.message as unknown as {
      message: { text: string; from: { first_name?: string } };
    };
    expect(kept.message.text).toBe('/start');
    expect(kept.message.from.first_name).toBe(USER_A.first_name);
    expect(JSON.stringify(kept)).not.toContain('secret-argument');
  });

  it('keeps no data of an unlinked sender’s button tap except the delete button', async () => {
    const bot = new MemoryBotStore();
    const intake = createTelegramIntake({ bot });
    const pick = callbackUpdate('pick:abc123');
    await intake(pick);
    const kept = await bot.getInbound(`c:${(pick.callback_query as { id: string }).id}`);
    expect(JSON.stringify(kept?.message)).not.toContain('abc123');
  });

  it('stores a linked sender’s message in full, and a stopped one’s only as a key and type', async () => {
    const bot = new MemoryBotStore();
    const intake = createTelegramIntake({ bot });
    await bot.recordInbound(
      { userId: String(USER_A.id), ownerKey: `tg:${USER_A.id}` },
      {
        wamid: 'seed',
        senderId: String(USER_A.id),
        ownerKey: `tg:${USER_A.id}`,
        receivedAt: 1,
        message: { id: 'seed' },
      },
    );
    await bot.setConsent(String(USER_A.id), 2, 'v1');
    const linked = textUpdate('note kept in full');
    await intake(linked);
    expect(JSON.stringify((await bot.getInbound(keyOf(linked)))?.message)).toContain(
      'note kept in full',
    );
    await bot.setStopped(String(USER_A.id), 3);
    const stopped = textUpdate('after stop');
    await intake(stopped);
    expect((await bot.getInbound(keyOf(stopped)))?.message).toEqual({
      id: keyOf(stopped),
      type: 'message',
    });
  });
});

describe('W1 a WhatsApp sender who has not agreed is stored as a key and a type only', () => {
  let server: Server | undefined;
  afterEach(
    () => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())),
  );

  async function start(bot: MemoryBotStore) {
    const webhook = createWhatsAppWebhook({
      bot,
      appSecret: APP_SECRET,
      verifyToken: VERIFY_TOKEN,
      phoneNumberId: PHONE_NUMBER_ID,
      consentRequired: true,
    });
    server = createServer((req, res) => void webhook(req, res, new URL(req.url!, 'http://x')));
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return async (...messages: Record<string, unknown>[]) => {
      const body = JSON.stringify(delivery(messages));
      const res = await fetch(base, {
        method: 'POST',
        headers: { 'x-hub-signature-256': sign(body), 'content-type': 'application/json' },
        body,
      });
      expect(res.status).toBe(200);
    };
  }
  const idOf = (m: Record<string, unknown>) => m.id as string;

  it('keeps no text or media before AGREE, without a worker, but keeps the command word', async () => {
    const bot = new MemoryBotStore();
    const post = await start(bot);
    const text = message('text', { body: 'private text' });
    const image = message('image', { id: 'media-1', mime_type: 'image/jpeg', caption: 'secret' });
    const agree = message('text', { body: ' agree. ' });
    await post(text, image, agree);
    expect((await bot.getInbound(idOf(text)))?.message).toEqual({ id: idOf(text), type: 'text' });
    expect((await bot.getInbound(idOf(image)))?.message).toEqual({
      id: idOf(image),
      type: 'image',
    });
    const kept = (await bot.getInbound(idOf(agree)))!.message;
    expect(commandOf(kept)).toBe('AGREE');
  });

  it('stores a message in full once the sender has agreed, and not after STOP', async () => {
    const bot = new MemoryBotStore();
    const post = await start(bot);
    const first = message('text', { body: 'hello' });
    await post(first);
    const sender = (await bot.getInbound(idOf(first)))!.senderId;
    await bot.setConsent(sender, 5, 'v1');
    const saved = message('text', { body: 'note to keep' });
    await post(saved);
    expect((await bot.getInbound(idOf(saved)))?.message.text?.body).toBe('note to keep');
    await bot.setStopped(sender, 6);
    const after = message('text', { body: 'after stop' });
    await post(after);
    expect((await bot.getInbound(idOf(after)))?.message).toEqual({ id: idOf(after), type: 'text' });
  });
});
