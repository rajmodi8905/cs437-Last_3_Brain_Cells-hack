import { describe, expect, it, vi } from 'vitest';
import {
  DOWNLOAD_GAP_MS,
  backupCreatedMessage,
  downloadParts,
  exportLibrary,
} from '../../src/app/backup';
import { ARCHIVE_LIMITS } from '../../src/shared';

describe('Export all', () => {
  it('asks the repository for one importable ZIP per part, never the whole large library', async () => {
    const items = Array.from({ length: ARCHIVE_LIMITS.maxItems + 1 }, (_, n) => ({
      id: `item-${n}`,
      byteLength: 10,
    }));
    const exportItems = vi.fn(async (ids: string[]) => new Blob([ids.join(',')]));
    const archives = await exportLibrary({ exportItems }, items);
    expect(archives).toHaveLength(2);
    expect(exportItems.mock.calls.map(([ids]) => ids.length)).toEqual([ARCHIVE_LIMITS.maxItems, 1]);
  });

  it('waits between part downloads and names each part', async () => {
    const events: string[] = [];
    await downloadParts([new Blob(['a']), new Blob(['b']), new Blob(['c'])], 'campus-recall', {
      download: (_blob, name) => events.push(name),
      pause: async (ms) => {
        events.push(`wait ${ms}`);
      },
    });
    expect(events).toEqual([
      'campus-recall-part-1-of-3.zip',
      `wait ${DOWNLOAD_GAP_MS}`,
      'campus-recall-part-2-of-3.zip',
      `wait ${DOWNLOAD_GAP_MS}`,
      'campus-recall-part-3-of-3.zip',
    ]);
  });

  it('downloads a small library as one ZIP without waiting', async () => {
    const events: string[] = [];
    await downloadParts([new Blob(['a'])], 'campus-recall', {
      download: (_blob, name) => events.push(name),
      pause: async () => {
        events.push('wait');
      },
    });
    expect(events).toEqual(['campus-recall.zip']);
  });

  it('tells the user to check that every part arrived', () => {
    expect(backupCreatedMessage(3)).toMatch(/Check that all 3 downloaded/);
    expect(backupCreatedMessage(1)).toBe(
      'Backup created. Keep this unencrypted ZIP somewhere private.',
    );
  });
});
