/// <reference types="node" />
// The same guarantees from every BotStore. PostgreSQL runs with npm run test:pilot:storage;
// otherwise it is reported as skipped, never as passed.
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { backupDatabase, restoreDatabase } from '../server/backup';
import { MemoryObjectStore } from '../server/memory';
import { BACKUP_TABLES, PostgresPilotStore } from '../server/postgres';
import { PostgresBotStore } from '../server/whatsapp/postgres';
import {
  MemoryBotStore,
  jobId,
  senderIdentity,
  type BotStore,
  type InboundMessage,
  type WhatsAppSender,
} from '../server/whatsapp/store';

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

const stores: [string, boolean, () => Promise<BotStore>][] = [
  ['memory', true, async () => new MemoryBotStore()],
  ['PostgreSQL', !!DATABASE, async () => new PostgresBotStore(await postgres())],
];

const alice: WhatsAppSender = {
  userId: 'IN.1001',
  ownerKey: 'wa:IN.1001',
  waId: '919800000001',
};
const inbound = (wamid: string, sender = alice, receivedAt = 100): InboundMessage => ({
  wamid,
  senderId: sender.userId,
  ownerKey: sender.ownerKey,
  receivedAt,
  message: { id: wamid, type: 'text', text: { body: `note ${wamid}` }, timestamp: '99' },
});

describe('WhatsApp sender identity', () => {
  it('prefers the BSUID and derives a separate ID from a phone number alone', () => {
    expect(senderIdentity({ bsuid: 'IN.1001', waId: '919800000001' })).toEqual(alice);
    expect(senderIdentity({ bsuid: 'US.ENT.42' })).toEqual({
      userId: 'US.ENT.42',
      ownerKey: 'wa:US.ENT.42',
    });
    const byPhone = senderIdentity({ waId: '919800000001' })!;
    expect(byPhone.userId).toMatch(/^phone-[0-9a-f]{32}$/);
    expect(byPhone).toEqual(senderIdentity({ waId: '919800000001' }));
    expect(byPhone.ownerKey).toBe(`wa:${byPhone.userId}`);
    expect(senderIdentity({ waId: '919800000002' })!.userId).not.toBe(byPhone.userId);
  });

  it('refuses IDs that could not be part of a storage key', () => {
    expect(senderIdentity({ bsuid: '../IN.1' })).toBeUndefined();
    expect(senderIdentity({ bsuid: 'IN 1' })).toBeUndefined();
    expect(senderIdentity({ waId: '+91 98' })).toBeUndefined();
    expect(senderIdentity({})).toBeUndefined();
  });
});

