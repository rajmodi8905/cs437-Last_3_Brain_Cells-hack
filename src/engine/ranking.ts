import type { SearchableSegment, SearchResult } from '../shared';
// Frozen after calibration. See docs/verification/retrieval.md for measured evaluation.
export const THRESHOLDS = { text: 0.7, visual: 0.69 } as const;
export function normalize(values: Float32Array): Float32Array {
  const norm = Math.sqrt(values.reduce((sum, x) => sum + x * x, 0));
  if (!Number.isFinite(norm) || norm === 0)
    throw new Error('The model returned an invalid embedding.');
  return Float32Array.from(values, (x) => x / norm);
}
export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) throw new Error('Embedding dimensions differ.');
  return a.reduce((sum, x, i) => sum + x * b[i], 0);
}
export function rankSegments(
  query: Float32Array,
  segments: SearchableSegment[],
  text: string,
): SearchResult[] {
  const words = [...new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])];
  const grouped = new Map<string, SearchResult>();
  for (const segment of segments) {
    const similarity = cosine(query, segment.vector);
    if (similarity < THRESHOLDS[segment.modality]) continue;
    const source = new Set(segment.text?.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
    const overlap =
      segment.modality === 'text' && words.length
        ? words.filter((w) => source.has(w)).length / words.length
        : 0;
    const result: SearchResult = {
      itemId: segment.itemId,
      segmentId: segment.id,
      location: segment.location,
      matchKind: segment.modality,
      excerpt: segment.text ? sourceExcerpt(segment.text, words) : undefined,
      score: similarity + 0.08 * overlap,
    };
    const existing = grouped.get(result.itemId);
    if (
      !existing ||
      existing.score < result.score ||
      (existing.score === result.score && result.segmentId.localeCompare(existing.segmentId) < 0)
    )
      grouped.set(result.itemId, result);
  }
  return [...grouped.values()]
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.itemId.localeCompare(b.itemId) ||
        a.segmentId.localeCompare(b.segmentId),
    )
    .slice(0, 5);
}

export function sourceExcerpt(text: string, words: string[]): string {
  const tokens = new Set(words);
  const match = [...text.matchAll(/[\p{L}\p{N}]+/gu)].find((token) =>
    tokens.has(token[0].toLowerCase()),
  );
  const points = Array.from(text);
  const position = match ? Array.from(text.slice(0, match.index)).length : 0;
  const start = Math.max(0, Math.min(position - 90, points.length - 240));
  return points.slice(start, start + 240).join('');
}
