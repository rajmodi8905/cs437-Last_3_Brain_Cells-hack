import { it, expect } from 'vitest';
import { isSearchableQuery, meaningfulOcrText } from '../../src/engine/text-guards';
it('drops OCR noise from text-free images but keeps short real text', () => {
  expect(meaningfulOcrText('yA')).toBe('');
  expect(meaningfulOcrText('A')).toBe('');
  expect(meaningfulOcrText('[|\nTT')).toBe('');
  expect(meaningfulOcrText(' EXIT ')).toBe('EXIT');
  expect(meaningfulOcrText('Room 204 closed')).toBe('Room 204 closed');
});
it('treats one-character, punctuation-only and repeated-character queries as unsearchable', () => {
  for (const query of ['a', '?', ' ', '!!!', 'é', 'xxxxxxxxxx', 'x'.repeat(1000), 'AAaa'])
    expect(isSearchableQuery(query)).toBe(false);
  for (const query of ['AI', 'MA101', 'red bag', 'मेस'])
    expect(isSearchableQuery(query)).toBe(true);
});
