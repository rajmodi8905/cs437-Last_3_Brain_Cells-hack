// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../../src/ui/App';
import type { CampusRecallServices } from '../../src/app/services';
import type { LibraryItem } from '../../src/shared';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('a replacement view can search and open the exact source using only injected service contracts', async () => {
  const OriginalURL = globalThis.URL;
  vi.stubGlobal(
    'URL',
    Object.assign(class extends OriginalURL {}, {
      createObjectURL: vi.fn(() => 'blob:isolated-ui-test'),
      revokeObjectURL: vi.fn(),
    }),
  );
  window.location.hash = '/search';
  const item: LibraryItem = {
    id: 'source-one',
    kind: 'note',
    title: 'Study note',
    mimeType: 'text/plain',
    byteLength: 33,
    contentSha256: 'fixture',
    originalBlobId: 'original-one',
    createdAt: 1,
    status: 'ready',
    processingGeneration: 1,
  };
  const getOriginal = vi.fn(
    async () => ({ text: async () => 'Distinct original from the injected library.' }) as Blob,
  );
  const search = vi.fn(async () => [
    {
      itemId: item.id,
      segmentId: 'segment-one',
      location: { kind: 'whole' as const },
      matchKind: 'text' as const,
      excerpt: 'Independent UI fixture excerpt',
      score: 0.8,
    },
  ]);
  const services: CampusRecallServices = {
    initialize: vi.fn(async () => {}),
    subscribeLibrary(next) {
      next([item]);
      return () => {};
    },
    preferences: { get: async <T,>() => true as T, set: async () => {} },
    library: {
      save: vi.fn(),
      getItem: async () => item,
      getOriginal,
      listItems: async () => [item],
      renameItem: vi.fn(),
      deleteItem: vi.fn(),
      exportItems: vi.fn(),
      importArchive: vi.fn(),
    },
    engine: {
      ready: true,
      downloadBytes: 1,
      search,
      setupModels: vi.fn(),
      indexItem: vi.fn(),
      cancelItem: vi.fn(),
      subscribeProgress: () => () => {},
      dispose: vi.fn(),
    },
    capture: { captureWebpage: vi.fn(), extractHtml: vi.fn(), validateWebUrl: vi.fn() },
  };
  render(<App services={services} />);
  await waitFor(() => expect(services.initialize).toHaveBeenCalledOnce());
  fireEvent.change(screen.getByRole('textbox', { name: 'Search saved information' }), {
    target: { value: 'course group size' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  await screen.findByText('Independent UI fixture excerpt');
  expect(search).toHaveBeenCalledWith('course group size', undefined);
  fireEvent.click(screen.getByRole('button', { name: /^Study note/ }));
  await screen.findByText('Distinct original from the injected library.');
  expect(getOriginal).toHaveBeenCalledWith('source-one');
});
