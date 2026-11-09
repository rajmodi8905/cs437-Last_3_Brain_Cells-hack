// One place that turns errors into a plain sentence: what happened and what to do next.
// The raw text is kept as `detail` for a bug report and is never the message itself.
// Messages the app already wrote for students pass through unchanged.

export interface PlainError {
  /** A short sentence a student can act on. */
  message: string;
  /** The original text, when it differs from `message`. */
  detail?: string;
}

const GENERIC = 'Something went wrong, so that did not finish. Try again.';
const CONNECTION = 'Could not connect. Check your internet connection and try again.';
const SPACE =
  'This device is out of space for Campus Recall. Free up some space or delete items you no longer need, then try again.';
const SESSION = 'Your Auto-sync session needs refreshing. Reload the page and try again.';

/** Auto-sync service error codes (pilot/contract PilotErrorCode). */
const SYNC_CODES: Record<string, string> = {
  UNAUTHENTICATED: 'You are signed out of Auto-sync. Sign in again in Settings to keep syncing.',
  FORBIDDEN: SESSION,
  NOT_FOUND:
    'That item is no longer in your cloud library. It may have been deleted on another device.',
  NOT_ELIGIBLE: 'Only verified IITGN accounts (@iitgn.ac.in) can sign in.',
  VAULT_RESET: 'Your cloud library was removed or reset. Start Auto-sync again in Settings.',
  RESYNC_REQUIRED: 'Your cloud library was removed or reset. Start Auto-sync again in Settings.',
  REVISION_CONFLICT: 'This item changed on another device. Sync again to get the latest version.',
  ITEM_DELETED: 'This item was deleted from your cloud library on another device.',
  QUOTA_EXCEEDED:
    'Your cloud library is full. Delete something from your cloud library to make room.',
  LIMIT_EXCEEDED: 'This item is too large for Auto-sync. It stays on this device.',
  HASH_MISMATCH: 'The file did not arrive complete. Try again.',
  INDEX_INCOMPATIBLE:
    'This item was prepared by a different version of the app. Update the app on both devices, then sync again.',
  INVALID_INPUT: 'Auto-sync could not continue. Reload the page and try again.',
  RATE_LIMITED: 'Too many requests in a short time. Wait a minute, then try again.',
  INTERNAL_ERROR:
    'The Auto-sync service had a problem. Your library on this device is unchanged. Try again later.',
};

/** Known raw texts and their plain versions. */
const KNOWN: [RegExp, string][] = [
  [/Title must be between one and 120 Unicode code points/, 'Use a title of 1 to 120 characters.'],
  [
    /Integrity check failed for /,
    'A search download file was damaged on the way. Try the download again.',
  ],
  [
    /^Could not download .+\. Retry when connected\.$/,
    'The download stopped before it finished. Check your connection and try again. What already finished is kept.',
  ],
  [
    /Downloaded original does not match its hash/,
    'The downloaded original was damaged on the way, so it was not opened. Try again.',
  ],
  [
    /did not return the requested part of the original/,
    'The original did not download completely. Try again.',
  ],
  [/CSRF token/i, SESSION],
  [/must be a cursor/, 'Auto-sync could not continue. Reload the page and try again.'],
  [
    /does not support safe processing locks/,
    'This browser cannot process files safely. Use a current version of Safari, Chrome or Firefox. Your saved originals are still here.',
  ],
  [/^HTTP \d{3}$/, 'The service did not answer properly. Try again later.'],
  [/Failed to fetch|NetworkError|^Load failed$|network error/i, CONNECTION],
  [/QuotaExceeded|quota (?:has been )?exceeded|exceeded the quota/i, SPACE],
];

// Words and shapes that mark text written for developers rather than students.
const JARGON =
  /\b(?:undefined|null|NaN|TypeError|ReferenceError|SyntaxError|RangeError|DOMException|[A-Za-z]+Error|JSON|ONNX|WASM|WebGPU|CSRF|cursor|epoch|vault|embeddings?|inference|quota|hash|token|stack|ERR_[A-Z_]+|[A-Z]{3,}_[A-Z_]+|HTTP \d{3}|0x[0-9a-f]+)\b|\(reading |[{}<>=]|=>/i;

function rawText(cause: unknown): string {
  let text: string;
  if (cause instanceof Error) text = cause.message || cause.name;
  else if (typeof cause === 'string') text = cause;
  else {
    try {
      text = JSON.stringify(cause) ?? String(cause);
    } catch {
      text = String(cause);
    }
  }
  return text.replace(/^(?:Uncaught )?Error: /, '').trim();
}

const nameOf = (cause: unknown) =>
  typeof cause === 'object' && cause !== null && 'name' in cause ? String(cause.name) : '';
const codeOf = (cause: unknown) =>
  typeof cause === 'object' && cause !== null && 'code' in cause && typeof cause.code === 'string'
    ? cause.code
    : undefined;
/** AppOperationError carries its code in `detail`; anything else has no app code. */
const appCodeOf = (cause: unknown) => {
  if (nameOf(cause) !== 'AppOperationError') return undefined;
  const detail = (cause as { detail?: { code?: unknown } }).detail;
  return typeof detail?.code === 'string' ? detail.code : undefined;
};

const looksPlain = (text: string) =>
  text.length <= 280 && /^[A-Z“"‘']/.test(text) && /[.!?”]$/.test(text) && !JARGON.test(text);

const result = (message: string, raw: string): PlainError =>
  message === raw ? { message } : { message, detail: raw || undefined };

/** `fallback` replaces the generic sentence when the raw text is not fit to show. */
export function plainError(cause: unknown, fallback = GENERIC): PlainError {
  const raw = rawText(cause);
  // The Auto-sync client's failure: its code says what happened better than its text.
  const syncCode = nameOf(cause) === 'ApiFailure' ? codeOf(cause) : undefined;
  if (syncCode && SYNC_CODES[syncCode]) return result(SYNC_CODES[syncCode], raw);
  if (nameOf(cause) === 'QuotaExceededError') return result(SPACE, raw);
  const known = KNOWN.find(([pattern]) => pattern.test(raw));
  if (known) return result(known[1], raw);
  // A failed request in the browser is a TypeError with a browser-specific text.
  if (nameOf(cause) === 'TypeError' && /fetch/i.test(raw)) return result(CONNECTION, raw);
  const appCode = appCodeOf(cause);
  // A storage failure carries the browser's own text, so it is checked like any raw text.
  if (appCode && appCode !== 'STORAGE_FAILED') return result(raw, raw);
  if (appCode === 'STORAGE_FAILED' && !looksPlain(raw))
    return result('Could not save to this device. Nothing new was saved. Try again.', raw);
  if (looksPlain(raw)) return result(raw, raw);
  return result(fallback, raw);
}

/** Just the sentence, for places without room for details. */
export const plainMessage = (cause: unknown, fallback?: string) =>
  plainError(cause, fallback).message;
