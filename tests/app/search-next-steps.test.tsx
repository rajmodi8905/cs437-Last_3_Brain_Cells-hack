// @vitest-environment jsdom
// Search never ends in a dead end: "No strong matches" offers concrete next steps (search all
// types, the items still getting ready, a shorter search), an empty search says what to type,
// and the last five searches that found something are kept on this device only, with a
// remove button for each, Clear, and a Settings switch that turns them off and clears them.
// Weak matches stay hidden: the engine's empty answer is shown as no results.
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/ui/App';
import type { CampusRecallServices } from '../../src/app/services';
import type { ItemKind, LibraryItem, SearchResult } from '../../src/shared';

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

const item = (id: string, kind: ItemKind, status: LibraryItem['status']): LibraryItem => ({
  id,
  kind,
  title: `Saved ${id}`,
  mimeType: kind === 'pdf' ? 'application/pdf' : 'text/plain',
  byteLength: 40,
  contentSha256: id,
  originalBlobId: `original-${id}`,
  createdAt: 1,
  status,
  processingGeneration: 1,
});
const hit = (itemId: string): SearchResult => ({
  itemId,
  segmentId: `segment-${itemId}`,
  location: { kind: 'whole' },
  matchKind: 'text',
  excerpt: 'Dinner is served from 7:30 pm.',
  score: 0.8,
});

function stubServices(
  items: LibraryItem[],
  answer: (query: string, kind?: ItemKind) => SearchResult[],
  stored: [string, unknown][] = [],
) {
  const preferences = new Map<string, unknown>([['intro-seen', true], ...stored]);
  const engine = {
    ready: true,
    downloadBytes: 1000,
    search: vi.fn(async (query: string, kind?: ItemKind) => answer(query, kind)),
    setupModels: vi.fn(async () => {}),
    indexItem: vi.fn(async () => {}),
    cancelItem: vi.fn(async () => {}),
    subscribeProgress: () => () => {},
    dispose: vi.fn(async () => {}),
  };
  const services: CampusRecallServices = {
    initialize: vi.fn(async () => {}),
    subscribeLibrary(next) {
      next(items);
      return () => {};
    },
    preferences: {
      get: async <T,>(key: string) => preferences.get(key) as T | undefined,
      set: vi.fn(async (key: string, value: unknown) => void preferences.set(key, value)),
    },
    library: {
      save: vi.fn(),
      getItem: async () => items[0],
      getOriginal: vi.fn(async () => new Blob(['Original text'], { type: 'text/plain' })),
      listItems: async () => items,
      renameItem: vi.fn(),
      deleteItem: vi.fn(),
      exportItems: vi.fn(),
      importArchive: vi.fn(),
    },
    engine: engine as unknown as CampusRecallServices['engine'],
    capture: {
      captureWebpage: vi.fn(),
      extractHtml: vi.fn(),
      extractPdfText: vi.fn(),
      validateWebUrl: vi.fn(),
    },
  };
  return { services, engine, preferences };
}
async function start(services: CampusRecallServices, hash = '/library') {
  window.location.hash = hash;
  render(<App services={services} />);
  await waitFor(() => expect(services.initialize).toHaveBeenCalledOnce());
}
const go = (hash: string) =>
  act(async () => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
const box = () => screen.getByRole('textbox', { name: 'Search saved information' });
async function search(text: string) {
  fireEvent.change(box(), { target: { value: text } });
  fireEvent.submit(box().closest('form')!);
  await screen.findByText(/^(1 result|\d+ results|No strong matches) for “/);
}

it('"No strong matches" offers all types, says what is still getting ready and suggests a shorter search', async () => {
  const items = [
    item('ready-note', 'note', 'ready'),
    item('queued-pdf', 'pdf', 'queued'),
    item('waiting-pdf', 'pdf', 'queued'),
    item('busy-note', 'note', 'processing'),
  ];
  const { services, engine } = stubServices(items, (_, kind) => (kind ? [] : [hit('ready-note')]));
  await start(services);
  fireEvent.click(screen.getByRole('button', { name: /^PDFs/ }));
  await search('boat club');
  expect(screen.getByRole('heading', { name: /No strong matches/ })).toBeTruthy();
  // The honest copy stays, with next steps under it.
  expect(screen.getByText(/This does not mean you never saved it\./)).toBeTruthy();
  expect(
    screen.getByText('3 items are still getting ready and are not searchable yet.'),
  ).toBeTruthy();
  expect(
    screen.getByText(
      'Try fewer or different words, such as a course code or a phrase you remember.',
    ),
  ).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Browse your library' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Search all types' }));
  await screen.findByText('1 result for “boat club”');
  expect(engine.search).toHaveBeenLastCalledWith('boat club', undefined);
  expect(screen.getByRole('button', { name: /^All files/ }).getAttribute('aria-pressed')).toBe(
    'true',
  );
});

