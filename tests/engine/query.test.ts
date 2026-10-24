import { it, expect } from 'vitest';
import { formatQuery } from '../../src/engine/query';
it('preserves questions and descriptions with the documented retrieval prefix', () => {
  expect(formatQuery(' Where is the collection desk? ')).toBe(
    'task: search result | query: Where is the collection desk?',
  );
  expect(formatQuery('a red bag')).toBe('task: search result | query: a red bag');
});
