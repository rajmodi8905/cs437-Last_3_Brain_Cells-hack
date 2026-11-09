// @vitest-environment jsdom
// Adding files forgivingly: each pick or drop adds to the selection without duplicates, each
// file can be removed, and type and size are checked as soon as files are picked, with a
// message that names the file and the rule. Files that cannot be saved are listed with the
// reason and skipped; the others still save. Pasting an image adds it to Files and pasting
// text starts a note, but a paste into a field is left to the field.
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Add } from '../../src/ui/Add';
import type { LibraryItem, SaveInput } from '../../src/shared';

afterEach(cleanup);

function file(name: string, type: string, size = 10, lastModified = 1) {
  const value = new File(['x'], name, { type, lastModified });
  Object.defineProperty(value, 'size', { value: size });
  return value;
}
function renderAdd() {
  const save = vi.fn(async (input: SaveInput): Promise<LibraryItem> => ({
    id: input.kind === 'file' ? input.file.name : 'note',
    kind: 'image',
    title: input.kind === 'file' ? input.file.name : 'note',
    mimeType: 'image/png',
    byteLength: 10,
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
  const pick = (...files: File[]) =>
    fireEvent.change(screen.getByLabelText('Choose files to save'), { target: { files } });
  return { save, onSaved, pick };
}
const listed = () =>
  within(screen.getByRole('list', { name: 'Selected files' }))
    .getAllByRole('listitem')
    .map((item) => item.querySelector('.file-name')?.textContent);

it('a second pick or a drop adds to the selection without duplicates, and each file can be removed', async () => {
  const { pick, save, onSaved } = renderAdd();
  const poster = file('poster.png', 'image/png', 2_400_000);
  pick(poster);
  expect(screen.getByText('1 file selected')).toBeTruthy();
  pick(file('notes.pdf', 'application/pdf', 300_000), file('poster.png', 'image/png', 2_400_000));
  expect(listed()).toEqual(['poster.png', 'notes.pdf']);
  expect(screen.getByText('2 files selected')).toBeTruthy();
  // Name and size for each file.
  expect(screen.getByRole('list', { name: 'Selected files' }).textContent).toContain('2.4 MB');
  fireEvent.drop(screen.getByRole('button', { name: /files selected/ }), {
    dataTransfer: { files: [file('timetable.jpg', 'image/jpeg')] },
  });
  expect(listed()).toEqual(['poster.png', 'notes.pdf', 'timetable.jpg']);
  const remove = screen.getByRole('button', { name: 'Remove poster.png' });
  expect(remove.getAttribute('type')).toBe('button');
  fireEvent.click(remove);
  expect(listed()).toEqual(['notes.pdf', 'timetable.jpg']);
  // Focus stays in the list, on the next file's remove button.
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove notes.pdf' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save locally' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(save.mock.calls.map(([input]) => input.kind === 'file' && input.file.name)).toEqual([
    'notes.pdf',
    'timetable.jpg',
  ]);
  expect(onSaved.mock.calls[0][1]).toBeUndefined();
});

it('checks type and size when files are picked, names the file and the rule, and saves only the files that can be saved', async () => {
  const { pick, save, onSaved } = renderAdd();
  pick(
    file('lecture.mov', 'video/quicktime'),
    file('notes.pdf', 'application/pdf', 20_000_001),
    file('talk.mp3', 'audio/mpeg', 50_000_001),
    file('poster.png', 'image/png'),
  );
  // Shown before Save is pressed.
  const list = screen.getByRole('list', { name: 'Selected files' });
  expect(list.textContent).toContain('“lecture.mov” is a MOV video. Convert it to MP4 to save it.');
  expect(list.textContent).toContain('“notes.pdf” is larger than 20 MB.');
  expect(list.textContent).toContain('“talk.mp3” is larger than 50 MB.');
  expect(
    screen.getByText('3 files cannot be saved. Remove them or choose other files.'),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Save locally' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(save).toHaveBeenCalledOnce();
  expect(save.mock.calls[0][0]).toMatchObject({ kind: 'file', file: { name: 'poster.png' } });
  const warning: string = onSaved.mock.calls[0][1];
  expect(warning).toContain('“lecture.mov” is a MOV video.');
  expect(warning).toContain('3 remaining file(s) were not saved');
});

it('saves nothing when no picked file can be saved, and still asks for a file when none is picked', async () => {
  const { pick, save } = renderAdd();
  fireEvent.click(screen.getByRole('button', { name: 'Save locally' }));
  expect((await screen.findByRole('alert')).textContent).toBe('Choose at least one file.');
  pick(file('notes.txt', 'text/plain'), file('IMG_2041.HEIC', 'image/heic'));
  const list = screen.getByRole('list', { name: 'Selected files' });
  expect(list.textContent).toContain(
    '“notes.txt” is a TXT file. Choose a JPEG, PNG, WebP, PDF, MP3, WAV, M4A or MP4 file.',
  );
  expect(list.textContent).toContain(
    '“IMG_2041.HEIC” is a HEIC photo. Convert it to JPEG or PNG to save it.',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save locally' }));
  expect((await screen.findByRole('alert')).textContent).toBe(
    'None of these files can be saved. Remove them or choose other files.',
  );
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Remove notes.txt' }));
  fireEvent.click(screen.getByRole('button', { name: 'Remove IMG_2041.HEIC' }));
  expect(screen.queryByRole('list', { name: 'Selected files' })).toBeNull();
  expect(screen.getByText('Choose files or drop them here')).toBeTruthy();
});

it('pasting an image adds it to Files, pasting text starts a note, and a paste into a field is left alone', () => {
  renderAdd();
  const screenshot = file('image.png', 'image/png', 4000, 2);
  fireEvent.paste(document.body, {
    clipboardData: { files: [screenshot], getData: () => '', types: ['Files'] },
  });
  expect(listed()).toEqual(['image.png']);
  // Typing in the title field: the paste belongs to the field.
  const title = screen.getByRole('textbox', { name: /Title/ });
  title.focus();
  const typed = fireEvent.paste(title, {
    clipboardData: { files: [], getData: () => 'Pasted title', types: ['text/plain'] },
  });
  expect(typed).toBe(true);
  expect(screen.getByRole('tab', { name: 'Files' }).getAttribute('aria-selected')).toBe('true');
  title.blur();
  fireEvent.paste(document.body, {
    clipboardData: {
      files: [],
      getData: (type: string) => (type === 'text/plain' ? 'Lab 4 is due on Friday.' : ''),
      types: ['text/plain'],
    },
  });
  expect(screen.getByRole('tab', { name: 'Note' }).getAttribute('aria-selected')).toBe('true');
  expect((screen.getByRole('textbox', { name: 'Note' }) as HTMLTextAreaElement).value).toBe(
    'Lab 4 is due on Friday.',
  );
});
