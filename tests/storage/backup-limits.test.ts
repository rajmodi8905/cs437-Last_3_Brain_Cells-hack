import { beforeEach, describe, expect, it } from 'vitest';
import { AnyRecallDatabase, DexieLibraryRepository } from '../../src/storage/index.js';
import { ARCHIVE_LIMITS, LIMITS, planArchiveParts } from '../../src/shared/index.js';
import { exportLibrary } from '../../src/app/backup.js';

async function freshRepository() {
  const repository = new DexieLibraryRepository(
    new AnyRecallDatabase(`test-${crypto.randomUUID()}`),
  );
  await repository.open();
  return repository;
}

describe('Backup export stays within the import limits', () => {
  let repository: DexieLibraryRepository;
  beforeEach(async () => {
    repository = await freshRepository();
  });

  it('splits a library one item over the archive item limit into ZIPs that all import', async () => {
    const count = ARCHIVE_LIMITS.maxItems + 1;
    for (let n = 0; n < count; n++)
      await repository.save({ kind: 'note', text: `Backup note number ${n}`, title: `Note ${n}` });
    // Export all's own path: the app splits the library, then exports each part.
    const archives = await exportLibrary(repository, await repository.listItems());
    expect(archives.length).toBeGreaterThan(1);
    const restored = await freshRepository();
    let imported = 0;
    for (const archive of archives) {
      expect(archive.size).toBeLessThanOrEqual(ARCHIVE_LIMITS.maxArchiveBytes);
      imported += (await restored.importArchive(archive)).importedIds.length;
    }
    expect(imported).toBe(count);
    expect((await restored.listItems()).map((item) => item.title).sort()).toEqual(
      (await repository.listItems()).map((item) => item.title).sort(),
    );
  });

  it('puts large media into parts below the ZIP size and unpacked limits', () => {
    const video = { byteLength: LIMITS.maxVideoBytes };
    const parts = planArchiveParts([video, video, video, { byteLength: 1 }]);
    expect(parts.flat()).toHaveLength(4);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      const bytes = part.reduce((sum, item) => sum + item.byteLength, 0);
      expect(part.length).toBeLessThanOrEqual(ARCHIVE_LIMITS.maxItems);
      expect(bytes).toBeLessThan(ARCHIVE_LIMITS.maxArchiveBytes);
      expect(bytes).toBeLessThan(ARCHIVE_LIMITS.maxUnpackedBytes);
    }
  });

  it('refuses a single-ZIP export the importer would reject instead of producing it', async () => {
    for (let n = 0; n <= ARCHIVE_LIMITS.maxItems; n++)
      await repository.save({ kind: 'note', text: `Selected note ${n}` });
    const ids = (await repository.listItems()).map((item) => item.id);
    await expect(repository.exportItems(ids)).rejects.toMatchObject({
      detail: { code: 'LIMIT_EXCEEDED' },
    });
  });
});
