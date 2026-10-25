import { it, expect } from 'vitest';
import { embeddingTitle } from '../../src/engine/documents';
it('does not duplicate an automatically derived note title in model input', () => {
  expect(
    embeddingTitle(
      { kind: 'note', title: 'A note about an excursion' },
      'A note about an excursion',
    ),
  ).toBe('none');
  expect(embeddingTitle({ kind: 'note', title: 'Field notes' }, 'A note about an excursion')).toBe(
    'Field notes',
  );
  expect(embeddingTitle({ kind: 'pdf', title: 'Guidelines' }, 'Guidelines')).toBe('Guidelines');
});
