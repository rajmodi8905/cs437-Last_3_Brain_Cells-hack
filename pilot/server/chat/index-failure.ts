// Why a saved item could not be made searchable, from the error its index job failed with. The
// engine host returns the app's own messages (src/engine/extract.ts and src/engine/index.ts), so
// these patterns follow their wording; anything unrecognised is `other`. A channel words its own
// reply from the kind; WhatsApp keeps its single message.
import { IndexPublishError } from '../index-publish';
import { EngineIndexError } from '../whatsapp/engine-host';

export type IndexFailureKind =
  /** A PDF over the app's page limit (`LIMITS.maxPdfPages`). */
  | 'too-many-pages'
  | 'password-protected'
  /** A damaged or unreadable PDF. */
  | 'unreadable-pdf'
  /** An image the browser cannot decode. */
  | 'bad-image'
  /** Nothing to search: no text in a PDF, nothing found in a picture. */
  | 'nothing-searchable'
  /** The account's quota has no room for the index. */
  | 'library-full'
  /** Anything else, including a failure that kept happening until the job gave up. */
  | 'other';

export interface IndexFailure {
  kind: IndexFailureKind;
  /** A PDF's number of pages, when the engine host could read it. */
  pageCount?: number;
}

const ENGINE_REASONS: [RegExp, IndexFailureKind][] = [
  [/\bexceeds \d+ pages\b/i, 'too-many-pages'],
  [/\bpassword-protected\b/i, 'password-protected'],
  [/\bPDF could not be read\b/i, 'unreadable-pdf'],
  [/\bimage could not be decoded\b/i, 'bad-image'],
  [
    /\bNo searchable content was extracted\b|\bno text or speech to search\b/i,
    'nothing-searchable',
  ],
];

/** The kind of failure behind an index job's final error (or its `cause`). */
export function classifyIndexFailure(error: unknown): IndexFailure {
  for (let cause = error, depth = 0; cause instanceof Error && depth < 4; depth++) {
    if (cause instanceof EngineIndexError) {
      const { message } = cause;
      const kind = ENGINE_REASONS.find(([pattern]) => pattern.test(message))?.[1] ?? 'other';
      const pages = cause.pageCount;
      return Number.isSafeInteger(pages) && pages! > 0 ? { kind, pageCount: pages } : { kind };
    }
    if (cause instanceof IndexPublishError)
      return { kind: cause.code === 'QUOTA_EXCEEDED' ? 'library-full' : 'other' };
    cause = cause.cause;
  }
  return { kind: 'other' };
}
