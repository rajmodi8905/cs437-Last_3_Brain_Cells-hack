import { describe, expect, it } from 'vitest';
import { normalize, rankSegments } from '../../src/engine/ranking';
import { chunkTokenIds } from '../../src/engine/chunks';
import type { SearchableSegment } from '../../src/shared';
const vector = (x: number, y: number) =>
  normalize(Float32Array.from([x, y, ...Array(766).fill(0)]));
const segment = (
  id: string,
  itemId: string,
  v: Float32Array,
  text = 'Registration closes Friday',
): SearchableSegment => ({
  id,
  itemId,
  vector: v,
  text,
  modality: 'text',
  itemKind: 'note',
  location: { kind: 'whole' },
  indexVersion: 'test',
});
describe('retrieval arithmetic and policy', () => {
  it('normalizes and rejects invalid vectors', () => {
    expect(normalize(new Float32Array([3, 4]))[0]).toBeCloseTo(0.6);
    expect(() => normalize(new Float32Array(768))).toThrow();
  });
  it('groups originals, retains the strongest location, and caps five', () => {
    const input = Array.from({ length: 8 }, (_, i) =>
      segment(String(i), String(i), vector(1, 0.01 * i)),
    );
    input.push(segment('weak', '0', vector(0.5, 0.5)));
    const results = rankSegments(vector(1, 0), input, 'registration');
    expect(results).toHaveLength(5);
    expect(results[0].segmentId).toBe('0');
  });
  it('rejects weak matches even when lexical text overlaps', () => {
    expect(
      rankSegments(vector(1, 0), [segment('1', '1', vector(0, 1), 'registration')], 'registration'),
    ).toEqual([]);
  });
  it('never mixes modalities into one threshold', () => {
    expect(
      rankSegments(
        vector(1, 0),
        [{ ...segment('v', 'v', vector(0.25, 1)), modality: 'visual' }],
        'registration',
      ),
    ).toEqual([]);
  });
});
it('chunks actual token IDs with bounded overlap and no loss', () => {
  const ids = Array.from({ length: 600 }, (_, i) => i);
  const chunks = chunkTokenIds(ids);
  expect(chunks.map((x) => x.length)).toEqual([256, 256, 184]);
  expect(chunks[1].slice(0, 48)).toEqual(chunks[0].slice(-48));
  expect([...new Set(chunks.flat())]).toEqual(ids);
});
it('uses exact tokens for the bounded lexical boost, deterministic segment ties and source excerpts', () => {
  const q = vector(1, 0);
  const a = segment('z', 'one', vector(1, 0), 'registration');
  const b = segment('a', 'one', vector(1, 0), 'registration');
  const result = rankSegments(q, [a, b], 'reg');
  expect(result[0].score).toBeCloseTo(1);
  expect(result[0].segmentId).toBe('a');
  expect(rankSegments(q, [a], 'registration')[0].score).toBeCloseTo(1.08);
});
