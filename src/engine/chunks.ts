/** Tokens are obtained from the pinned model tokenizer, not estimated from words. */
export function chunkTokenIds(ids: number[], size = 256, overlap = 48): number[][] {
  if (size <= overlap || overlap < 0) throw new Error('Invalid chunk window.');
  const result: number[][] = [];
  for (let start = 0; start < ids.length; start += size - overlap) {
    result.push(ids.slice(start, start + size));
    if (start + size >= ids.length) break;
  }
  return result;
}
