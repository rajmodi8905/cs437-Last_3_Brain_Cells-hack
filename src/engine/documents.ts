import type { LibraryItem } from '../shared';
/** A filename-derived/display-only note title is not a second copy of its content. */
export function embeddingTitle(item: Pick<LibraryItem, 'kind' | 'title'>, text: string): string {
  if (item.kind === 'note') {
    const firstLine = Array.from(text.split(/\r?\n/, 1)[0].trim()).slice(0, 120).join('');
    if (firstLine === item.title) return 'none';
  }
  return item.title || 'none';
}
