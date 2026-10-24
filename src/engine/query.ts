/** Use the pinned export's documented asymmetric search prefix. No text is generated. */
export function formatQuery(query: string): string {
  return `task: search result | query: ${query.trim()}`;
}
