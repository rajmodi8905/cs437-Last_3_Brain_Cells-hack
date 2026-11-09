import { planArchiveParts, type LibraryItem, type LibraryRepository } from '../shared';
import { downloadBlob } from './download';

/** Browsers may block downloads started in quick succession; leave a gap between parts. */
export const DOWNLOAD_GAP_MS = 1000;

/** A whole-library backup: one ZIP per part, so every ZIP fits the import limits. */
export async function exportLibrary(
  repository: Pick<LibraryRepository, 'exportItems'>,
  items: Pick<LibraryItem, 'id' | 'byteLength'>[],
): Promise<Blob[]> {
  const archives: Blob[] = [];
  for (const part of planArchiveParts(items))
    archives.push(await repository.exportItems(part.map((item) => item.id)));
  return archives;
}

export const backupFileName = (base: string, part: number, parts: number) =>
  parts === 1 ? `${base}.zip` : `${base}-part-${part}-of-${parts}.zip`;

/** Starts each part's download in turn, waiting between them. */
export async function downloadParts(
  archives: Blob[],
  base: string,
  {
    download = downloadBlob,
    pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  }: {
    download?: (blob: Blob, name: string) => void;
    pause?: (ms: number) => Promise<void>;
  } = {},
) {
  for (const [n, archive] of archives.entries()) {
    if (n > 0) await pause(DOWNLOAD_GAP_MS);
    download(archive, backupFileName(base, n + 1, archives.length));
  }
}

export const backupCreatedMessage = (parts: number) =>
  parts === 1
    ? 'Backup created. Keep this unencrypted ZIP somewhere private.'
    : `Backup created as ${parts} ZIP files. Check that all ${parts} downloaded; your browser may ask to allow multiple downloads. Import each one to restore, and keep them somewhere private.`;
