import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { LocalEngine } from '../../src/engine';
import { CampusRecallDatabase, DexieLibraryRepository } from '../../src/storage';
import { PILOT_INDEX_VERSIONS } from '../contract';

const unit = (axis: number) => Float32Array.from({ length: 768 }, (_, i) => (i === axis ? 1 : 0));
const cloudSegment = (globalId: string, kind: 'pdf' | 'image', axis: number) => ({
  id: `cloud:${globalId}:0`,
  itemId: `cloud:${globalId}`,
  itemKind: kind,
  modality: 'text' as const,
  location: { kind: 'page' as const, page: 2 },
  text: 'Guests need a pass from the warden before 6 pm.',
  vector: unit(axis),
  indexVersion: PILOT_INDEX_VERSIONS[0],
});

function engineWithQueryVector(vector: Float32Array) {
  const repository = new DexieLibraryRepository(
    new CampusRecallDatabase(`campus-recall-test-${Math.random().toString(16).slice(2)}`),
  );
  const engine = new LocalEngine(repository);
  engine.ready = true;
  // Stand in for the query model: search must embed the query on this device.
  Object.defineProperty(engine, 'models', { value: { query: async () => vector } });
  return engine;
}

describe('P06 search covers cloud items on this device', () => {
  it('ranks cloud segments with local ones and keeps their page', async () => {
    const engine = engineWithQueryVector(unit(3));
    engine.extraSegments = async () => [cloudSegment('g-pdf', 'pdf', 3)];
    const results = await engine.search('when do guests need a pass');
    expect(results).toEqual([
      expect.objectContaining({
        itemId: 'cloud:g-pdf',
        location: { kind: 'page', page: 2 },
        matchKind: 'text',
        excerpt: expect.stringContaining('Guests need a pass'),
      }),
    ]);
  });

  it('applies the type filter to cloud items', async () => {
    const engine = engineWithQueryVector(unit(3));
    engine.extraSegments = async (kind) =>
      [cloudSegment('g-pdf', 'pdf', 3), cloudSegment('g-img', 'image', 3)].filter(
        (segment) => !kind || segment.itemKind === kind,
      );
    expect((await engine.search('guests pass', 'image')).map((r) => r.itemId)).toEqual([
      'cloud:g-img',
    ]);
  });

  it('ignores cloud segments from another index version', async () => {
    const engine = engineWithQueryVector(unit(3));
    engine.extraSegments = async () => [
      { ...cloudSegment('g-old', 'pdf', 3), indexVersion: 'older-model-v7' },
    ];
    expect(await engine.search('guests pass')).toEqual([]);
  });

  it('still searches local items if the cloud source fails', async () => {
    const engine = engineWithQueryVector(unit(3));
    engine.extraSegments = async () => {
      throw new Error('offline');
    };
    await expect(engine.search('guests pass')).resolves.toEqual([]);
  });
});
