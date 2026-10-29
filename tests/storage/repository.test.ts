import { beforeEach, describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { CampusRecallDatabase, DexieLibraryRepository } from '../../src/storage/index.js';
import type { IndexedSegment } from '../../src/shared/index.js';

const makeNote = (text: string, title?: string) => ({ kind: 'note' as const, text, title });

describe('DexieLibraryRepository', () => {
  let database: CampusRecallDatabase;
  let repository: DexieLibraryRepository;

  beforeEach(async () => {
    database = new CampusRecallDatabase(`test-${crypto.randomUUID()}`);
    repository = new DexieLibraryRepository(database);
    await repository.open();
  });

  it('commits a note and its queued job before save resolves', async () => {
    const item = await repository.save(makeNote('Meet at the north library entrance on Tuesday.'));

    expect(item.status).toBe('queued');
    expect((await repository.listItems())[0]?.id).toBe(item.id);
    expect((await repository.getOriginal(item.id))?.size).toBe(item.byteLength);
  });

  it('keeps same-title items separate and preserves bytes across rename', async () => {
    const first = await repository.save(makeNote('first', 'Same title'));
    const second = await repository.save(makeNote('second', 'Same title'));

    const renamed = await repository.renameItem(first.id, 'Renamed');
    expect(renamed.id).toBe(first.id);
    expect(renamed.contentSha256).toBe(first.contentSha256);
    expect((await repository.getOriginal(first.id))?.size).toBe(first.byteLength);
    expect((await repository.listItems()).map((item) => item.id)).toEqual([first, second].sort((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id)).map((item) => item.id));
  });

  it('truncates derived titles instead of rejecting them', async () => {
    const item = await repository.save(makeNote('x'.repeat(500)));

    expect(item.title).toHaveLength(120);
    expect(item.title).toBe('x'.repeat(120));
    expect(item.status).toBe('queued');
  });

  it('rejects stale publication and removes all records on delete', async () => {
    const item = await repository.save(makeNote('stale publication'));
    const claim = await repository.claimNextJob();
    expect(claim).toBeDefined();

    await repository.deleteItem(item.id);
    const segment: IndexedSegment = {
      id: crypto.randomUUID(), itemId: item.id, modality: 'text', location: { kind: 'whole' },
      text: 'stale', vector: new Float32Array(768).fill(1 / Math.sqrt(768)), indexVersion: 'test'
    };
    expect(await repository.publishSegments(claim!, [segment])).toBe(false);
    expect(await repository.getItem(item.id)).toBeUndefined();
    expect(await repository.getOriginal(item.id)).toBeUndefined();
  });

  it('rejects invalid archive metadata before committing any writes', async () => {
    const entryId = crypto.randomUUID();
    const body = 'snapshot';
    const bytes = new TextEncoder().encode(body);
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('');
    const manifest = {
      format: 'campus-recall',
      version: 1,
      exportedAt: Date.now(),
      items: [{
        id: entryId,
        kind: 'webpage',
        title: 'Bad export',
        mimeType: 'text/plain;charset=utf-8',
        byteLength: bytes.length,
        contentSha256: digest,
        createdAt: Date.now(),
        sourceUrl: 'javascript:alert(1)',
        originalPath: `originals/${entryId}`
      }]
    };
    const archiveBytes = zipSync({ [`originals/${entryId}`]: bytes, 'manifest.json': strToU8(JSON.stringify(manifest)) });
    const archiveBuffer = new ArrayBuffer(archiveBytes.byteLength);
    new Uint8Array(archiveBuffer).set(archiveBytes);
    const archive = new Blob([archiveBuffer], { type: 'application/zip' });

    await expect(repository.importArchive(archive)).rejects.toMatchObject({ detail: { code: 'INVALID_ARCHIVE' } });
    expect((await repository.listItems())).toHaveLength(0);
  });

  it('rejects an oversized archive note before committing any writes', async () => {
    const entryId = crypto.randomUUID();
    const bytes = new TextEncoder().encode('x'.repeat(20_001));
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('');
    const manifest = {
      format: 'campus-recall',
      version: 1,
      exportedAt: Date.now(),
      items: [{
        id: entryId,
        kind: 'note',
        title: 'Oversized note',
        mimeType: 'text/plain;charset=utf-8',
        byteLength: bytes.length,
        contentSha256: digest,
        createdAt: Date.now(),
        originalPath: `originals/${entryId}`
      }]
    };
    const archiveBytes = zipSync({ [`originals/${entryId}`]: bytes, 'manifest.json': strToU8(JSON.stringify(manifest)) });
    const archiveBuffer = new ArrayBuffer(archiveBytes.byteLength);
    new Uint8Array(archiveBuffer).set(archiveBytes);
    const archive = new Blob([archiveBuffer], { type: 'application/zip' });

    await expect(repository.importArchive(archive)).rejects.toMatchObject({ detail: { code: 'INVALID_ARCHIVE' } });
    expect(await repository.listItems()).toHaveLength(0);
  });

  it('allows only one concurrent claim for a queued job', async () => {
    const item = await repository.save(makeNote('claim once'));
    const [first, second] = await Promise.all([repository.claimNextJob(), repository.claimNextJob()]);

    expect([first?.item.id, second?.item.id].filter((id) => id === item.id)).toHaveLength(1);
  });

  it('exports and restores originals as queued fresh items, skipping hashed duplicates', async () => {
    const item = await repository.save({ kind: 'webpage', url: 'https://example.test/page', text: 'snapshot', title: 'Page' });
    const archive = await repository.exportItems([item.id]);

    const restoredDatabase = new CampusRecallDatabase(`test-${crypto.randomUUID()}`);
    const restored = new DexieLibraryRepository(restoredDatabase);
    await restored.open();
    const report = await restored.importArchive(archive);
    const imported = await restored.getItem(report.importedIds[0]!);

    expect(report.importedIds).toHaveLength(1);
    expect(imported?.id).not.toBe(item.id);
    expect(imported?.status).toBe('queued');
    expect(imported?.sourceUrl).toBe('https://example.test/page');
    expect((await restored.getOriginal(imported!.id))?.size).toBe(imported!.byteLength);

    const duplicateReport = await restored.importArchive(archive);
    expect(duplicateReport.importedIds).toHaveLength(0);
    expect(duplicateReport.skippedDuplicateIds).toEqual([imported!.id]);
  });

  it('restores every entry when two exported items share the same bytes', async () => {
    const club = await repository.save({ kind: 'note', text: 'Badminton at 6', title: 'Club group' });
    const hostel = await repository.save({ kind: 'note', text: 'Badminton at 6', title: 'Hostel group' });
    const archive = await repository.exportItems([club.id, hostel.id]);

    const targetDatabase = new CampusRecallDatabase(`test-${crypto.randomUUID()}`);
    const target = new DexieLibraryRepository(targetDatabase);
    await target.open();
    const report = await target.importArchive(archive);
    const restored = await target.listItems();

    expect(report.importedIds).toHaveLength(2);
    expect(report.skippedDuplicateIds).toHaveLength(0);
    expect(restored.map((item) => [item.title, item.createdAt]).sort()).toEqual(
      [[club.title, club.createdAt], [hostel.title, hostel.createdAt]].sort(),
    );

    const again = await target.importArchive(archive);
    expect(again.importedIds).toHaveLength(0);
    expect([...again.skippedDuplicateIds].sort()).toEqual(restored.map((item) => item.id).sort());

    const partialDatabase = new CampusRecallDatabase(`test-${crypto.randomUUID()}`);
    const partial = new DexieLibraryRepository(partialDatabase);
    await partial.open();
    await partial.importArchive(await repository.exportItems([club.id]));
    const topUp = await partial.importArchive(archive);
    expect(topUp.importedIds).toHaveLength(1);
    expect((await partial.getItem(topUp.importedIds[0]!))?.title).toBe('Hostel group');
  });

  it('serializes concurrent imports so only one creates the item', async () => {
    const item = await repository.save({ kind: 'webpage', url: 'https://example.test/concurrent', text: 'snapshot', title: 'Page' });
    const archive = await repository.exportItems([item.id]);
    const targetDatabase = new CampusRecallDatabase(`test-${crypto.randomUUID()}`);
    const targetRepository = new DexieLibraryRepository(targetDatabase);
    await targetRepository.open();

    const [first, second] = await Promise.all([targetRepository.importArchive(archive), targetRepository.importArchive(archive)]);

    expect([first.importedIds.length, second.importedIds.length].sort()).toEqual([0, 1]);
    expect([first.skippedDuplicateIds.length, second.skippedDuplicateIds.length].sort()).toEqual([0, 1]);
    expect(await targetRepository.listItems()).toHaveLength(1);
  });

  it('rejects zero vectors before publishing ready state', async () => {
    const item = await repository.save(makeNote('zero vector'));
    const claim = await repository.claimNextJob();
    expect(claim).toBeDefined();

    const segment: IndexedSegment = {
      id: crypto.randomUUID(), itemId: item.id, modality: 'text', location: { kind: 'whole' },
      text: 'zero', vector: new Float32Array(768), indexVersion: 'test'
    };
    expect(await repository.publishSegments(claim!, [segment])).toBe(false);
    expect((await repository.getItem(item.id))?.status).toBe('processing');
    expect(await repository.listSearchableSegments('test')).toHaveLength(0);
  });
});