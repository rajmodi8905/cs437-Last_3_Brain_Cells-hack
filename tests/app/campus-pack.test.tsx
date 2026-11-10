// @vitest-environment jsdom
// S17: a fresh library offers the IITGN campus pack; one tap saves it through the library's
// normal save, says it was saved locally, and the offer goes away.
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../../src/ui/App';
import type { CampusRecallServices } from '../../src/app/services';
import { CAMPUS_PACK_NOTES } from '../../src/app/campusPack';
import type { LibraryItem, SaveInput } from '../../src/shared';

afterEach(() => cleanup());
// Ten saves re-render the whole app in jsdom; give this test, and its waits, room on a busy machine.
const WAIT = { timeout: 10_000 };

function stubServices() {
  let items: LibraryItem[] = [];
  const listeners = new Set<(next: LibraryItem[]) => void>();
  const stored = new Map<string, unknown>([['intro-seen', true]]);
  const save = vi.fn(async (input: SaveInput) => {
    const item: LibraryItem = {
      id: crypto.randomUUID(),
      kind: 'note',
      title: input.title ?? 'Note',
      mimeType: 'text/plain;charset=utf-8',
      byteLength: input.kind === 'note' ? input.text.length : 0,
      contentSha256: 'stub',
      originalBlobId: crypto.randomUUID(),
      createdAt: Date.now() + items.length,
      status: 'queued',
      processingGeneration: 0,
    };
    items = [item, ...items];
    for (const listener of listeners) listener(items);
    return item;
  });
  const engine = {
    ready: false,
    downloadBytes: 445_160_734,
    search: vi.fn(async () => []),
    setupModels: vi.fn(async () => {}),
    indexItem: vi.fn(async () => {}),
    cancelItem: vi.fn(async () => {}),
    subscribeProgress: () => () => {},
    dispose: vi.fn(async () => {}),
  };
  const services: CampusRecallServices = {
    initialize: vi.fn(async () => {}),
    subscribeLibrary(next) {
      listeners.add(next);
      next(items);
      return () => listeners.delete(next);
    },
    preferences: {
      get: async <T,>(key: string) => stored.get(key) as T | undefined,
      set: async (key, value) => {
        stored.set(key, value);
      },
    },
    library: {
      save,
      getItem: async (id) => items.find((i) => i.id === id),
      getOriginal: vi.fn(async () => undefined),
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
  return { services, save, engine };
}

it('[S17] a fresh library offers the campus pack and one tap saves it', async () => {
  window.location.hash = '/library';
  const stub = stubServices();
  render(<App services={stub.services} />);
  const offer = await screen.findByRole('button', { name: 'Add the IITGN campus pack' }, WAIT);
  expect(screen.getByText('No saved items yet.')).toBeTruthy();
  fireEvent.click(offer);
  await waitFor(() => expect(stub.save).toHaveBeenCalledTimes(CAMPUS_PACK_NOTES.length), WAIT);
  for (const note of CAMPUS_PACK_NOTES)
    expect(stub.save).toHaveBeenCalledWith({ kind: 'note', title: note.title, text: note.text });
  expect(
    await screen.findByText(
      `${CAMPUS_PACK_NOTES.length} items saved locally`,
      { exact: false },
      WAIT,
    ),
  ).toBeTruthy();
  expect(await screen.findByText(CAMPUS_PACK_NOTES[0].title, {}, WAIT)).toBeTruthy();
  await waitFor(
    () => expect(screen.queryByRole('button', { name: 'Add the IITGN campus pack' })).toBeNull(),
    WAIT,
  );
  expect(stub.engine.indexItem).toHaveBeenCalledTimes(CAMPUS_PACK_NOTES.length);
}, 20_000);
