// @vitest-environment jsdom
// S16: Settings keeps EmbeddingGemma as the default, lets a student add their own model, shows
// how it did on the sample questions, and switches only when they choose it.
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/ui/App';
import type { AnyRecallServices } from '../../src/app/services';
import type { LibraryItem } from '../../src/shared';
import { GEMMA, customSearchModel, type SearchModel } from '../../src/shared/searchModels';

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

const item = (id: string): LibraryItem => ({
  id,
  kind: 'note',
  title: `Note ${id}`,
  mimeType: 'text/plain',
  byteLength: 40,
  contentSha256: id,
  originalBlobId: `original-${id}`,
  createdAt: 1,
  status: 'ready',
  processingGeneration: 1,
});

const added = customSearchModel({
  repo: 'Xenova/bge-small-en-v1.5',
  revision: 'ea104dacec62c0de699686887e3f920caeb4f3e3',
  dtype: 'q8',
  pooling: 'mean',
  queryPrefix: '',
  documentPrefix: '',
  files: [
    {
      name: 'onnx/model_quantized.onnx',
      url: 'https://huggingface.co/Xenova/bge-small-en-v1.5/resolve/ea104dacec62c0de699686887e3f920caeb4f3e3/onnx/model_quantized.onnx',
      bytes: 34_014_426,
      sha256: 'a'.repeat(64),
    },
  ],
  dimension: 384,
  threshold: 0.52,
  calibration: { correct: 7, total: 8, unrelatedMatched: 3, unrelatedTotal: 8 },
});

function stubServices(items: LibraryItem[], addCustomModel: (...args: any[]) => Promise<any>) {
  let current: SearchModel = GEMMA;
  const engine = {
    ready: true,
    get downloadBytes() {
      return current === GEMMA ? 445_160_734 : 164_069_914;
    },
    get searchModel() {
      return current;
    },
    customModel: undefined,
    downloadBytesFor: (model: SearchModel) => (model === GEMMA ? 445_160_734 : 164_069_914),
    addCustomModel: vi.fn(addCustomModel),
    setSearchModel: vi.fn(async (model: SearchModel) => {
      current = model;
    }),
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
  return { services, engine };
}

async function openSettings(services: AnyRecallServices) {
  window.location.hash = '/settings';
  render(<App services={services} />);
  await waitFor(() => expect(services.initialize).toHaveBeenCalledOnce());
  return screen.findByRole('radiogroup', { name: 'Search model' });
}

it('[S16] Settings keeps EmbeddingGemma by default, adds a tested model, and switches only when chosen', async () => {
  const { services, engine } = stubServices([item('a'), item('b'), item('c')], async () => added);
  const group = await openSettings(services);
  const gemma = within(group).getByRole('radio', { name: /EmbeddingGemma \(default\)/ });
  expect((gemma as HTMLInputElement).checked).toBe(true);
  expect(group.textContent).toContain('445 MB');
  expect(within(group).queryAllByRole('radio')).toHaveLength(1);

  fireEvent.click(screen.getByText('Add your own model'));
  fireEvent.change(screen.getByLabelText('Hugging Face model ID'), {
    target: { value: 'Xenova/bge-small-en-v1.5' },
  });
  fireEvent.change(screen.getByLabelText('Pooling'), { target: { value: 'cls' } });
  fireEvent.click(screen.getByRole('button', { name: 'Download and test' }));
  await waitFor(() =>
    expect(engine.addCustomModel).toHaveBeenCalledWith(
      'Xenova/bge-small-en-v1.5',
      { pooling: 'cls' },
      expect.any(Function),
    ),
  );
  // The added model is offered with its test result, but EmbeddingGemma is still in use.
  const own = await within(group).findByRole('radio', { name: /Xenova\/bge-small-en-v1\.5/ });
  expect((own as HTMLInputElement).checked).toBe(true);
  expect(group.textContent).toContain(
    'found 7 of 8 sample questions and wrongly matched 3 of 8 unrelated ones',
  );
  expect(group.textContent).toMatch(/experimental/);
  expect(group.textContent).toContain('Uses mean pooling.');
  expect(group.textContent).toMatch(/not what is in a picture or video/);
  expect(engine.setSearchModel).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'Switch to Xenova/bge-small-en-v1.5' }));
  await waitFor(() => expect(engine.setSearchModel).toHaveBeenCalledWith(added));
  expect(
    await screen.findByText(/Switched to Xenova\/bge-small-en-v1\.5\. Re-indexing your 3 items/),
  ).toBeTruthy();
  // And back to the default.
  fireEvent.click(within(group).getByRole('radio', { name: /EmbeddingGemma \(default\)/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Switch to EmbeddingGemma (default)' }));
  await waitFor(() => expect(engine.setSearchModel).toHaveBeenLastCalledWith(GEMMA));
});

it('[S16] a model that cannot be used is explained, and search keeps its model', async () => {
  const { services, engine } = stubServices([item('a')], async () => {
    throw new Error(
      'Example/weak found only 4 of 8 sample questions, so search with it would be unreliable.',
    );
  });
  const group = await openSettings(services);
  fireEvent.click(screen.getByText('Add your own model'));
  fireEvent.change(screen.getByLabelText('Hugging Face model ID'), {
    target: { value: 'Example/weak' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Download and test' }));
  expect((await screen.findByRole('alert')).textContent).toMatch(/found only 4 of 8/);
  expect(within(group).queryAllByRole('radio')).toHaveLength(1);
  expect(engine.setSearchModel).not.toHaveBeenCalled();
});