describe.each(stores)('BotStore: %s', (name, available, open) => {
  if (!available) {
    it.skip(`needs PILOT_TEST_DATABASE_URL (run npm run test:pilot:storage) for ${name}`);
    return;
  }

  it('records a message and its ingest job once per message ID', async () => {
    const bot = await open();
    expect(await bot.recordInbound(alice, inbound('wamid.1'))).toBe(true);
    expect(await bot.recordInbound(alice, inbound('wamid.1', alice, 200))).toBe(false);
    expect(await bot.getInbound('wamid.1')).toEqual(inbound('wamid.1'));
    expect(await bot.getInbound('wamid.2')).toBeUndefined();
    expect(await bot.getJob(jobId('ingest', 'wamid.1'))).toEqual({
      id: 'ingest:wamid.1',
      kind: 'ingest',
      wamid: 'wamid.1',
      ownerKey: alice.ownerKey,
      state: 'pending',
      attempts: 0,
      runAfter: 100,
      createdAt: 100,
    });
  });

  it('records concurrent deliveries of one message once', async () => {
    const bot = await open();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => bot.recordInbound(alice, inbound('wamid.same'))),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await bot.claimJob(['ingest'], 100, 60)).toBeDefined();
    expect(await bot.claimJob(['ingest'], 100, 60)).toBeUndefined();
  });

  it("keeps a sender's owner key and last known number", async () => {
    const bot = await open();
    await bot.recordInbound(alice, inbound('wamid.1'));
    const { waId: _waId, ...withoutNumber } = alice;
    await bot.recordInbound(withoutNumber, inbound('wamid.2', withoutNumber));
    expect(await bot.getSender(alice.userId)).toEqual(alice);
    expect(await bot.getSender('IN.unknown')).toBeUndefined();
  });

  it('hands each due job to one claimer, oldest first, and leaves other kinds alone', async () => {
    const bot = await open();
    for (const [n, at] of [
      [1, 10],
      [2, 5],
      [3, 20],
    ])
      await bot.recordInbound(alice, inbound(`wamid.${n}`, alice, at));
    await bot.enqueue('index', 'wamid.1', alice.ownerKey, 1);
    await bot.enqueue('index', 'wamid.1', alice.ownerKey, 2);
    const claims = await Promise.all(
      Array.from({ length: 6 }, () => bot.claimJob(['ingest'], 15, 60)),
    );
    const claimed = claims.filter((job) => job !== undefined);
    expect(claimed.map((job) => job.wamid).sort()).toEqual(['wamid.1', 'wamid.2']);
    expect(claimed.every((job) => job.state === 'running' && job.attempts === 1)).toBe(true);
    expect(claimed[0].lockedUntil).toBe(75);
    // Not yet due, then due.
    expect(await bot.claimJob(['ingest'], 15, 60)).toBeUndefined();
    expect((await bot.claimJob(['ingest'], 20, 60))?.wamid).toBe('wamid.3');
    expect(await bot.getJob(jobId('index', 'wamid.1'))).toMatchObject({
      state: 'pending',
      runAfter: 1,
    });
    expect((await bot.claimJob(['index'], 20, 60))?.id).toBe('index:wamid.1');
  });

  it('retries, defers, finishes and fails jobs, ignoring stale claims', async () => {
    const bot = await open();
    await bot.recordInbound(alice, inbound('wamid.1'));
    const first = (await bot.claimJob(['ingest'], 100, 60))!;
    await bot.retryJob(first, 'HTTP 500', 130);
    expect(await bot.getJob(first.id)).toMatchObject({
      state: 'pending',
      attempts: 1,
      runAfter: 130,
      lastError: 'HTTP 500',
    });
    expect(await bot.getJob(first.id)).not.toHaveProperty('lockedUntil');
    const second = (await bot.claimJob(['ingest'], 130, 60))!;
    expect(second.attempts).toBe(2);
    await bot.deferJob(second, 140);
    expect(await bot.getJob(first.id)).toMatchObject({ state: 'pending', attempts: 1 });

    // A claim whose lease ran out is taken again; the old claimer can no longer change it.
    const third = (await bot.claimJob(['ingest'], 140, 60))!;
    const fourth = (await bot.claimJob(['ingest'], 201, 60))!;
    expect(fourth.attempts).toBe(third.attempts + 1);
    await bot.finishJob(third);
    await bot.failJob(third, 'stale');
    expect(await bot.getJob(first.id)).toMatchObject({ state: 'running', attempts: 3 });
    await bot.finishJob(fourth);
    expect((await bot.getJob(first.id))?.state).toBe('done');
    expect(await bot.claimJob(['ingest'], 10_000, 60)).toBeUndefined();

    await bot.recordInbound(alice, inbound('wamid.2'));
    const failing = (await bot.claimJob(['ingest'], 10_000, 60))!;
    await bot.failJob(failing, 'gave up');
    expect(await bot.getJob(failing.id)).toMatchObject({ state: 'failed', lastError: 'gave up' });
    expect(await bot.claimJob(['ingest'], 99_999, 60)).toBeUndefined();
  });

  it('lets only the first caller answer a message', async () => {
    const bot = await open();
    await bot.recordInbound(alice, inbound('wamid.1'));
    const claims = await Promise.all([1, 2, 3].map(() => bot.claimReply('wamid.1')));
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await bot.claimReply('wamid.1')).toBe(false);
    expect(await bot.claimReply('wamid.unknown')).toBe(false);
  });
});

describe('BotStore: PostgreSQL backup', () => {
  it.skipIf(!DATABASE)('backs up and restores the WhatsApp tables', async () => {
    expect(BACKUP_TABLES).toEqual(expect.arrayContaining(['wa_senders', 'wa_inbound', 'wa_jobs']));
    const pilot = await postgres();
    const bot = new PostgresBotStore(pilot);
    await bot.recordInbound(alice, inbound('wamid.1'));
    await bot.claimReply('wamid.1');
    const target = new MemoryObjectStore();
    const backup = await backupDatabase({ store: pilot, target, now: () => 1_762_300_000_000 });
    expect(backup.counts).toMatchObject({ wa_senders: 1, wa_inbound: 1, wa_jobs: 1 });

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
    const again = new PostgresBotStore(restored.store);
    expect(await again.getInbound('wamid.1')).toEqual(inbound('wamid.1'));
    expect(await again.getSender(alice.userId)).toEqual(alice);
    expect(await again.claimReply('wamid.1')).toBe(false);
    expect(await again.recordInbound(alice, inbound('wamid.1'))).toBe(false);
    expect((await again.claimJob(['ingest'], 100, 60))?.wamid).toBe('wamid.1');
  });
});
