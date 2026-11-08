/// <reference types="node" />
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApiClient, type ApiClient } from '../client/api';
import { PILOT_INDEX_VERSIONS, searchMetadataDigest, type IndexBundle } from '../contract';
import { deviceFetch, idToken, sha256, startPilotServer } from './helpers';

let pilot: Awaited<ReturnType<typeof startPilotServer>>;
beforeEach(async () => {
  pilot = await startPilotServer();
});
afterEach(() => pilot.close());

const pdf = new TextEncoder().encode('%PDF-1.4\n' + 'Guests need a pass. '.repeat(500));
const version = PILOT_INDEX_VERSIONS[0];
const unit = (axis: number) => Array.from({ length: 768 }, (_, i) => (i === axis ? 1 : 0));

async function signedIn(token = idToken()) {
  const net = deviceFetch();
  const api = createApiClient({ base: pilot.base, fetch: net.fetchImpl });
  const session = await api.signIn(token);
  return { api, epoch: session.vault.epoch };
}
async function uploaded(device: { api: ApiClient; epoch: number }, title = 'Hostel mess rules') {
  const globalId = randomUUID();
  const begun = await device.api.beginUpload(globalId, {
    opId: randomUUID(),
    epoch: device.epoch,
    item: {
      kind: 'pdf',
      title,
      mimeType: 'application/pdf',
      byteLength: pdf.length,
      contentSha256: sha256(pdf),
      createdAt: 1_762_000_000_000,
    },
  });
  await device.api.putChunk(begun.uploadId, 0, pdf);
  await device.api.completeUpload(begun.uploadId, { opId: randomUUID(), epoch: device.epoch });
  return globalId;
}
const bundleFor = async (globalId: string, title: string, over: Partial<IndexBundle> = {}) => ({
  globalId,
  contentSha256: sha256(pdf),
  searchMetadataDigest: await searchMetadataDigest({ title }),
  indexVersion: version,
  dimension: 768,
  segments: [
    {
      modality: 'text' as const,
      location: { kind: 'page' as const, page: 2 },
      text: 'Guests need a pass.',
      vector: unit(3),
    },
  ],
  ...over,
});

describe('P05 index version matches the app', () => {
  it('accepts the index version the app currently writes', async () => {
    const engine = await readFile('src/engine/index.ts', 'utf8');
    const current = /export const INDEX_VERSION =\s*'([^']+)'/.exec(engine)?.[1];
    expect(current).toBeTruthy();
    expect(PILOT_INDEX_VERSIONS).toContain(current);
  });
});

describe('P05 publishing and fetching index bundles', () => {
  it('stores a matching bundle, reports it in the change feed and serves it back', async () => {
    const phone = await signedIn();
    const globalId = await uploaded(phone);
    const bundle = await bundleFor(globalId, 'Hostel mess rules');
    const { item } = await phone.api.publishIndex(globalId, {
      opId: randomUUID(),
      epoch: phone.epoch,
      bundle,
    });
    expect(item).toMatchObject({
      globalId,
      revision: 1,
      index: {
        indexVersion: version,
        contentSha256: sha256(pdf),
        searchMetadataDigest: bundle.searchMetadataDigest,
        segmentCount: 1,
      },
    });
    const laptop = await signedIn();
    const feed = await laptop.api.changes(laptop.epoch, 0);
    expect(feed.changes.at(-1)!.item.index).toMatchObject({ segmentCount: 1 });
    expect(await laptop.api.index(globalId)).toEqual(bundle);
  });

  it('rejects a bundle built before a rename', async () => {
    const phone = await signedIn();
    const globalId = await uploaded(phone);
    await phone.api.rename(globalId, {
      opId: randomUUID(),
      epoch: phone.epoch,
      expectedRevision: 1,
      title: 'Mess rules 2026',
    });
    const stale = await bundleFor(globalId, 'Hostel mess rules');
    await expect(
      phone.api.publishIndex(globalId, { opId: randomUUID(), epoch: phone.epoch, bundle: stale }),
    ).rejects.toMatchObject({ code: 'INDEX_INCOMPATIBLE' });
  });

  it('rejects an unsupported index version and malformed vectors', async () => {
    const phone = await signedIn();
    const globalId = await uploaded(phone);
    await expect(
      phone.api.publishIndex(globalId, {
        opId: randomUUID(),
        epoch: phone.epoch,
        bundle: await bundleFor(globalId, 'Hostel mess rules', { indexVersion: 'old-v7' }),
      }),
    ).rejects.toMatchObject({ code: 'INDEX_INCOMPATIBLE' });
    const bad = await bundleFor(globalId, 'Hostel mess rules');
    bad.segments[0].vector = unit(3).map((v) => v * 3);
    await expect(
      phone.api.publishIndex(globalId, { opId: randomUUID(), epoch: phone.epoch, bundle: bad }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('keeps bundles private to the account and removes them with the item', async () => {
    const phone = await signedIn();
    const globalId = await uploaded(phone);
    await phone.api.publishIndex(globalId, {
      opId: randomUUID(),
      epoch: phone.epoch,
      bundle: await bundleFor(globalId, 'Hostel mess rules'),
    });
    const neighbour = await signedIn(idToken({ sub: 'subject-b', email: 'b@iitgn.ac.in' }));
    await expect(neighbour.api.index(globalId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await phone.api.remove(globalId, {
      opId: randomUUID(),
      epoch: phone.epoch,
      expectedRevision: 1,
    });
    await expect(phone.api.index(globalId)).rejects.toMatchObject({ code: 'ITEM_DELETED' });
  });
});
