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
    const archive = new Blob([zipSync({ [`originals/${entryId}`]: bytes, 'manifest.json': strToU8(JSON.stringify(manifest)) })], { type: 'application/zip' });

    await expect(repository.importArchive(archive)).rejects.toMatchObject({ detail: { code: 'INVALID_ARCHIVE' } });
    expect((await repository.listItems())).toHaveLength(0);
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
});