it('without a type filter or waiting items, no-match next steps leave those lines out', async () => {
  const { services } = stubServices([item('ready-note', 'note', 'ready')], () => []);
  await start(services);
  await search('boat club');
  expect(screen.queryByRole('button', { name: 'Search all types' })).toBeNull();
  expect(screen.queryByText(/still getting ready/)).toBeNull();
  expect(screen.getByText(/^Try fewer or different words/)).toBeTruthy();
});

it('one waiting item is described in the singular', async () => {
  const { services } = stubServices(
    [item('ready-note', 'note', 'ready'), item('queued-pdf', 'pdf', 'queued')],
    () => [],
  );
  await start(services);
  await search('boat club');
  expect(screen.getByText('1 item is still getting ready and is not searchable yet.')).toBeTruthy();
});

it('an empty search keeps focus in the box and says what to type', async () => {
  const { services, engine } = stubServices([item('ready-note', 'note', 'ready')], () => []);
  await start(services);
  const input = box();
  fireEvent.change(input, { target: { value: '   ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  const hint = await screen.findByText('Type what you remember, then search.');
  expect(document.activeElement).toBe(input);
  expect(input.getAttribute('aria-describedby')).toBe(hint.id);
  expect(engine.search).not.toHaveBeenCalled();
  expect(window.location.hash).toBe('#/library');
  fireEvent.change(input, { target: { value: 'mess' } });
  expect(screen.queryByText('Type what you remember, then search.')).toBeNull();
});

it('keeps the last five distinct searches that found something, on this device only', async () => {
  const empty = new Set(['boat club']);
  const { services, engine, preferences } = stubServices(
    [item('ready-note', 'note', 'ready')],
    (query) => (empty.has(query) ? [] : [hit('ready-note')]),
  );
  await start(services, '/search');
  expect(screen.queryByRole('heading', { name: 'Recent searches' })).toBeNull();
  for (const text of [
    'mess timings',
    'boat club',
    'library hours',
    'wifi password',
    'hostel rules',
    'Mess Timings',
    'exam hall',
    'bus times',
  ])
    await search(text);
  // Clearing the box shows the start of Search again, with the recent searches.
  fireEvent.change(box(), { target: { value: '' } });
  const recent = screen.getByRole('list', { name: 'Recent searches' });
  const runButtons = within(recent)
    .getAllByRole('button')
    .filter((button) => !button.getAttribute('aria-label')?.startsWith('Remove'));
  expect(runButtons.map((button) => button.textContent)).toEqual([
    'bus times',
    'exam hall',
    'Mess Timings',
    'hostel rules',
    'wifi password',
  ]);
  // Stored only through this device's preferences.
  expect(preferences.get('recent-searches')).toEqual([
    'bus times',
    'exam hall',
    'Mess Timings',
    'hostel rules',
    'wifi password',
  ]);
  engine.search.mockClear();
  fireEvent.click(within(recent).getByRole('button', { name: 'hostel rules' }));
  await screen.findByText('1 result for “hostel rules”');
  expect(engine.search).toHaveBeenCalledWith('hostel rules', undefined);
  expect((box() as HTMLInputElement).value).toBe('hostel rules');
});

it('removes one recent search, clears them all, and the Settings switch turns them off', async () => {
  const { services, preferences } = stubServices(
    [item('ready-note', 'note', 'ready')],
    () => [hit('ready-note')],
    [['recent-searches', ['bus times', 'exam hall']]],
  );
  await start(services, '/search');
  const recent = await screen.findByRole('list', { name: 'Recent searches' });
  fireEvent.click(
    within(recent).getByRole('button', { name: 'Remove “bus times” from recent searches' }),
  );
  await waitFor(() => expect(preferences.get('recent-searches')).toEqual(['exam hall']));
  fireEvent.click(screen.getByRole('button', { name: 'Clear recent searches' }));
  await waitFor(() => expect(preferences.get('recent-searches')).toEqual([]));
  expect(screen.queryByRole('list', { name: 'Recent searches' })).toBeNull();

  await search('mess timings');
  expect(preferences.get('recent-searches')).toEqual(['mess timings']);
  await go('/settings');
  const remember = screen.getByRole('switch', { name: 'Remember recent searches' });
  expect((remember as HTMLInputElement).checked).toBe(true);
  fireEvent.click(remember);
  await waitFor(() => expect(preferences.get('recent-searches')).toEqual([]));
  expect(preferences.get('remember-recent-searches')).toBe(false);
  expect((remember as HTMLInputElement).checked).toBe(false);
  await go('/search');
  await search('exam hall');
  expect(preferences.get('recent-searches')).toEqual([]);
  fireEvent.change(box(), { target: { value: '' } });
  expect(screen.queryByRole('list', { name: 'Recent searches' })).toBeNull();
});
