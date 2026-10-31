import { it, expect } from 'vitest';
import { isSearchableQuery, meaningfulImageOcrText } from '../../src/engine/text-guards';
// Text and page confidences measured with the bundled Tesseract on QA-kit images and rendered labels.
it('drops OCR noise from text-free images', () => {
  expect(meaningfulImageOcrText('[|\nTT', 59)).toBe(''); // sample-07
  expect(meaningfulImageOcrText('yA', 9)).toBe(''); // sample-08
  expect(meaningfulImageOcrText('A', 96)).toBe(''); // sample-25
});
it('keeps short real labels read from images', () => {
  for (const [label, confidence] of [
    ['CS 437', 94],
    ['AI ML', 70],
    ['Lab', 95],
    ['No 10', 94],
    ['101', 96],
    ['EXIT', 95],
    ['Hi', 96],
  ] as const)
    expect(meaningfulImageOcrText(` ${label}\n`, confidence)).toBe(label);
});
it('treats one-character, punctuation-only and repeated-character queries as unsearchable', () => {
  for (const query of ['a', '?', ' ', '!!!', 'é', 'xxxxxxxxxx', 'x'.repeat(1000), 'AAaa'])
    expect(isSearchableQuery(query)).toBe(false);
  for (const query of ['AI', 'MA101', 'red bag', 'मेस'])
    expect(isSearchableQuery(query)).toBe(true);
});
