// Ranking with a search model's own calibrated thresholds (S16). EmbeddingGemma keeps the frozen
// rankSegments exactly. Another model uses the same eligibility, lexical boost, grouping,
// tie-breaking and five-result cap, with its thresholds instead of EmbeddingGemma's; a test checks
// that this produces identical results to rankSegments when given EmbeddingGemma's thresholds.
import type { SearchableSegment, SearchResult } from '../shared';
import { THRESHOLDS, cosine, rankSegments, sourceExcerpt } from './ranking';

export type Thresholds = { text: number; visual: number };

/** rankSegments with explicit thresholds. Exported for the equivalence test. */
export function rankByThresholds(
  query: Float32Array,
  segments: SearchableSegment[],
  text: string,
  thresholds: Thresholds,
): SearchResult[] {
  const words = [...new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])];
  const grouped = new Map<string, SearchResult>();
  for (const segment of segments) {
    const similarity = cosine(query, segment.vector);
    if (similarity < thresholds[segment.modality]) continue;
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

export function rankForModel(
  query: Float32Array,
  segments: SearchableSegment[],
  text: string,
  thresholds: Thresholds,
): SearchResult[] {
  return thresholds.text === THRESHOLDS.text && thresholds.visual === THRESHOLDS.visual
    ? rankSegments(query, segments, text)
    : rankByThresholds(query, segments, text, thresholds);
}
