// Adding a whole folder (issue #51): a dropped folder is walked recursively, reading each
// folder until its reader returns no more entries; hidden and system files are skipped; files
// the library cannot save are reported with a reason instead of being saved or blocking the rest.
import { expect, it } from 'vitest';
import {
  MAX_FOLDER_FILES,
  sortFolder,
  walkEntries,
  type FolderEntry,
} from '../../src/app/folderFiles';

function file(name: string, type: string, path = '') {
  const value = new File(['x'], name, { type, lastModified: 1 });
  if (path) Object.defineProperty(value, 'webkitRelativePath', { value: path });
  return value;
}
const fileEntry = (value: File) => ({
  name: value.name,
  isFile: true,
  isDirectory: false,
  file: (success: (f: File) => void) => success(value),
});
/** A fake folder whose reader hands out its children in the given batches, then nothing. */
function folder(name: string, ...batches: FolderEntry[][]) {
  return {
    name,
    isFile: false,
    isDirectory: true,
    createReader: () => {
      const pending = [...batches];
      return {
        readEntries: (success: (entries: FolderEntry[]) => void) =>
          setTimeout(() => success(pending.shift() ?? [])),
      };
    },
  };
}

it('[S1] the folder walker reads nested folders and every batch a folder reader returns', async () => {
  const tree = folder(
    'Sem5',
    [fileEntry(file('one.png', 'image/png')), fileEntry(file('two.pdf', 'application/pdf'))],
    [
      folder('CS437', [fileEntry(file('three.jpg', 'image/jpeg'))]),
      fileEntry(file('.DS_Store', '')),
    ],
  );
  const loose = fileEntry(file('loose.png', 'image/png'));
  const { files, truncated } = await walkEntries([tree, loose]);
  expect(files.map((f) => f.name)).toEqual([
    'one.png',
    'two.pdf',
    'three.jpg',
    '.DS_Store',
    'loose.png',
  ]);
  expect(truncated).toBe(false);
});

it('[S1] the folder walker does not enter hidden folders and stops at its limit', async () => {
  const tree = folder('Sem5', [
    folder('.git', [fileEntry(file('HEAD', ''))]),
    fileEntry(file('a.png', 'image/png')),
    fileEntry(file('b.png', 'image/png')),
    fileEntry(file('c.png', 'image/png')),
  ]);
  expect((await walkEntries([tree])).files.map((f) => f.name)).toEqual(['a.png', 'b.png', 'c.png']);
  const limited = await walkEntries([tree], 2);
  expect(limited.files).toHaveLength(2);
  expect(limited.truncated).toBe(true);
});

it('[S1] a folder skips hidden and system files and reports unsupported files instead of saving them', () => {
  const { ready, skipped, overLimit } = sortFolder([
    file('one.png', 'image/png', 'Sem5/one.png'),
    file('notes.pdf', 'application/pdf', 'Sem5/CS437/notes.pdf'),
    file(
      'report.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Sem5/report.docx',
    ),
    file('.DS_Store', '', 'Sem5/.DS_Store'),
    file('Thumbs.db', '', 'Sem5/Thumbs.db'),
    file('config.png', 'image/png', 'Sem5/.hidden/config.png'),
  ]);
  expect(ready.map((f) => f.name)).toEqual(['one.png', 'notes.pdf']);
  expect(overLimit).toBe(0);
  expect(skipped.map((s) => s.name)).toEqual([
    'report.docx',
    '.DS_Store',
    'Thumbs.db',
    'config.png',
  ]);
  expect(skipped[0].reason).toBe(
    '“report.docx” is a DOCX file. Choose a JPEG, PNG, WebP, PDF, MP3, WAV, M4A or MP4 file.',
  );
  expect(skipped[1].reason).toBe('“.DS_Store” is a hidden or system file.');
});

it('[S1] one folder adds at most the folder limit and counts the rest', () => {
  const many = Array.from({ length: MAX_FOLDER_FILES + 5 }, (_, i) =>
    file(`shot-${i}.png`, 'image/png'),
  );
  const { ready, overLimit } = sortFolder(many);
  expect(ready).toHaveLength(MAX_FOLDER_FILES);
  expect(overLimit).toBe(5);
});
