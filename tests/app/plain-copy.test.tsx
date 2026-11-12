// @vitest-environment jsdom
// Plain words and small fixes: Settings counts items in correct English and describes browser
// storage without "quota", the install note has no "HTTPS or localhost", a library row shows
// a processing failure as a plain sentence, and Escape closes only the topmost layer: a
// Rename or Delete dialog over the viewer closes, and the viewer stays open.
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../../src/ui/App';
import type { AnyRecallServices } from '../../src/app/services';
import type { LibraryItem } from '../../src/shared';

const original = { storage: navigator.storage };
afterEach(() => {
  cleanup();
  Object.defineProperty(navigator, 'storage', { configurable: true, value: original.storage });
  window.location.hash = '';
});

const item = (id: string, title: string, extra: Partial<LibraryItem> = {}): LibraryItem => ({
  id,
  kind: 'note',
  title,
  mimeType: 'text/plain',
  byteLength: 40,
  contentSha256: id,
  originalBlobId: `original-${id}`,
  createdAt: 1,
  status: 'ready',
  processingGeneration: 1,
  ...extra,
});

function stubServices(items: LibraryItem[]) {
  const engine = {
    ready: true,
    downloadBytes: 445_000_000,
    search: vi.fn(async () => []),
    setupModels: vi.fn(async () => {}),
    indexItem: vi.fn(async () => {}),
    cancelItem: vi.fn(async () => {}),
    subscribeProgress: () => () => {},
    dispose: vi.fn(async () => {}),
  };
  const services: AnyRecallServices = {
    initialize: vi.fn(async () => {}),
    subscribeLibrary(next) {
      next(items);
      return () => {};
    },
    preferences: {
      get: async <T,>(key: string) => (key === 'intro-seen' ? (true as T) : undefined),
      set: async () => {},
    },
    library: {
      save: vi.fn(),
      getItem: async (id: string) => items.find((value) => value.id === id),
      getOriginal: vi.fn(async () => new Blob(['Original text'], { type: 'text/plain' })),
      listItems: async () => items,
      renameItem: vi.fn(),
      deleteItem: vi.fn(),
      exportItems: vi.fn(),
      importArchive: vi.fn(),
    },
    engine: engine as unknown as AnyRecallServices['engine'],
    capture: {
      captureWebpage: vi.fn(),
      extractHtml: vi.fn(),
      extractPdfText: vi.fn(),
      validateWebUrl: vi.fn(),
    },
  };
  return services;
}
async function start(services: AnyRecallServices, hash = '/library') {
  window.location.hash = hash;
  render(<App services={services} />);
  await waitFor(() => expect(services.initialize).toHaveBeenCalledOnce());
}

it('Settings counts one item in the singular and describes storage in plain words', async () => {
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: {
      estimate: async () => ({ usage: 460_000_000, quota: 2_400_000_000 }),
      persisted: async () => true,
      persist: async () => true,
    },
  });
  await start(stubServices([item('a', 'Mess timings')]), '/settings');
  expect(screen.getByText(/of saved originals · 1 item$/)).toBeTruthy();
  expect(
    await screen.findByText(
      'This browser is using 460.0 MB of about 2.4 GB it allows for this site, including the search download.',
    ),
  ).toBeTruthy();
  const page = document.querySelector('main')!.textContent!;
  expect(page).not.toMatch(/quota/i);
  expect(page).not.toMatch(/HTTPS or localhost/);
  // Pinned by an existing test: kept as it is.
  expect(page).toMatch(/MB of assets\. Model inference uses this device/);
});

it('a library row shows a processing failure as a plain sentence', async () => {
  await start(
    stubServices([
      item('raw', 'Raw failure', {
        status: 'failed',
        error: {
          code: 'EXTRACTION_FAILED',
          message: "TypeError: Cannot read properties of undefined (reading 'getPage')",
          retryable: true,
        },
      }),
      item('plain', 'Plain failure', {
        status: 'failed',
        error: {
          code: 'EXTRACTION_FAILED',
          message:
            'No searchable content was extracted. The original is still saved and can be opened.',
          retryable: true,
        },
      }),
      item('none', 'No reason', { status: 'failed' }),
    ]),
  );
  const messages = Array.from(document.querySelectorAll('.row-message')).map(
    (row) => row.textContent,
  );
  expect(messages).toEqual([
    'Processing failed. The original is still saved.',
    'No searchable content was extracted. The original is still saved and can be opened.',
    'Processing failed. The original is still saved.',
  ]);
});

it('Escape closes a Rename or Delete dialog over the viewer and leaves the viewer open', async () => {
  await start(stubServices([item('a', 'Mess timings')]));
  fireEvent.click(screen.getByRole('button', { name: /^Mess timings/ }));
  await screen.findByRole('region', { name: 'Mess timings' });
  for (const name of ['Rename', 'Delete']) {
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Mess timings' }));
    fireEvent.click(screen.getByRole('button', { name }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.keyDown(dialog.querySelector('input,button')!, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('region', { name: 'Mess timings' })).not.toBeNull();
  }
  fireEvent.keyDown(window, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Mess timings' })).toBeNull());
});
