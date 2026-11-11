// Search over one person's items for a chat bot (WhatsApp W8, Telegram T8): by meaning with the
// engine host, exactly as the app ranks synced bundles, plus title keywords for items that are
// still being indexed (or for everything when the engine host is off).
import type { ObjectStore, PilotStore, StoredItem } from '../store';
import type { EngineHost } from '../whatsapp/engine-host';
import { ownerSearchItems } from '../whatsapp/indexer';
import { KIND_LABEL, clip, where, type ResultRow } from './channel';

/** Results in a search reply; the app shows five too. */
export const MAX_RESULTS = 5;

/** Lowercase words of three or more letters or digits, for keyword matching. */
const words = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= 3 || /^\d+$/.test(word)),
  );
/** How many of the query's words the title contains; 0 means no match. */
export function keywordScore(query: string, title: string) {
  const inTitle = [...words(title)];
  let score = 0;
  for (const word of words(query)) if (inTitle.some((w) => w.startsWith(word))) score++;
  return score;
}

/** The owner's live items. */
export async function liveItems(store: PilotStore, ownerKey: string) {
  const { changes } = await store.changesAfter(ownerKey, 0);
  const items: StoredItem[] = [];
  for (const globalId of new Set(changes.map((change) => change.item.globalId))) {
    const item = await store.getItem(ownerKey, globalId);
    if (item && !item.deleted) items.push(item);
  }
  return items;
}

export interface OwnerSearchOptions {
  store: PilotStore;
  objects: ObjectStore;
  /** Searches by meaning when set; otherwise search is by keyword only, and says so. */
  engine?: EngineHost;
  supportedIndexVersions?: readonly string[];
  log: (message: string, detail?: unknown) => void;
  /** Logged when the engine host fails and search falls back to keywords. */
  fallbackMessage: string;
}

/** Search results for an owner: by meaning when the engine is there, plus keyword matches. */
export async function searchOwner(options: OwnerSearchOptions, ownerKey: string, query: string) {
  const { store, objects, engine } = options;
  const items = await liveItems(store, ownerKey);
  const byId = new Map(items.map((item) => [item.globalId, item]));
  const rows: ResultRow[] = [];
  let keywordOnly = !engine;
  let indexed = new Set<string>();
  if (engine) {
    try {
      const searchable = await ownerSearchItems(
        store,
        objects,
        ownerKey,
        options.supportedIndexVersions,
      );
      indexed = new Set(searchable.map((item) => item.globalId));
      const hits = searchable.length ? await engine.search(query, searchable) : [];
      for (const hit of hits) {
        const item = byId.get(hit.globalId);
        if (!item) continue;
        const parts = [where(hit.location), hit.excerpt && clip(hit.excerpt, 60)].filter(Boolean);
        rows.push({
          globalId: hit.globalId,
          location: hit.location,
          title: item.title,
          description: parts.length ? parts.join(' · ') : (KIND_LABEL[item.kind] ?? item.kind),
        });
      }
    } catch (cause) {
      options.log(options.fallbackMessage, cause);
      keywordOnly = true;
      indexed = new Set();
    }
  }
  // Items not searchable by meaning yet (or at all, without the engine) match by title.
  const matches = items
    .filter((item) => !indexed.has(item.globalId))
    .map((item) => ({ item, score: keywordScore(query, item.title) }))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || b.item.createdAt - a.item.createdAt);
  for (const { item } of matches) {
    if (rows.length >= MAX_RESULTS) break;
    if (rows.some((row) => row.globalId === item.globalId)) continue;
    rows.push({
      globalId: item.globalId,
      location: { kind: 'whole' },
      title: item.title,
      description: `${KIND_LABEL[item.kind] ?? item.kind} · ${
        keywordOnly ? 'title match' : 'still indexing'
      }`,
    });
  }
  return { rows: rows.slice(0, MAX_RESULTS), keywordOnly };
}
