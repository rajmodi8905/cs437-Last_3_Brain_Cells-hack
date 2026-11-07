import 'fake-indexeddb/auto';
import { randomUUID } from 'node:crypto';
import { strFromU8, unzipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';
import { CampusRecallDatabase, DexieLibraryRepository } from '../../src/storage';
import { ApiFailure, createApiClient, type ApiClient } from '../client/api';
import { exportCloudVault } from '../client/export';
import { MemoryLocalLibrary, MemorySyncStateStore } from '../client/memory';
import { SyncEngine } from '../client/sync';
import { deviceFetch, idToken, startPilotServer } from './helpers';

let pilot: Awaited<ReturnType<typeof startPilotServer>> | undefined;
afterEach(async () => {
  await pilot?.close();
  pilot = undefined;
});
async function fixture() {
  pilot = await startPilotServer();
  const net = deviceFetch();
  const api = createApiClient({ base: pilot.base, fetch: net.fetchImpl });
  const { vault } = await api.signIn(idToken());
  const library = new MemoryLocalLibrary();
  library.add(
    { kind: 'note', title: '../private title', mimeType: 'text/plain;charset=utf-8' },
    new TextEncoder().encode('Exact original sentinel'),
  );
  library.add(
    {
      kind: 'webpage',
      title: 'Saved page',
      mimeType: 'text/plain;charset=utf-8',
      sourceUrl: 'https://example.com/source',
    },
    new TextEncoder().encode('Saved website content'),
  );
  const engine = new SyncEngine({
    api,
    library,
    state: new MemorySyncStateStore(),
    libraryId: 'export-test',
  });
  await engine.include(vault.epoch);
  await engine.runOnce();
  return { api, epoch: vault.epoch };
}
describe('P15 whole cloud library export', () => {
  it('exports authenticated originals and metadata into a restorable archive without indexes', async () => {
    const { api, epoch } = await fixture();
    const archives = await exportCloudVault({ api, epoch });
    expect(archives).toHaveLength(1);
    const files = unzipSync(new Uint8Array(await archives[0].arrayBuffer()));
    const manifest = JSON.parse(strFromU8(files['manifest.json']));
    expect(manifest.items).toHaveLength(2);
    expect(Object.keys(files)).toHaveLength(3);
    expect(manifest.items[0]).not.toHaveProperty('index');
    expect(
      Object.keys(files).every(
        (path) => path === 'manifest.json' || /^originals\/[a-f0-9-]+$/.test(path),
      ),
    ).toBe(true);
    const db = new CampusRecallDatabase(`campus-recall-test-${randomUUID()}`);
    try {
      const library = new DexieLibraryRepository(db);
      const report = await library.importArchive(archives[0]);
      expect(report.importedIds).toHaveLength(2);
      const items = await library.listItems();
      expect(items.map((item) => item.title).sort()).toEqual(['../private title', 'Saved page']);
      expect(items.find((item) => item.kind === 'webpage')?.sourceUrl).toBe(
        'https://example.com/source',
      );
    } finally {
      await db.delete();
    }
  });
  it('refuses corrupt bytes, changed vault contents and account switches without returning a ZIP', async () => {
    const { api, epoch } = await fixture();
    await expect(
      exportCloudVault({
        api: {
          ...api,
          original: async (id) => {
            const bytes = await api.original(id);
            bytes[0] ^= 1;
            return bytes;
          },
        },
        epoch,
      }),
    ).rejects.toThrow(/match/);
    let reads = 0;
    const changing = {
      ...api,
      changes: async (...args: Parameters<ApiClient['changes']>) => {
        const page = await api.changes(...args);
        if (++reads > 1)
          page.changes.push(
            page.changes[0] ?? {
              cursor: page.cursor + 1,
              item: { globalId: randomUUID(), revision: 1, deleted: true },
            },
          );
        return page;
      },
    };
    await expect(exportCloudVault({ api: changing, epoch })).rejects.toThrow(/changed/);
    await expect(
      exportCloudVault({
        api,
        epoch,
        assertAccount: () => {
          throw new Error('Account changed');
        },
      }),
    ).rejects.toThrow('Account changed');
  });
  it('keeps each archive within restore limits when a vault has more than 500 items', async () => {
    const { api, epoch } = await fixture();
    const initial = await api.changes(epoch, 0);
    const original = await api.original(initial.changes[0].item.globalId);
    const changes = Array.from({ length: 501 }, (_, i) => ({
      cursor: i + 1,
      item: { ...initial.changes[0].item, globalId: randomUUID() },
    }));
    const fake = {
      ...api,
      changes: async (_epoch: number, after: number) => ({
        cursor: 501,
        changes: after ? [] : changes,
      }),
      original: async () => original,
    };
    const archives = await exportCloudVault({ api: fake, epoch });
    expect(archives).toHaveLength(2);
    const counts = await Promise.all(
      archives.map(
        async (blob) =>
          JSON.parse(
            strFromU8(unzipSync(new Uint8Array(await blob.arrayBuffer()))['manifest.json']),
          ).items.length,
      ),
    );
    expect(counts).toEqual([500, 1]);
  });
  it('waits for rate limiting and retries a read without repeating writes', async () => {
    const { api, epoch } = await fixture();
    let attempts = 0;
    const limited = {
      ...api,
      original: async (...args: Parameters<ApiClient['original']>) => {
        if (++attempts === 1) throw new ApiFailure(429, 'RATE_LIMITED', 'wait', {}, 0.2);
        return api.original(...args);
      },
    };
    expect(await exportCloudVault({ api: limited, epoch })).toHaveLength(1);
    expect(attempts).toBe(3);
  });
});
