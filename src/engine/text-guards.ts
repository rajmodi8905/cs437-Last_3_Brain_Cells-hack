/** OCR of a text-free image yields fragments like "yA" or "[|"; keep text only when it has real words. */
export function meaningfulOcrText(text: string): string {
  const words = text.match(/[\p{L}\p{N}]{3,}/gu) ?? [];
  return words.join('').length >= 4 ? text.trim() : '';
}
/** A query needs at least two letters or digits; "a" or "?" cannot describe an original. */
export function isSearchableQuery(query: string): boolean {
  return (query.match(/[\p{L}\p{N}]/gu) ?? []).length >= 2;
}
