/**
 * Tesseract page confidence below this marks OCR of a text-free image. Measured on the QA kit:
 * noise scored 9 and 59; short real labels ("AI ML", "CS 437", "Lab", "101") scored 70-96.
 */
export const MIN_IMAGE_OCR_CONFIDENCE = 65;
/**
 * Keeps image OCR only when Tesseract is confident and at least two letters or digits were read,
 * so fragments like "yA", "[| TT" or a lone "A" are not indexed. Short labels are kept; the image
 * is still searchable through its visual vector either way.
 */
export function meaningfulImageOcrText(text: string, confidence: number): string {
  const characters = text.match(/[\p{L}\p{N}]/gu) ?? [];
  return confidence >= MIN_IMAGE_OCR_CONFIDENCE && characters.length >= 2 ? text.trim() : '';
}
/** "a", "?" or one character repeated ("xxxx") cannot describe an original, so it is not searched. */
export function isSearchableQuery(query: string): boolean {
  const characters = query.toLocaleLowerCase().match(/[\p{L}\p{N}]/gu) ?? [];
  return characters.length >= 2 && new Set(characters).size >= 2;
}
