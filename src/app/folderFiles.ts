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

/**
 * Every file in the dropped entries, folders walked recursively. Hidden folders are not
 * entered. A folder reader returns its entries in batches, so it is read until it returns none.
 */
export async function walkEntries(
  entries: FolderEntry[],
  limit = MAX_WALKED_FILES,
): Promise<{ files: File[]; truncated: boolean }> {
  const files: File[] = [];
  let truncated = false;
  const visit = async (entry: FolderEntry): Promise<void> => {
    if (files.length >= limit) {
      truncated = true;
      return;
    }
    if (entry.isFile) {
      files.push(
        await new Promise<File>((resolve, reject) => (entry as FileEntry).file(resolve, reject)),
      );
      return;
    }
    if (!entry.isDirectory || isHiddenOrSystem(entry.name)) return;
    const reader = (entry as DirectoryEntry).createReader();
    for (;;) {
      const batch = await new Promise<FolderEntry[]>((resolve, reject) =>
        reader.readEntries(resolve, reject),
      );
      if (!batch.length) return;
      for (const child of batch) await visit(child);
    }
  };
  for (const entry of entries) await visit(entry);
  return { files, truncated };
}

export interface SkippedFile {
  name: string;
  /** One sentence that names the file and says why it was skipped. */
  reason: string;
}
export interface FolderBatch {
  /** Files that can be saved, at most MAX_FOLDER_FILES. */
  ready: File[];
  skipped: SkippedFile[];
  /** Files that could be saved but were over the limit and were not added. */
  overLimit: number;
}

/** A file's path inside the picked folder, when the browser gives one. */
const pathOf = (file: File) => file.webkitRelativePath || file.name;

/**
 * Sorts a folder's files: hidden and system files and files the library cannot save are
 * skipped with a reason, and at most `limit` of the rest are kept.
 */
export function sortFolder(files: File[], limit = MAX_FOLDER_FILES): FolderBatch {
  const ready: File[] = [];
  const skipped: SkippedFile[] = [];
  let overLimit = 0;
  for (const file of files) {
    // A file inside a hidden folder (for example .git) counts as hidden too.
    if (pathOf(file).split('/').some(isHiddenOrSystem)) {
      skipped.push({ name: file.name, reason: `“${file.name}” is a hidden or system file.` });
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
