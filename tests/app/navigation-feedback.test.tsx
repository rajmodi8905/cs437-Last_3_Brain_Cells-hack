// @vitest-environment jsdom
// Screen changes, search results and errors in the single-page app: focus moves to the new
// screen's heading, results are announced without moving focus, stale errors clear, errors
// are plain sentences and quiet actions confirm what happened. The engine is an injected stub.
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/ui/App';
import type { CampusRecallServices } from '../../src/app/services';
import type { LibraryItem, ProgressListener, SearchResult } from '../../src/shared';
import { AppOperationError } from '../../src/shared';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const note: LibraryItem = {
  id: 'note-one',
  kind: 'note',
  title: 'Mess timings',
  mimeType: 'text/plain',
  byteLength: 40,
  contentSha256: 'fixture',
  originalBlobId: 'original-one',
  createdAt: 1,
  status: 'ready',
  processingGeneration: 1,
};

function stubServices(items: LibraryItem[] = [note], found: SearchResult[] = []) {
  let listener: ProgressListener | undefined;
  const engine = {
    ready: true,
    downloadBytes: 1000,
    search: vi.fn(async () => found),
    setupModels: vi.fn(async () => {}),
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
      getOriginal: vi.fn(async () => new Blob(['Original text'], { type: 'text/plain' })),
      listItems: async () => items,
      renameItem: vi.fn(async () => {
        throw new AppOperationError({
          code: 'INVALID_INPUT',
          message: 'Title must be between one and 120 Unicode code points.',
          retryable: false,
        });
      }),
      deleteItem: vi.fn(),
      exportItems: vi.fn(async () => new Blob(['zip'])),
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
    emit: (event: Parameters<ProgressListener>[0]) => act(() => listener?.(event)),
  };
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
const heading = () => screen.getByRole('heading', { level: 1 });

it('moves focus to the new heading and names the screen in the title, but not on first load', async () => {
  const { services } = stubServices();
  await start(services);
  expect(document.activeElement).not.toBe(heading());
  expect(document.title).toBe('Library · Campus Recall');
  for (const [hash, title, name] of [
    ['/settings', 'Settings', 'Settings'],
    ['/add', 'Add to library', 'Add to your library'],
    ['/search', 'Search', 'Find your saved information'],
    ['/nowhere', 'Page not found', 'Page not found'],
    ['/library', 'Library', 'Your library'],
  ]) {
    await go(hash);
    await waitFor(() => expect(heading().textContent).toBe(name));
    expect(document.title).toBe(`${title} · Campus Recall`);
    expect(document.activeElement).toBe(heading());
    expect(heading().getAttribute('tabindex')).toBe('-1');
  }
  await go('/privacy');
  const policy = await screen.findByRole('heading', { level: 1, name: 'Privacy Policy' });
  expect(document.title).toBe('Privacy Policy · Campus Recall');
  await waitFor(() => expect(document.activeElement).toBe(policy));
  await go('/terms');
  await waitFor(() => expect(document.title).toBe('Terms and Conditions · Campus Recall'));
});

it('keeps focus in the search box and announces how many results were found', async () => {
  const result: SearchResult = {
    itemId: note.id,
    segmentId: 'segment-one',
    location: { kind: 'whole' },
    matchKind: 'text',
    excerpt: 'Dinner is served from 7:30 pm.',
    score: 0.8,
  };
  const { services } = stubServices([note], [result]);
  await start(services);
  const box = screen.getByRole('textbox', { name: 'Search saved information' });
  box.focus();
  fireEvent.change(box, { target: { value: 'mess timings' } });
  fireEvent.submit(box.closest('form')!);
  const status = await screen.findByText('1 result for “mess timings”');
  expect(status.closest('[role="status"]')).toBeTruthy();
  expect(document.activeElement).toBe(box);
  expect(document.title).toBe('Search · Campus Recall');

  (services.engine.search as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
  fireEvent.change(box, { target: { value: 'boat club' } });
  fireEvent.submit(box.closest('form')!);
  expect(await screen.findByText('No strong matches for “boat club”')).toBeTruthy();
  expect(document.activeElement).toBe(box);
});

it('shows a raw error as a plain sentence with details, and clears it on the next screen', async () => {
  const { services } = stubServices();
  await start(services);
  fireEvent.click(screen.getByRole('button', { name: 'Actions for Mess timings' }));
  fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
  fireEvent.submit(screen.getByRole('dialog'));
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toMatch(/120 characters/);
  expect(alert.textContent).not.toMatch(/^Title must be between/);
  const details = within(alert).getByText('Show details');
  expect(details.closest('details')?.textContent).toContain(
    'Title must be between one and 120 Unicode code points.',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await go('/settings');
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
});

it('shows an engine failure that is not tied to an item', async () => {
  const { services, emit } = stubServices();
  await start(services);
  emit({
    stage: 'failed',
    message:
      'This browser does not support safe processing locks. Use a current Safari, Chrome or Firefox.',
  });
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toMatch(/Safari, Chrome or Firefox/);
  expect(alert.textContent?.split('Show details')[0]).not.toMatch(/locks/);
});

it('confirms Retry processing and Cancel processing', async () => {
  const failed: LibraryItem = {
    ...note,
    id: 'failed-one',
    title: 'Broken scan',
    status: 'failed',
    error: { code: 'EXTRACTION_FAILED', message: 'Could not read it.', retryable: true },
  };
  const queued: LibraryItem = {
    ...note,
    id: 'queued-one',
    title: 'Waiting scan',
    status: 'queued',
  };
  const { services, engine } = stubServices([failed, queued]);
  await start(services);
  fireEvent.click(screen.getByRole('button', { name: 'Actions for Broken scan' }));
  fireEvent.click(screen.getByRole('button', { name: 'Retry processing' }));
  await waitFor(() => expect(engine.indexItem).toHaveBeenCalledWith('failed-one'));
  expect((await screen.findByRole('status')).textContent).toMatch(/processing again/i);
  fireEvent.click(screen.getByRole('button', { name: 'Actions for Waiting scan' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel processing' }));
  await waitFor(() => expect(engine.cancelItem).toHaveBeenCalledWith('queued-one'));
  await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/cancelled/i));
});

it('confirms Download original and the per-item backup in the viewer', async () => {
  // jsdom has no object URLs; the viewer and the download helper only need a placeholder.
  Object.assign(URL, { createObjectURL: () => 'blob:placeholder', revokeObjectURL: () => {} });
  const { services } = stubServices();
  await start(services);
  fireEvent.click(await screen.findByRole('button', { name: /^Mess timings/ }));
  const viewer = await screen.findByRole('region', { name: 'Mess timings' });
  fireEvent.click(await within(viewer).findByRole('button', { name: 'Download original' }));
  expect((await screen.findByRole('status')).textContent).toMatch(/download/i);
  fireEvent.click(within(viewer).getByRole('button', { name: 'Export this item as backup' }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/backup/i));
});
