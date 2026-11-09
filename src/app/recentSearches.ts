// Recent searches: the last few searches that found something, kept in this device's
// preferences only. They are never synced, exported or sent anywhere.
export const RECENT_SEARCHES = 'recent-searches';
export const REMEMBER_RECENT_SEARCHES = 'remember-recent-searches';
export const RECENT_SEARCH_LIMIT = 5;

/** A stored value read defensively: anything that is not a list of searches is ignored. */
export function readRecentSearches(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string' && !!entry.trim())
    .slice(0, RECENT_SEARCH_LIMIT);
}

/** Puts `text` first. The same words in another case replace the older entry. */
export function withRecentSearch(list: string[], text: string): string[] {
  const value = text.trim();
  if (!value) return list;
  const key = value.toLocaleLowerCase();
  return [value, ...list.filter((entry) => entry.toLocaleLowerCase() !== key)].slice(
    0,
    RECENT_SEARCH_LIMIT,
  );
}
