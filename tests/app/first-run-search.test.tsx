// @vitest-environment jsdom
// First five minutes: searching before offline search is set up asks for the download in place,
// shows plain size progress, recovers from a stopped download and then runs the typed search.
// The engine is an injected stub, so no model asset is downloaded here.
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../../src/ui/App';
import type { CampusRecallServices } from '../../src/app/services';
import type { LibraryItem, ProgressListener } from '../../src/shared';
import { AppOperationError } from '../../src/shared';

const TOTAL = 445_160_734;
const RAW_ASSET = 'embeddinggemma-2-ONNX/onnx/model_q4.onnx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubServices(items: LibraryItem[] = []) {
  let listener: ProgressListener | undefined;
  let finishSetup: (() => void) | undefined;
  let failSetup: ((cause: Error) => void) | undefined;
  const engine = {
    ready: false,
    downloadBytes: TOTAL,
    search: vi.fn(async (query: string) => {
      if (!engine.ready)
        throw new AppOperationError({
          code: 'MODEL_NOT_READY',
          message:
            'Set up offline search in Settings first. Saved originals are available in Library.',
          retryable: false,
        });
      return [
        {
          itemId: 'note-one',
          segmentId: 'segment-one',
          location: { kind: 'whole' as const },
          matchKind: 'text' as const,
          excerpt: `Excerpt found for ${query}`,
          score: 0.8,
        },
      ];
    }),
    setupModels: vi.fn(
      () =>
        new Promise<void>((resolve, reject) => {
          finishSetup = () => {
            engine.ready = true;
            resolve();
          };
          failSetup = reject;
        }),
    ),
    indexItem: vi.fn(async () => {}),
    cancelItem: vi.fn(async () => {}),
    subscribeProgress: (next: ProgressListener) => {
      listener = next;
      return () => {};
    },
    dispose: vi.fn(async () => {}),
  };
  const services: CampusRecallServices = {
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
      getItem: async () => items[0],
      getOriginal: vi.fn(async () => ({ text: async () => 'Original text' }) as Blob),
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
  return {
    services,
    engine,
    emit: (loadedBytes: number, message = RAW_ASSET) =>
      act(() => listener?.({ stage: 'setup', loadedBytes, totalBytes: TOTAL, message })),
    finish: () => act(async () => finishSetup?.()),
    fail: (message: string) => act(async () => failSetup?.(new Error(message))),
  };
}

const note: LibraryItem = {
  id: 'note-one',
  kind: 'note',
  title: 'Lab rules',
  mimeType: 'text/plain',
  byteLength: 40,
  contentSha256: 'fixture',
  originalBlobId: 'original-one',
  createdAt: 1,
  status: 'queued',
  processingGeneration: 1,
};

async function searchFor(services: CampusRecallServices, text: string) {
  render(<App services={services} />);
  await waitFor(() => expect(services.initialize).toHaveBeenCalledOnce());
  fireEvent.change(screen.getByRole('textbox', { name: 'Search saved information' }), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
}

it('asks for the one-time download on Search instead of showing a global error', async () => {
  window.location.hash = '/library';
  const stub = stubServices([note]);
  await searchFor(stub.services, 'lab access card');
  const card = await screen.findByRole('region', { name: 'Search needs a one-time download' });
  expect(card.textContent).toContain('445 MB');
  expect(card.textContent).toMatch(/Wi-Fi/);
  expect(card.textContent).toContain('lab access card');
  expect(screen.getByRole('button', { name: 'Download search (445 MB)' })).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByText(/Set up offline search in Settings first/)).toBeNull();
  // The card replaces the setup banner here, and nothing matches the Settings button label.
  expect(screen.queryByText('Processing and search run on this device.')).toBeNull();
  expect(screen.queryByRole('button', { name: /Download offline search/ })).toBeNull();
  // Spec S7: the download starts only when the student presses the button.
  expect(stub.engine.setupModels).not.toHaveBeenCalled();
});

it('shows plain size progress, then runs the typed search when setup finishes', async () => {
  window.location.hash = '/search';
  const stub = stubServices([{ ...note, status: 'ready' }]);
  await searchFor(stub.services, 'lab access card');
  fireEvent.click(await screen.findByRole('button', { name: 'Download search (445 MB)' }));
  expect(stub.engine.setupModels).toHaveBeenCalledOnce();
  stub.emit(212_400_000);
  expect(await screen.findByText('Downloading search · 212 of 445 MB')).toBeTruthy();
  expect(screen.queryByText(new RegExp(RAW_ASSET))).toBeNull();
  const bar = screen.getByRole('progressbar', { name: 'Offline setup download' });
  expect(bar.getAttribute('value')).toBe('212400000');
  expect(bar.getAttribute('max')).toBe(String(TOTAL));
  expect(screen.getByText(/Keep the app open/)).toBeTruthy();
  stub.emit(TOTAL);
  expect(await screen.findByText('Getting search ready…')).toBeTruthy();
  await stub.finish();
  expect(await screen.findByText('Excerpt found for lab access card')).toBeTruthy();
  expect(stub.engine.search).toHaveBeenLastCalledWith('lab access card', undefined);
  expect(screen.queryByRole('region', { name: 'Search needs a one-time download' })).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('keeps a stopped download in the card with a plain message and a retry', async () => {
  window.location.hash = '/search';
  const stub = stubServices();
  await searchFor(stub.services, 'exam timetable');
  fireEvent.click(await screen.findByRole('button', { name: 'Download search (445 MB)' }));
  stub.emit(212_400_000);
  await stub.fail(`Could not download ${RAW_ASSET}. Retry when connected.`);
  const card = await screen.findByRole('region', { name: 'Search needs a one-time download' });
  expect(card.textContent).toMatch(/download stopped/i);
  expect(card.textContent).not.toContain(RAW_ASSET);
  expect(screen.queryByRole('alert')).toBeNull();
  const retry = screen.getByRole('button', { name: 'Resume download (233 MB left)' });
  fireEvent.click(retry);
  expect(stub.engine.setupModels).toHaveBeenCalledTimes(2);
});

it('explains why a saved item waits and points the Library banner at Search', async () => {
  window.location.hash = '/library';
  const stub = stubServices([note]);
  const { container } = render(<App services={stub.services} />);
  await waitFor(() => expect(stub.services.initialize).toHaveBeenCalledOnce());
  await screen.findByText('Waiting for search setup.');
  expect(container.querySelector('.item-row .status')?.textContent).toBe('Queued');
  const link = screen.getByRole('link', { name: /Set up offline search/ });
  expect(link.getAttribute('href')).toBe('#/search');
});

it('shows plain copy and size progress in Settings, with the same setup action', async () => {
  window.location.hash = '/settings';
  const stub = stubServices();
  render(<App services={stub.services} />);
  await waitFor(() => expect(stub.services.initialize).toHaveBeenCalledOnce());
  await screen.findByText(
    /Downloaded once \(445 MB\), then processing and search run on this device\./,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Download offline search' }));
  expect(stub.engine.setupModels).toHaveBeenCalledOnce();
  stub.emit(100_000_000);
  expect(await screen.findByText('Downloading search · 100 of 445 MB')).toBeTruthy();
  expect(screen.queryByText(new RegExp(RAW_ASSET))).toBeNull();
});
