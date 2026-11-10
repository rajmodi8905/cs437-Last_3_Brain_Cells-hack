// S17: the IITGN campus pack is saved through the real local repository, from text that ships
// with the app. Each note names its official source, nothing is fetched, a second tap saves
// nothing new, a deleted note stays deleted and a failed save resumes where it stopped.
import { afterEach, expect, it, vi } from 'vitest';
import { CampusRecallDatabase, DexieLibraryRepository } from '../../src/storage';
import {
  addCampusPack,
  CAMPUS_PACK_CHECKED_ON,
  CAMPUS_PACK_NOTES,
  missingCampusNotes,
} from '../../src/app/campusPack';
import type { LibraryRepository } from '../../src/shared';

const databases: CampusRecallDatabase[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(databases.splice(0).map((db) => db.delete()));
});
function open(name = `campus-pack-${crypto.randomUUID()}`) {
  const database = new CampusRecallDatabase(name);
  databases.push(database);
  const repository = new DexieLibraryRepository(database);
  // The same preference store the app uses (services.ts).
  const preferences = {
    async get<T>(key: string) {
      return (await database.settings.get(key))?.value as T | undefined;
    },
    async set(key: string, value: unknown) {
      await database.settings.put({ key, value });
    },
  };
  return { repository, preferences, library: repository as LibraryRepository };
}
const OFFICIAL =
  /^https?:\/\/(?:[a-z0-9-]+\.)*iitgn\.ac\.in(?:\/|$)|^https:\/\/sites\.google\.com\/iitgn\.ac\.in\//;

it('[S17] the campus pack saves every note locally with its official source and fetches nothing', async () => {
  const fetch = vi.fn(async () => new Response(''));
  vi.stubGlobal('fetch', fetch);
  const services = open();
  expect(CAMPUS_PACK_NOTES.length).toBeGreaterThanOrEqual(8);
  expect(new Set(CAMPUS_PACK_NOTES.map((n) => n.key)).size).toBe(CAMPUS_PACK_NOTES.length);
  expect((await missingCampusNotes(services)).map((n) => n.key)).toEqual(
    CAMPUS_PACK_NOTES.map((n) => n.key),
  );

  const { items, failure } = await addCampusPack(services);
  expect(failure).toBeUndefined();
  expect(items).toHaveLength(CAMPUS_PACK_NOTES.length);
  const saved = await services.repository.listItems();
  expect(saved).toHaveLength(CAMPUS_PACK_NOTES.length);
  for (const note of CAMPUS_PACK_NOTES) {
    const item = saved.find((i) => i.title === note.title);
    expect(item, note.key).toBeDefined();
    expect(item!.kind).toBe('note');
    expect(item!.status).toBe('queued');
    const text = await (await services.repository.getOriginal(item!.id))!.text();
    expect(text).toBe(note.text);
    const sources = [...text.matchAll(/^Source: (\S+)$/gm)].map((m) => m[1]);
    expect(sources.length, note.key).toBeGreaterThan(0);
    for (const url of sources) expect(url, note.key).toMatch(OFFICIAL);
    expect(text).toContain(`Checked: ${CAMPUS_PACK_CHECKED_ON}.`);
    expect(text).toMatch(/not an official IITGN service/);
  }
  // The pack does not pretend to know what changes every semester.
  const exams = CAMPUS_PACK_NOTES.find((n) => n.key === 'exams')!.text;
  expect(exams).toMatch(/do not publish exam seating plans/);
  expect(await missingCampusNotes(services)).toEqual([]);
  expect(fetch).not.toHaveBeenCalled();
});

it('[S17] adding the pack again saves nothing new and a deleted pack note is never saved again', async () => {
  const services = open();
  await addCampusPack(services);
  const again = await addCampusPack(services);
  expect(again.items).toEqual([]);
  expect(await services.repository.listItems()).toHaveLength(CAMPUS_PACK_NOTES.length);

  const deleted = (await services.repository.listItems()).find(
    (i) => i.title === CAMPUS_PACK_NOTES[0].title,
  )!;
  await services.repository.deleteItem(deleted.id);
  const name = services.repository.database.name;
  services.repository.database.close();
  const reopened = open(name);
  await reopened.repository.open();
  expect(await missingCampusNotes(reopened)).toEqual([]);
  expect((await addCampusPack(reopened)).items).toEqual([]);
  const remaining = await reopened.repository.listItems();
  expect(remaining).toHaveLength(CAMPUS_PACK_NOTES.length - 1);
  expect(remaining.some((i) => i.title === deleted.title)).toBe(false);
});

it('[S17] a pack save that fails part way saves only the missing notes on retry', async () => {
  const services = open();
  const save = services.repository.save.bind(services.repository);
  let calls = 0;
  const broken = {
    ...services,
    library: {
      ...services.library,
      save: async (input: Parameters<typeof save>[0]) => {
        if (++calls === 4) throw new Error('Storage is full.');
        return save(input);
      },
    } as LibraryRepository,
  };
  const first = await addCampusPack(broken);
  expect(first.items).toHaveLength(3);
  expect(first.failure).toBeInstanceOf(Error);
  expect(await missingCampusNotes(services)).toHaveLength(CAMPUS_PACK_NOTES.length - 3);

  const retry = await addCampusPack(services);
  expect(retry.failure).toBeUndefined();
  expect(retry.items).toHaveLength(CAMPUS_PACK_NOTES.length - 3);
  const titles = (await services.repository.listItems()).map((i) => i.title).sort();
  expect(titles).toEqual(CAMPUS_PACK_NOTES.map((n) => n.title).sort());
});
