// @vitest-environment jsdom
// A folder's summary stays true while the selection changes (PR #53 review): it counts only
// the folder's files still selected, and once they are all removed neither the summary nor
// the folder's skipped files are reported on save.
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Add } from '../../src/ui/Add';
import type { LibraryItem, SaveInput } from '../../src/shared';

afterEach(cleanup);

const file = (name: string, type: string) => new File(['x'], name, { type, lastModified: 1 });
const fileEntry = (value: File) => ({
  name: value.name,
  isFile: true,
  isDirectory: false,
  file: (success: (f: File) => void) => success(value),
});
function renderWithFolder() {
  const save = vi.fn(async (input: SaveInput): Promise<LibraryItem> => ({
    id: input.kind === 'file' ? input.file.name : 'note',
    kind: 'image',
    title: input.kind === 'file' ? input.file.name : 'note',
    mimeType: 'image/png',
    byteLength: 1,
    contentSha256: 'fixture',
    originalBlobId: 'original',
    createdAt: 1,
    status: 'queued',
    processingGeneration: 1,
  }));
  const onSaved = vi.fn();
  window.location.hash = '/add';
  render(
    <Add
      repository={{ save }}
      capture={{
        captureWebpage: vi.fn(),
        extractHtml: vi.fn(),
        extractPdfText: vi.fn(),
        validateWebUrl: vi.fn(),
      }}
      onSaved={onSaved}
    />,
  );
  const entries = [
    fileEntry(file('a.png', 'image/png')),
    fileEntry(file('b.png', 'image/png')),
    fileEntry(file('report.docx', 'application/msword')),
  ];
  const tree = {
    name: 'Sem5',
    isFile: false,
    isDirectory: true,
    createReader: () => {
      const pending = [entries];
      return { readEntries: (done: (e: unknown[]) => void) => done(pending.shift() ?? []) };
    },
  };
  fireEvent.drop(screen.getByRole('button', { name: /Choose files or drop them here/ }), {
    dataTransfer: { files: [], items: [{ webkitGetAsEntry: () => tree }] },
  });
  return { save, onSaved };
}
const summary = () => document.querySelector('.folder-summary')?.querySelector('p')?.textContent;

it('[S1] removing a folder file updates its summary and the skipped count still reaches the Library', async () => {
  const { onSaved } = renderWithFolder();
  await waitFor(() => expect(summary()).toBe('From “Sem5”: 2 files ready to save, 1 skipped.'));
  fireEvent.click(screen.getByRole('button', { name: 'Remove a.png' }));
  expect(summary()).toBe('From “Sem5”: 1 file ready to save, 1 skipped.');
  fireEvent.click(screen.getByRole('button', { name: 'Save locally' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(onSaved.mock.calls[0][1]).toBe('1 file(s) from the folder were skipped.');
});

it('[S1] removing every file of a folder removes its summary and its skipped files from the save', async () => {
  const { onSaved, save } = renderWithFolder();
  await waitFor(() => expect(summary()).toContain('2 files ready to save'));
  fireEvent.click(screen.getByRole('button', { name: 'Remove a.png' }));
  fireEvent.click(screen.getByRole('button', { name: 'Remove b.png' }));
  expect(document.querySelector('.folder-summary')).toBeNull();
  fireEvent.change(screen.getByLabelText('Choose files to save'), {
    target: { files: [file('later.png', 'image/png')] },
  });
  expect(document.querySelector('.folder-summary')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Save locally' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(save.mock.calls.map(([input]) => input.kind === 'file' && input.file.name)).toEqual([
    'later.png',
  ]);
  expect(onSaved.mock.calls[0][1]).toBeUndefined();
});
