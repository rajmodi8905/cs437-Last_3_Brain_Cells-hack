// Adding a whole folder at once. A dropped folder is walked entry by entry (the drop's file list
// does not include a folder's contents); a picked folder already arrives as a flat file list.
// Either way the files are sorted into those that can be saved and those that are skipped,
// each skipped one with the reason, so unsupported files never block the rest of the folder.
import { fileProblem } from './fileCheck';

/** The most files one folder adds at a time. */
export const MAX_FOLDER_FILES = 200;
/** Walking stops after this many files so a very large tree does not hang the page. */
const MAX_WALKED_FILES = 2_000;

/** The parts of a FileSystemEntry the walker uses, so it can be tested with fake entries. */
export interface FolderEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
}
interface FileEntry extends FolderEntry {
  file(success: (file: File) => void, failure?: (error: unknown) => void): void;
}
interface DirectoryEntry extends FolderEntry {
  createReader(): {
    readEntries(
      success: (entries: FolderEntry[]) => void,
      failure?: (error: unknown) => void,
    ): void;
  };
}

/** Whether a dropped item is a folder, read during the drop event. */
export const isFolderEntry = (entry: FolderEntry | null | undefined) => !!entry?.isDirectory;

const SYSTEM_FILES = new Set(['thumbs.db', 'ehthumbs.db', 'desktop.ini', 'icon\r']);
/** Hidden files (names starting with a dot, such as .DS_Store) and operating-system files. */
export const isHiddenOrSystem = (name: string) =>
  name.startsWith('.') || SYSTEM_FILES.has(name.toLowerCase());

export interface SkippedFile {
  name: string;
  /** One sentence that names the file and says why it was skipped. */
  reason: string;
}

/**
 * Every file in the dropped entries, folders walked recursively. Hidden folders inside the
 * dropped ones are not entered; a dropped folder is read whatever its own name. A folder reader
 * returns its entries in batches, so it is read until it returns none. A file or folder that
 * cannot be read is skipped with a reason, and the walk stops as soon as it passes `limit`.
 */
export async function walkEntries(
  entries: FolderEntry[],
  limit = MAX_WALKED_FILES,
): Promise<{ files: File[]; skipped: SkippedFile[]; truncated: boolean }> {
  const files: File[] = [];
  const skipped: SkippedFile[] = [];
  let truncated = false;
  const visit = async (entry: FolderEntry, top: boolean): Promise<void> => {
    if (files.length >= limit) {
      truncated = true;
      return;
    }
    if (entry.isFile) {
      try {
        files.push(
          await new Promise<File>((resolve, reject) => (entry as FileEntry).file(resolve, reject)),
        );
      } catch {
        skipped.push({ name: entry.name, reason: `“${entry.name}” could not be read.` });
      }
      return;
    }
    if (!entry.isDirectory || (!top && isHiddenOrSystem(entry.name))) return;
    const reader = (entry as DirectoryEntry).createReader();
    for (;;) {
      let batch: FolderEntry[];
      try {
        batch = await new Promise<FolderEntry[]>((resolve, reject) =>
          reader.readEntries(resolve, reject),
        );
      } catch {
        skipped.push({
          name: entry.name,
          reason: `The folder “${entry.name}” could not be read, so the files still in it were skipped.`,
        });
        return;
      }
      if (!batch.length) return;
      for (const child of batch) {
        await visit(child, false);
        if (truncated) return;
      }
    }
  };
  for (const entry of entries) {
    await visit(entry, true);
    if (truncated) break;
  }
  return { files, skipped, truncated };
}
export interface FolderBatch {
  /** Files that can be saved, at most MAX_FOLDER_FILES. */
  ready: File[];
  skipped: SkippedFile[];
  /** Files that could be saved but were over the limit and were not added. */
  overLimit: number;
}

/**
 * The folders between the picked folder and the file, when the browser gives the file's path
 * (Sem5/CS437/notes.pdf gives CS437). The picked folder itself is left out: picking a folder
 * means its files are wanted, whatever its name.
 */
const innerFolders = (file: File) => (file.webkitRelativePath ?? '').split('/').slice(1, -1);

/**
 * Sorts a folder's files: hidden and system files and files the library cannot save are
 * skipped with a reason, and at most `limit` of the rest are kept.
 */
export function sortFolder(files: File[], limit = MAX_FOLDER_FILES): FolderBatch {
  const ready: File[] = [];
  const skipped: SkippedFile[] = [];
  let overLimit = 0;
  for (const file of files) {
    const name = `“${file.name}”`;
    // A file inside a hidden folder (for example .git) is skipped too, naming that folder.
    const hiddenFolder = innerFolders(file).find(isHiddenOrSystem);
    if (hiddenFolder) {
      skipped.push({
        name: file.name,
        reason: `${name} is in the hidden folder “${hiddenFolder}”.`,
      });
      continue;
    }
    if (isHiddenOrSystem(file.name)) {
      skipped.push({ name: file.name, reason: `${name} is a hidden or system file.` });
      continue;
    }
    const problem = fileProblem(file);
    if (problem) skipped.push({ name: file.name, reason: problem });
    else if (ready.length < limit) ready.push(file);
    else overLimit++;
  }
  return { ready, skipped, overLimit };
}

/** The folder's name: the first part of a picked file's path. */
export const folderName = (files: File[]) =>
  files.find((file) => file.webkitRelativePath)?.webkitRelativePath.split('/')[0];

/** Bytes this site can still store on the device, or undefined when the browser cannot say. */
export async function freeBytes(): Promise<number | undefined> {
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (estimate?.quota === undefined) return undefined;
    return Math.max(0, estimate.quota - (estimate.usage ?? 0));
  } catch {
    return undefined;
  }
}
