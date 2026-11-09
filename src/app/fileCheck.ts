// Checks a picked file against the same type and size rules the library applies when saving
// (src/storage save), so a problem shows as soon as the file is picked. Each message names
// the file and the rule, and says what to do.
import { LIMITS, SUPPORTED_MIME_TYPES, type ItemKind } from '../shared';

const SUPPORTED = 'JPEG, PNG, WebP, PDF, MP3, WAV, M4A or MP4';
const extension = (name: string) => /\.([A-Za-z0-9]{1,8})$/.exec(name)?.[1].toUpperCase();
const KNOWN_EXTENSIONS = new Set(['JPG', 'JPEG', 'PNG', 'WEBP', 'PDF', 'MP3', 'WAV', 'M4A', 'MP4']);
/** Letters read aloud with a vowel sound take "an": an MP3, an XLSX, a TXT. */
const article = (type: string) => (/^[AEFHILMNORSX]/.test(type) ? 'an' : 'a');
const megabytes = (value: number) => `${Math.round(value / 1e6)} MB`;

/** The largest file of each kind the library saves. */
export function sizeLimit(kind: ItemKind) {
  return kind === 'image' || kind === 'pdf'
    ? LIMITS.maxPdfBytes
    : kind === 'audio'
      ? LIMITS.maxAudioBytes
      : LIMITS.maxVideoBytes;
}

/** Why `file` cannot be saved, or undefined when it can. */
export function fileProblem(file: File): string | undefined {
  const name = `“${file.name}”`;
  const kind = SUPPORTED_MIME_TYPES[file.type];
  if (!kind) {
    const type = extension(file.name);
    if (type === 'MOV' || file.type === 'video/quicktime')
      return `${name} is a MOV video. Convert it to MP4 to save it.`;
    if (type === 'HEIC' || type === 'HEIF' || /^image\/hei[cf]/.test(file.type))
      return `${name} is a HEIC photo. Convert it to JPEG or PNG to save it.`;
    // An extension the library accepts, but the browser did not recognise the file.
    if (!type || KNOWN_EXTENSIONS.has(type))
      return `${name} is not a file type Campus Recall can save. Choose a ${SUPPORTED} file.`;
    return `${name} is ${article(type)} ${type} file. Choose a ${SUPPORTED} file.`;
  }
  const limit = sizeLimit(kind);
  if (file.size > limit) return `${name} is larger than ${megabytes(limit)}.`;
  return undefined;
}

/** The same file picked again: same name, size and last change. */
export const sameFile = (a: File, b: File) =>
  a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;
