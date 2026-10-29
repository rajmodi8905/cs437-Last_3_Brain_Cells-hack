/** OCR of a text-free image yields fragments like "yA" or "[|"; keep text only when it has real words. */
export function meaningfulOcrText(text: string): string {
  const words = text.match(/[\p{L}\p{N}]{3,}/gu) ?? [];
  return words.join('').length >= 4 ? text.trim() : '';
}
/** "a", "?" or one character repeated ("xxxx") cannot describe an original, so it is not searched. */
export function isSearchableQuery(query: string): boolean {
  const characters = query.toLocaleLowerCase().match(/[\p{L}\p{N}]/gu) ?? [];
  return characters.length >= 2 && new Set(characters).size >= 2;
}
