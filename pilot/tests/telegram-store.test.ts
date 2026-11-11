/// <reference types="node" />
// The Telegram channel's storage: the shared BotStore on Telegram's own tables, kept apart from
// WhatsApp's, the polling offset and result buttons, and backups. PostgreSQL runs with
// npm run test:pilot:storage; otherwise it is reported as skipped, never as passed.
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { backupDatabase, restoreDatabase } from '../server/backup';
import { MemoryObjectStore } from '../server/memory';
import { BACKUP_TABLES, PostgresPilotStore } from '../server/postgres';
import { PostgresTelegramStore } from '../server/telegram/postgres';
import {
  MemoryTelegramStore,
  TELEGRAM_TABLES,
  type ResultPick,
  type TelegramStateStore,
} from '../server/telegram/store';
import { PostgresBotStore } from '../server/whatsapp/postgres';
import type { InboundMessage, WhatsAppSender } from '../server/whatsapp/store';

const DATABASE = process.env.PILOT_TEST_DATABASE_URL;
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function postgres(schema = `test_${randomUUID().replaceAll('-', '')}`) {
  const pilot = await PostgresPilotStore.open({ connectionString: DATABASE!, schema });
  cleanups.push(async () => {
    await pilot.dropSchemaForTests();
    await pilot.close();
  });
  return pilot;
}

const user: WhatsAppSender = { userId: '700000001', ownerKey: 'tg:700000001', waId: 'student_a' };
const inbound = (key: string, receivedAt = 100): InboundMessage => ({
  wamid: key,
  senderId: user.userId,
  ownerKey: user.ownerKey,
  receivedAt,
  message: { id: key, type: 'message', message: { text: `note ${key}` } },
});
const pick = (token: string, expiresAt = 1000, ownerKey = user.ownerKey): ResultPick => ({
  token,
  ownerKey,
  globalId: '6f1c2a4e-1d2b-4c3d-8e4f-5a6b7c8d9e0f',
  location: { kind: 'page', page: 2 },
  expiresAt,
});

const states: [string, boolean, () => Promise<TelegramStateStore>][] = [
  ['memory', true, async () => new MemoryTelegramStore()],
  ['PostgreSQL', !!DATABASE, async () => new PostgresTelegramStore(await postgres())],
];

describe.each(states)('Telegram state: %s', (name, available, open) => {
  if (!available) {
    it.skip(`needs PILOT_TEST_DATABASE_URL (run npm run test:pilot:storage) for ${name}`);
    return;
  }

  it('keeps the polling offset', async () => {
    const state = await open();
    expect(await state.getOffset()).toBeUndefined();
    await state.setOffset(41);
    await state.setOffset(42);
    expect(await state.getOffset()).toBe(42);
  });

  it('finds result buttons until they expire, removes expired ones and erases per owner', async () => {
    const state = await open();
    await state.createPicks([pick('aaaaaaaaaaaa', 500), pick('bbbbbbbbbbbb', 1000)], 100);
    await state.createPicks([pick('cccccccccccc', 2000, 'tg:2')], 100);
    expect(await state.getPick('aaaaaaaaaaaa', 499)).toEqual(pick('aaaaaaaaaaaa', 500));
    expect(await state.getPick('aaaaaaaaaaaa', 500)).toBeUndefined();
    expect(await state.getPick('unknownunkno', 100)).toBeUndefined();
    await state.createPicks([], 600);
    expect(await state.getPick('aaaaaaaaaaaa', 0)).toBeUndefined();
    await state.forgetOwner(user.ownerKey);
    expect(await state.getPick('bbbbbbbbbbbb', 100)).toBeUndefined();
    expect(await state.getPick('cccccccccccc', 100)).toEqual(pick('cccccccccccc', 2000, 'tg:2'));
  });
});

describe('Telegram BotStore on PostgreSQL', () => {
  it.skipIf(!DATABASE)(
    'uses its own tables, so WhatsApp workers never see Telegram jobs or links',
    async () => {
      const pilot = await postgres();
      const telegram = new PostgresBotStore(pilot, TELEGRAM_TABLES);
      const whatsapp = new PostgresBotStore(pilot);
      expect(await telegram.recordInbound(user, inbound('m:1:1'))).toBe(true);
      expect(await telegram.recordInbound(user, inbound('m:1:1'))).toBe(false);
      expect(await whatsapp.getInbound('m:1:1')).toBeUndefined();
      expect(await whatsapp.claimJob(['ingest'], 100, 60)).toBeUndefined();
      const job = await telegram.claimJob(['ingest'], 100, 60);
      expect(job).toMatchObject({ wamid: 'm:1:1', ownerKey: user.ownerKey, attempts: 1 });
      await telegram.createLink({
        tokenHash: 'h1',
        ownerKey: user.ownerKey,
        label: 'Telegram @student_a',
        createdAt: 100,
        expiresAt: 700,
      });
      expect(await whatsapp.peekLink('h1', 100)).toBeUndefined();
      expect(await telegram.peekLink('h1', 100)).toMatchObject({ label: 'Telegram @student_a' });
      expect(await telegram.claimNotice(user.userId, 100)).toBe(true);
      await telegram.setConsent(user.userId, 110, '1');
      expect(await telegram.senderState(user.userId)).toEqual({
        noticeSentAt: 100,
        consentedAt: 110,
        noticeVersion: '1',
      });
      await telegram.forgetSender(user.userId, user.ownerKey);
      expect(await telegram.getSender(user.userId)).toEqual({
        userId: user.userId,
        ownerKey: user.ownerKey,
      });
      expect((await telegram.getInbound('m:1:1'))?.message).toEqual({
        id: 'm:1:1',
        type: 'message',
      });
      expect(await telegram.peekLink('h1', 100)).toBeUndefined();
    },
  );

  it('refuses table names that are not plain names', () => {
    expect(
      () =>
        new PostgresBotStore({} as PostgresPilotStore, {
          ...TELEGRAM_TABLES,
          jobs: 'tg_jobs; DROP TABLE items',
        }),
    ).toThrow(/plain lowercase/);
  });

  it.skipIf(!DATABASE)('backs up and restores the Telegram tables', async () => {
    expect(BACKUP_TABLES).toEqual(
      expect.arrayContaining([
        'tg_senders',
        'tg_inbound',
        'tg_jobs',
        'tg_links',
        'tg_state',
        'tg_picks',
      ]),
    );
    const pilot = await postgres();
    const bot = new PostgresBotStore(pilot, TELEGRAM_TABLES);
    const state = new PostgresTelegramStore(pilot);
    await bot.recordInbound(user, inbound('m:1:2'));
    await bot.claimReply('m:1:2');
    await state.setOffset(77);
    await state.createPicks([pick('dddddddddddd', 5000)], 100);
    const target = new MemoryObjectStore();
    const backup = await backupDatabase({ store: pilot, target, now: () => 1_762_300_000_000 });
    expect(backup.counts).toMatchObject({
      tg_senders: 1,
      tg_inbound: 1,
      tg_jobs: 1,
      tg_state: 1,
      tg_picks: 1,
    });
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
    const again = new PostgresBotStore(restored.store, TELEGRAM_TABLES);
    const againState = new PostgresTelegramStore(restored.store);
    expect(await again.getInbound('m:1:2')).toEqual(inbound('m:1:2'));
    expect(await again.claimReply('m:1:2')).toBe(false);
    expect(await again.recordInbound(user, inbound('m:1:2'))).toBe(false);
    expect(await againState.getOffset()).toBe(77);
    expect(await againState.getPick('dddddddddddd', 100)).toEqual(pick('dddddddddddd', 5000));
  });
});
