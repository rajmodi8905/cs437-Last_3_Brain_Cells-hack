/// <reference types="node" />
// Pilot sync API (docs/pilot/protocol.md). Plain node:http, no framework.
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import {
  decideWrite,
  pickItemDescription,
  validateCloudItem,
  type IndexBundle,
  type ItemWrite,
  type PilotErrorCode,
  type WriteDecision,
} from '../contract';
import {
  MAX_SEALED_META_BYTES,
  newPairingCode,
  normalizePairingCode,
  validMetaRevision,
  validPairingPublicKey,
  validPairingSealedSecret,
  validSealedBlob,
  validateSealedItemFields,
  validateVaultE2ee,
} from '../contract/e2ee';
import {
  VaultResetError,
  isSealed,
  publicItem,
  stagingKey,
  type AnyStoredItem,
  type ItemDescription,
  type ObjectStore,
  type PilotStore,
  type SealedStoredItem,
  type SealedUpload,
  type Session,
  type StoredItem,
} from './store';
import { IndexPublishError, publishIndexBundle } from './index-publish';
import { DEFAULT_LIMITS, RateLimiter, type RateLimits } from './limits';
import { resetOwnerVault, runAfterCommit } from './vault-reset';
import type { KeySource } from './tokens';
import { verifyIdToken } from './tokens';
import {
  OPEN_PATH_PREFIX,
  PAGE_HEADERS,
  confirmPage,
  hashLinkToken,
  isLinkToken,
  linkErrorPage,
} from './whatsapp/links';
import {
  WEBHOOK_PATH,
  createWhatsAppWebhook,
  type WhatsAppWebhookOptions,
} from './whatsapp/webhook';
import {
  TELEGRAM_LINK_PREFIX,
  TELEGRAM_LINK_RETURN,
  TELEGRAM_OPEN_PREFIX,
  TELEGRAM_PAGE_HEADERS,
  devSignInPage,
  linkConfirmPage,
  linkedElsewherePage,
  linkRequestedPage,
  openConfirmPage,
  signInUnavailablePage,
  telegramLinkErrorPage,
  createConfirmRequest,
} from './telegram/links';
import { telegramUserLock, type TelegramStateStore } from './telegram/store';
import {
  TELEGRAM_WEBHOOK_PATH,
  createTelegramWebhook,
  type TelegramWebhookOptions,
} from './telegram/webhook';

/** Google sign-in run by this server (OpenID Connect authorization code flow with PKCE). */
export interface GoogleLoginOptions {
  /** Secret of the pilot's Google OAuth web client; server-side only. */
  clientSecret: string;
  /** Google's endpoints by default; tests point them at a stand-in. */
  authorizeUrl?: string;
  tokenUrl?: string;
  fetch?: typeof fetch;
}

export interface PilotServerOptions {
  /** The pilot's Google OAuth client ID: the audience every accepted ID token must have. */
  clientId: string;
  allowedEmailDomain: string;
  /** The only browser origin allowed to sign in and write. */
  origin: string;
  keys: KeySource;
  store: PilotStore;
  objects: ObjectStore;
  nowSeconds?: () => number;
  quotaBytes: number;
  chunkBytes?: number;
  sessionSeconds?: number;
  /**
   * Local development only: signs a Google-shaped token for an email so the app can sign in
   * without Google. When set, `/config` reports `dev` and `/dev/token` is enabled.
   */
  devSigner?: (email: string) => string;
  /** Index versions accepted from devices; defaults to the pilot contract's list. */
  supportedIndexVersions?: readonly string[];
  /** Enables `/auth/google/start` and `/auth/google/callback`. */
  google?: GoogleLoginOptions;
  limits?: Partial<RateLimits>;
  /**
   * Behind our own reverse proxy: take the client address from the last `X-Forwarded-For`
   * entry, which that proxy appends. Off by default, so the header cannot be forged.
   */
  trustProxy?: boolean;
  /** Unfinished uploads expire after this many seconds; a day by default. */
  uploadTtlSeconds?: number;
  /**
   * Enables Meta's webhook for the WhatsApp channel at `/api/v1/whatsapp/webhook`. It is
   * authenticated by Meta's signature, so sessions, CSRF and the per-address limit do not apply.
   * It also enables `/api/v1/whatsapp/open/{token}`, the one-time links that open a WhatsApp
   * vault in the app.
   */
  whatsapp?: WhatsAppWebhookOptions;
  /**
   * Enables the Telegram bot's one-time links: `/api/v1/telegram/link/{token}`, which links a
   * Telegram user to the IITGN account signed in on the page, and `/api/v1/telegram/open/{token}`,
   * which opens that linked account in the app. With `webhook` (webhook mode) it also enables
   * Telegram's webhook at `/api/v1/telegram/webhook`, authenticated by the secret token Telegram
   * sends.
   */
  telegram?: TelegramLinkOptions;
}

export interface TelegramLinkOptions {
  /** Linked accounts and the one-time links. */
  state: TelegramStateStore;
  /** Shown on the link page. */
  privacyUrl?: string;
  /**
   * Called (without waiting) when a login link was completed on the page, so the bot can ask in
   * the Telegram chat for confirmation. Nothing is linked until the user confirms there.
   */
  onLinkRequested?: (request: {
    userId: string;
    email: string;
    token: string;
    tokenHash: string;
    /** Messages whose buttons are now used up (login links, an earlier request). */
    messageIds: number[];
  }) => unknown;
  webhook?: TelegramWebhookOptions;
}

const DAY = 24 * 3600;
/** Finished uploads and saved operation results are kept for the length of the pilot. */
export const RETENTION_SECONDS = 30 * DAY;

/** Deletes expired and abandoned data; run at start and then periodically. */
export async function cleanUpPilot(options: {
  store: PilotStore;
  objects: ObjectStore;
  nowSeconds?: () => number;
  uploadTtlSeconds?: number;
}) {
  const now = (options.nowSeconds ?? (() => Math.floor(Date.now() / 1000)))();
  const { abandoned } = await options.store.cleanUp({
    now,
    abandonedBefore: now - (options.uploadTtlSeconds ?? DAY),
    finishedBefore: now - RETENTION_SECONDS,
    responsesBefore: now - RETENTION_SECONDS,
  });
  for (const upload of abandoned)
    for (const n of upload.chunks) await options.objects.delete(stagingKey(upload.uploadId, n));
  return { abandonedUploads: abandoned.length };
}

const STATUS: Record<PilotErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_ELIGIBLE: 403,
  NOT_FOUND: 404,
  ACCOUNT_CHANGED: 409,
  VAULT_RESET: 409,
  REVISION_CONFLICT: 409,
  RESYNC_REQUIRED: 409,
  ITEM_DELETED: 410,
  QUOTA_EXCEEDED: 413,
  LIMIT_EXCEEDED: 413,
  HASH_MISMATCH: 422,
  INDEX_INCOMPATIBLE: 422,
  INVALID_INPUT: 400,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};
const RETRYABLE = new Set<PilotErrorCode>(['INTERNAL_ERROR', 'RATE_LIMITED']);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const COOKIE = 'recall_session';
const LOGIN_COOKIE = 'recall_login';
/** Where a Google sign-in started from a Telegram login link returns to (see `returnCookie`). */
const RETURN_COOKIE = 'recall_return';
const LOGIN_SECONDS = 600;
const GOOGLE_AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const random = () => randomBytes(32).toString('base64url');
/**
 * Sessions and sign-in attempts are stored under the SHA-256 of their cookie value, so a copy
 * of the database cannot be turned back into a working cookie.
 */
const storedId = (cookie: string) => createHash('sha256').update(cookie).digest('hex');
/** The opaque per-account ID devices keep their state under (a SHA-256 prefix of the owner). */
const accountOf = (ownerKey: string) =>
  createHash('sha256').update(ownerKey).digest('hex').slice(0, 32);
/**
 * Sent by the app with the account its sync state belongs to. Every tab shares one session
 * cookie, so after another tab signs in as someone else this tab's requests would otherwise act
 * on that other account (#65).
 */
const ACCOUNT_HEADER = 'x-recall-account';
const sameText = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const MAX_JSON_BYTES = 64 * 1024;
// 2,000 segments of 768 numbers as JSON stay well under this.
const MAX_INDEX_BYTES = 24 * 1024 * 1024;
/** How long a pairing code works (docs/pilot/e2ee-design.md, "Adding a device"). */
const PAIRING_SECONDS = 600;
/** Pairing codes an account may try per ten minutes: 40-bit codes stay out of reach. */
const PAIRING_TRIES = 10;
const pairingCodeHash = (code: string) => createHash('sha256').update(code).digest('hex');
const isSealedUpload = (item: ItemDescription | SealedUpload): item is SealedUpload =>
  'sealed' in item;

/** A rename of an encrypted item: new sealed metadata under a higher `metaRevision`. */
function decideSealedRename(
  current: SealedStoredItem,
  body: Record<string, unknown>,
): WriteDecision {
  if (current.deleted || !current.sealed) return { action: 'reject', code: 'ITEM_DELETED' };
  const { expectedRevision, sealedMeta, metaRevision } = body;
  if (
    !validMetaRevision(expectedRevision) ||
    !validSealedBlob(sealedMeta, MAX_SEALED_META_BYTES) ||
    !validMetaRevision(metaRevision)
  )
    return { action: 'reject', code: 'INVALID_INPUT' };
  if (expectedRevision !== current.revision) return { action: 'reject', code: 'REVISION_CONFLICT' };
  if (metaRevision <= current.sealed.metaRevision)
    return { action: 'reject', code: 'INVALID_INPUT' };
  return { action: 'apply', nextRevision: current.revision + 1 };
}

class ApiError extends Error {
  constructor(
    readonly code: PilotErrorCode,
    message: string,
    readonly extra: Record<string, unknown> = {},
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}
const limited = (seconds: number) =>
  new ApiError(
    'RATE_LIMITED',
    'Too many requests. Try again shortly.',
    {},
    {
      'retry-after': String(seconds),
    },
  );
const errorBody = (code: PilotErrorCode, message: string) => ({
  error: { code, message, retryable: RETRYABLE.has(code) },
});

// Mutating responses are held until the durable owner transaction has committed.
const pendingResponses = new WeakMap<
  ServerResponse,
  { flush?: () => void; afterCommit: Array<() => Promise<void>> }
>();
/** A session just opened, with the cookie value that only the browser keeps. */
interface OpenedSession {
  session: Session;
  cookie: string;
}

/**
 * Runs `task` once the request's owner transaction has committed, or at once when the request
 * holds none. Blob deletes go here: inside the transaction, one that fails after removing the
 * blob rolls the change back and leaves a live item without its original.
 */
function afterCommit(res: ServerResponse, task: () => Promise<void>): Promise<void> | void {
  const pending = pendingResponses.get(res);
  if (!pending) return task();
  pending.afterCommit.push(task);
}

function send(
  res: ServerResponse,
  status: number,
  body?: unknown,
  headers: Record<string, string | string[]> = {},
) {
  const pending = pendingResponses.get(res);
  if (pending) {
    pending.flush = () => send(res, status, body, headers);
    return;
  }
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  if (body === undefined) {
    res.writeHead(status).end();
    return;
  }
  if (body instanceof Uint8Array) {
    res.writeHead(status, { 'content-length': String(body.length) }).end(body);
    return;
  }
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

/**
 * Bodies read before the account's lock was taken (see `dispatch`): the bytes, or the error that
 * reading them ended with, which the route reports in its own order.
 */
const preloadedBodies = new WeakMap<IncomingMessage, { bytes: Uint8Array } | { error: unknown }>();

async function receiveBody(req: IncomingMessage, limit: number): Promise<Uint8Array> {
  const parts: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new ApiError('LIMIT_EXCEEDED', 'Request body is too large.');
    parts.push(chunk as Buffer);
  }
  const all = Buffer.concat(parts);
  // A view of the joined buffer rather than another copy of it.
  return new Uint8Array(all.buffer, all.byteOffset, all.length);
}

/**
 * Reads the whole body now, up to `limit`, and keeps it (or the error) for `readBody`. Used
 * before taking the account's lock, so a slow client never holds the lock or a database
 * connection while it sends.
 */
async function preloadBody(req: IncomingMessage, limit: number) {
  try {
    preloadedBodies.set(req, { bytes: await receiveBody(req, limit) });
  } catch (error) {
    preloadedBodies.set(req, { error });
  }
}

async function readBody(req: IncomingMessage, limit: number): Promise<Uint8Array> {
  const preloaded = preloadedBodies.get(req);
  if (!preloaded) return receiveBody(req, limit);
  if ('error' in preloaded) throw preloaded.error;
  if (preloaded.bytes.length > limit)
    throw new ApiError('LIMIT_EXCEEDED', 'Request body is too large.');
  return preloaded.bytes;
}
const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
/** The body as a JSON object, plus the bytes it was parsed from. */
async function readJsonWithBytes(req: IncomingMessage, limit: number) {
  const bytes = await readBody(req, limit);
  try {
    // Strict UTF-8, so bytes kept as received decode the same way on every device.
    const value: unknown = JSON.parse(UTF8.decode(bytes));
    if (value && typeof value === 'object' && !Array.isArray(value))
      return { value: value as Record<string, unknown>, bytes };
  } catch {
    // Fall through to the error below.
  }
  throw new ApiError('INVALID_INPUT', 'Body must be a JSON object.');
}
async function readJson(
  req: IncomingMessage,
  limit = MAX_JSON_BYTES,
): Promise<Record<string, unknown>> {
  return (await readJsonWithBytes(req, limit)).value;
}

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const isJsonSpace = (byte: number) =>
  byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d;
/** End (exclusive) of the JSON string starting at `at`. */
function skipJsonString(bytes: Uint8Array, at: number) {
  let i = at + 1;
  while (bytes[i] !== QUOTE) i += bytes[i] === BACKSLASH ? 2 : 1;
  return i + 1;
}
/** End (exclusive) of the JSON value starting at `at`. */
function skipJsonValue(bytes: Uint8Array, at: number) {
  const first = bytes[at];
  if (first === QUOTE) return skipJsonString(bytes, at);
  if (first === 0x7b || first === 0x5b) {
    let depth = 0;
    let i = at;
    do {
      const byte = bytes[i];
      if (byte === QUOTE) {
        i = skipJsonString(bytes, i);
        continue;
      }
      if (byte === 0x7b || byte === 0x5b) depth++;
      else if (byte === 0x7d || byte === 0x5d) depth--;
      i++;
    } while (depth > 0);
    return i;
  }
  let i = at;
  while (i < bytes.length && ![0x2c, 0x7d, 0x5d].includes(bytes[i]) && !isJsonSpace(bytes[i])) i++;
  return i;
}
/**
 * The exact bytes of a top-level member's value in a JSON object that `JSON.parse` has already
 * accepted (the last one wins, as in `JSON.parse`). UTF-8 continuation bytes are never ASCII,
 * so scanning bytes for JSON punctuation is safe.
 */
function memberBytes(bytes: Uint8Array, name: string) {
  let found: Uint8Array | undefined;
  let i = 0;
  const skipSpace = () => {
    while (isJsonSpace(bytes[i])) i++;
  };
  skipSpace();
  i++; // {
  for (;;) {
    skipSpace();
    if (bytes[i] === 0x7d) return found;
    const keyEnd = skipJsonString(bytes, i);
    const key = JSON.parse(Buffer.from(bytes.subarray(i, keyEnd)).toString('utf8')) as string;
    i = keyEnd;
    skipSpace();
    i++; // :
    skipSpace();
    const start = i;
    i = skipJsonValue(bytes, i);
    if (key === name) found = bytes.subarray(start, i);
    skipSpace();
    if (bytes[i] === 0x2c) i++;
  }
}
const cookieValue = (req: IncomingMessage, name: string) => {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return undefined;
};
const opIdOf = (body: Record<string, unknown>) => {
  if (typeof body.opId !== 'string' || !UUID_V4.test(body.opId))
    throw new ApiError('INVALID_INPUT', 'opId must be a UUID v4.');
  return body.opId;
};

/** One `bytes=` range (start-end, start- or -suffix); undefined when it cannot be served. */
function parseRange(header: string, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === '' && match[2] === '')) return undefined;
  let start: number;
  let end: number;
  if (match[1] === '') {
    start = Math.max(0, size - Number(match[2]));
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  if (!Number.isSafeInteger(start) || start >= size || end < start) return undefined;
  return { start, end };
}

export function createPilotHandler(options: PilotServerOptions): RequestListener {
  const now = options.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  const chunkBytes = options.chunkBytes ?? 4 * 1024 * 1024;
  const sessionSeconds = options.sessionSeconds ?? 12 * 3600;
  const { store, objects } = options;
  const uploadTtl = options.uploadTtlSeconds ?? DAY;
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  const byAddress = new RateLimiter(limits.addressBurst, limits.addressPerSecond, now);
  const signIns = new RateLimiter(limits.signInBurst, limits.signInPerMinute / 60, now);
  const byAccount = new RateLimiter(limits.accountBurst, limits.accountPerSecond, now);
  const pairingClaims = new RateLimiter(PAIRING_TRIES, PAIRING_TRIES / PAIRING_SECONDS, now);
  const clientAddress = (req: IncomingMessage) => {
    const forwarded = options.trustProxy ? req.headers['x-forwarded-for'] : undefined;
    const last = typeof forwarded === 'string' ? forwarded.split(',').at(-1)?.trim() : undefined;
    return last || req.socket.remoteAddress || 'unknown';
  };
  const limitSignIn = (req: IncomingMessage) => {
    const wait = signIns.take(clientAddress(req));
    if (wait) throw limited(wait);
  };
  const sessionBody = async (session: Session) => {
    const e2ee = await store.vaultE2ee(session.ownerKey);
    return {
      csrf: session.csrf,
      email: session.email,
      // Opaque per-account ID so devices can keep each account's state apart.
      account: accountOf(session.ownerKey),
      vault: await store.vault(session.ownerKey),
      // A WhatsApp vault (opened from a bot link) says so; other sessions are unchanged.
      ...(session.ownerKey.startsWith('wa:') ? { kind: 'whatsapp' } : {}),
      // An account session opened from a Telegram app link, so the app can treat that link as
      // choosing Auto-sync; it is otherwise like the account's own sign-in.
      ...(session.via ? { via: session.via } : {}),
      // The vault salt and key check, once the library is end-to-end encrypted.
      ...(e2ee ? { e2ee } : {}),
    };
  };

  const sessionCookie = (opened: OpenedSession) =>
    `${COOKIE}=${opened.cookie}; Path=/api; Max-Age=${sessionSeconds}; HttpOnly; Secure; SameSite=Lax`;
  /** Stores a new session; only its hash is kept, the cookie value goes to the browser. */
  async function openSession(identity: { ownerKey: string; email: string; via?: 'telegram' }) {
    const cookie = randomBytes(32).toString('base64url');
    const session: Session = {
      id: storedId(cookie),
      csrf: randomBytes(24).toString('base64url'),
      ownerKey: identity.ownerKey,
      email: identity.email,
      expiresAt: now() + sessionSeconds,
      ...(identity.via ? { via: identity.via } : {}),
    };
    await store.createSession(session);
    return { session, cookie };
  }
  const sessionFromCookie = (req: IncomingMessage) => {
    const cookie = cookieValue(req, COOKIE);
    return cookie ? store.getSession(storedId(cookie)) : Promise.resolve(undefined);
  };
  const identityPolicy = (nonce?: string) => ({
    clientId: options.clientId,
    allowedEmailDomain: options.allowedEmailDomain,
    nowSeconds: now(),
    skewSeconds: 60,
    ...(nonce !== undefined ? { nonce } : {}),
  });
  const callbackUrl = `${options.origin}/api/v1/auth/google/callback`;
  /**
   * The return cookie names a login link's token and is bound to one sign-in attempt by a hash
   * with that attempt's own (secret, HttpOnly) cookie, so it is used only by the attempt that set
   * it. The server never stores the token itself.
   */
  const returnBinding = (loginCookie: string, token: string) =>
    createHash('sha256').update(`telegram-return:${loginCookie}:${token}`).digest('base64url');
  const clearReturn = `${RETURN_COOKIE}=; Path=/api/v1/auth; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
  /** The login link page to return to after Google, when this attempt started from one. */
  function returnPath(req: IncomingMessage) {
    const value = cookieValue(req, RETURN_COOKIE);
    const login = cookieValue(req, LOGIN_COOKIE);
    const [token, binding] = (value ?? '').split('.');
    if (!options.telegram || !login || !token || !binding || !isLinkToken(token)) return undefined;
    return sameText(binding, returnBinding(login, token))
      ? `${TELEGRAM_LINK_PREFIX}${token}`
      : undefined;
  }
  /** A session from the account's own sign-in (Google or development), not from a bot link. */
  async function accountSession(req: IncomingMessage) {
    const session = await sessionFromCookie(req);
    return session &&
      session.expiresAt > now() &&
      session.ownerKey.startsWith('google:') &&
      !session.via
      ? session
      : undefined;
  }

  /** Finishes a Google sign-in; returns the outcome shown to the user. */
  async function finishGoogle(
    google: GoogleLoginOptions,
    req: IncomingMessage,
    url: URL,
  ): Promise<{ result: 'failed' | 'cancelled' | 'not-eligible' } | { session: OpenedSession }> {
    const id = cookieValue(req, LOGIN_COOKIE);
    // Taken (and so removed) before anything else: an attempt is usable once.
    const attempt = id ? await store.takeLoginAttempt(storedId(id)) : undefined;
    const state = url.searchParams.get('state') ?? '';
    if (!attempt || attempt.expiresAt <= now() || !sameText(state, attempt.state))
      return { result: 'failed' };
    if (url.searchParams.has('error')) return { result: 'cancelled' };
    const code = url.searchParams.get('code');
    if (!code) return { result: 'failed' };
    const exchange = await (google.fetch ?? fetch)(google.tokenUrl ?? GOOGLE_TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: options.clientId,
        client_secret: google.clientSecret,
        redirect_uri: callbackUrl,
        code_verifier: attempt.codeVerifier,
      }),
    }).catch(() => undefined);
    if (!exchange?.ok) return { result: 'failed' };
    const body = (await exchange.json().catch(() => ({}))) as { id_token?: unknown };
    const verified = await verifyIdToken(
      body.id_token,
      options.keys,
      identityPolicy(attempt.nonce),
    );
    if (!verified.ok)
      return { result: verified.code === 'NOT_ELIGIBLE' ? 'not-eligible' : 'failed' };
    return { session: await openSession(verified.value) };
  }

  async function requireSession(req: IncomingMessage, write: boolean): Promise<Session> {
    const session = await sessionFromCookie(req);
    if (!session || session.expiresAt <= now()) {
      if (session) await store.deleteSession(session.id);
      throw new ApiError('UNAUTHENTICATED', 'Sign in again.');
    }
    const expected = req.headers[ACCOUNT_HEADER];
    if (typeof expected === 'string' && expected !== accountOf(session.ownerKey))
      throw new ApiError(
        'ACCOUNT_CHANGED',
        'This browser is now signed in to a different account. Reload to continue.',
      );
    const wait = byAccount.take(session.ownerKey);
    if (wait) throw limited(wait);
    if (
      write &&
      (req.headers.origin !== options.origin || req.headers['x-recall-csrf'] !== session.csrf)
    )
      throw new ApiError('FORBIDDEN', 'Request origin or CSRF token is not valid.');
    return session;
  }
  async function requireEpoch(ownerKey: string, body: Record<string, unknown>) {
    const { epoch } = await store.vault(ownerKey);
    if (body.epoch !== epoch)
      throw new ApiError('VAULT_RESET', 'This cloud library was reset; resynchronise first.');
    return epoch;
  }
  /**
   * An item of either kind. Plain items are read through `getItem`, as before encrypted items
   * existed, so the read that a write decides on is the same one; encrypted ones come next.
   */
  async function findItem(ownerKey: string, globalId: string): Promise<AnyStoredItem | undefined> {
    return (
      (await store.getItem(ownerKey, globalId)) ?? (await store.getAnyItem(ownerKey, globalId))
    );
  }
  async function requireE2ee(ownerKey: string) {
    if (!(await store.vaultE2ee(ownerKey)))
      throw new ApiError('INVALID_INPUT', 'End-to-end encryption is not on for this library.');
  }
  /** Replays the stored result for a repeated operation ID, otherwise runs and stores it. */
  async function idempotent(
    ownerKey: string,
    opId: string,
    run: () => Promise<{ status: number; body: unknown }>,
  ) {
    const saved = await store.savedResponse(ownerKey, opId);
    if (saved) return saved;
    const result = await run();
    await store.saveResponse(ownerKey, opId, result, now());
    return result;
  }

  /** A small urlencoded form from one of the link pages. */
  async function readForm(req: IncomingMessage) {
    const bytes = await readBody(req, 4096);
    return new URLSearchParams(Buffer.from(bytes).toString('utf8'));
  }
  /** Ends the session this browser had before a new one replaced it. */
  async function replacePrevious(req: IncomingMessage, opened: OpenedSession) {
    const previous = await sessionFromCookie(req);
    if (previous && previous.id !== opened.session.id) await store.deleteSession(previous.id);
  }
  const page = (res: ServerResponse, status: number, body: Uint8Array) =>
    send(res, status, body, TELEGRAM_PAGE_HEADERS);

  /**
   * `/telegram/link/{token}`: links the Telegram user a login link was made for to the IITGN
   * account signed in on this browser. Without such a session, GET starts Google sign-in, which
   * comes back here (or, on a local trial with a development key, shows development sign-in).
   * GET never uses the link up; the Continue form's same-origin POST links.
   */
  async function telegramLogin(
    telegram: TelegramLinkOptions,
    req: IncomingMessage,
    res: ServerResponse,
    token: string,
    method: string,
  ) {
    const { state } = telegram;
    const hash = isLinkToken(token) ? hashLinkToken(token) : undefined;
    const peek = () => (hash ? state.peekLink(hash, 'login', now()) : Promise.resolve(undefined));
    const gone = () => page(res, 404, telegramLinkErrorPage('login'));
    const here = `${options.origin}${TELEGRAM_LINK_PREFIX}${token}`;

    if (method === 'GET' || method === 'HEAD') {
      const link = await peek();
      if (!link) return gone();
      const session = await accountSession(req);
      if (session) {
        const account = await state.getAccount(link.userId);
        if (account && account.ownerKey !== session.ownerKey)
          return page(res, 200, linkedElsewherePage());
        return page(res, 200, linkConfirmPage(link.label, session.email, telegram.privacyUrl));
      }
      if (options.google)
        return send(res, 303, undefined, {
          location: `${options.origin}/api/v1/auth/google/start?return=${encodeURIComponent(`${TELEGRAM_LINK_PREFIX}${token}`)}`,
          'referrer-policy': 'no-referrer',
        });
      if (options.devSigner) return page(res, 200, devSignInPage(link.label));
      return page(res, 200, signInUnavailablePage());
    }
    if (method !== 'POST') throw new ApiError('NOT_FOUND', 'No such endpoint.');
    // A refused origin leaves the link usable.
    if (req.headers.origin !== options.origin)
      return page(res, 403, telegramLinkErrorPage('login'));
    const form = await readForm(req);
    const found = await peek();
    if (!found) return gone();

    if (form.get('intent') === 'signin') {
      // Development sign-in on a local trial: the same identity checks as any sign-in.
      if (!options.devSigner || options.google)
        throw new ApiError('NOT_FOUND', 'No such endpoint.');
      const email = (form.get('email') ?? '').trim();
      if (!email || email.length > 254)
        return page(res, 400, devSignInPage(found.label, 'Enter your IITGN email.'));
      const verified = await verifyIdToken(
        options.devSigner(email),
        options.keys,
        identityPolicy(),
      );
      if (!verified.ok)
        return page(
          res,
          403,
          devSignInPage(found.label, 'Only verified IITGN accounts can link Telegram.'),
        );
      const opened = await openSession(verified.value);
      await replacePrevious(req, opened);
      return send(res, 303, undefined, {
        location: here,
        'referrer-policy': 'no-referrer',
        'set-cookie': sessionCookie(opened),
      });
    }

    const session = await accountSession(req);
    // Signed out meanwhile: the page starts sign-in again.
    if (!session)
      return send(res, 303, undefined, { location: here, 'referrer-policy': 'no-referrer' });
    const result = await store.withOwnerLock(telegramUserLock(found.userId), async () => {
      const account = await state.getAccount(found.userId);
      // Linking to another account needs /logout first; the link stays usable for that.
      if (account && account.ownerKey !== session.ownerKey) return 'elsewhere' as const;
      const link = await state.takeLink(hash!, 'login', now());
      if (!link || link.userId !== found.userId) return undefined;
      // Whoever opens a login link can be someone else than the Telegram user it was made for
      // (it may have been forwarded), so nothing is linked here. The Telegram user must confirm
      // in their own chat, which only they can do.
      const others = [
        ...(await state.revokeLinks(link.userId, 'login')),
        ...(await state.revokeLinks(link.userId, 'confirm')),
      ];
      const request = await createConfirmRequest(
        state,
        { userId: link.userId, ownerKey: session.ownerKey, email: session.email },
        now(),
      );
      const messageIds = [link, ...others]
        .map((each) => each.messageId)
        .filter((id): id is number => id !== undefined);
      return { link, messageIds, request };
    });
    if (result === 'elsewhere') return page(res, 409, linkedElsewherePage());
    if (!result) return gone();
    const requested = {
      userId: result.link.userId,
      email: session.email,
      ...result.request,
      messageIds: result.messageIds,
    };
    void Promise.resolve()
      .then(() => telegram.onLinkRequested?.(requested))
      .catch((cause: unknown) => console.error('Telegram link request failed', cause));
    return page(res, 200, linkRequestedPage(result.link.label, session.email));
  }

  /**
   * `/telegram/open/{token}`: opens the Telegram user's linked account in the app, after a
   * confirmation page and a same-origin POST, as long as the user is still linked to it. The
   * session is the account's own (as after its sign-in), marked `via: 'telegram'`.
   */
  async function telegramOpen(
    telegram: TelegramLinkOptions,
    req: IncomingMessage,
    res: ServerResponse,
    token: string,
    method: string,
  ) {
    const { state } = telegram;
    const hash = isLinkToken(token) ? hashLinkToken(token) : undefined;
    const gone = () => page(res, 404, telegramLinkErrorPage('open'));
    if (method === 'GET' || method === 'HEAD') {
      // Looking does not use the link up, so a link preview cannot spend it.
      const link = hash && (await state.peekLink(hash, 'open', now()));
      return link ? page(res, 200, openConfirmPage(link.label)) : gone();
    }
    if (method !== 'POST') throw new ApiError('NOT_FOUND', 'No such endpoint.');
    if (req.headers.origin !== options.origin) return page(res, 403, telegramLinkErrorPage('open'));
    const found = hash && (await state.peekLink(hash, 'open', now()));
    if (!found) return gone();
    const opened = await store.withOwnerLock(telegramUserLock(found.userId), async () => {
      const link = await state.takeLink(hash!, 'open', now());
      const account = link && (await state.getAccount(link.userId));
      // Unlinked (or linked elsewhere) since the link was made: it opens nothing.
      if (!link || !account || account.ownerKey !== link.ownerKey) return undefined;
      return openSession({ ownerKey: account.ownerKey, email: account.email, via: 'telegram' });
    });
    if (!opened) return gone();
    await replacePrevious(req, opened);
    return send(res, 303, undefined, {
      location: `${options.origin}/?signin=telegram#/settings`,
      'referrer-policy': 'no-referrer',
      'set-cookie': sessionCookie(opened),
    });
  }

  async function route(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://pilot.local');
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const method = req.method ?? 'GET';
    let match: RegExpExecArray | null;
    const wait = byAddress.take(clientAddress(req));
    if (wait) throw limited(wait);
    if (
      (method === 'POST' && (path === '/session' || path === '/dev/token')) ||
      path.startsWith('/auth/') ||
      path.startsWith('/whatsapp/open/') ||
      path.startsWith('/telegram/open/') ||
      path.startsWith('/telegram/link/')
    )
      limitSignIn(req);

    // A raw ID token carries no sign-in attempt nonce, so it could open sessions until it
    // expires. With Google sign-in on, sessions come only from the one-use callback flow.
    if (path === '/session' && method === 'POST' && (options.devSigner || !options.google)) {
      if (req.headers.origin !== options.origin)
        throw new ApiError('FORBIDDEN', 'Sign-in is only accepted from the pilot site.');
      const body = await readJson(req);
      const verified = await verifyIdToken(body.idToken, options.keys, identityPolicy());
      if (!verified.ok) throw new ApiError(verified.code, verified.reason);
      const opened = await openSession(verified.value);
      return send(res, 200, await sessionBody(opened.session), {
        'set-cookie': sessionCookie(opened),
      });
    }

    if (path === '/auth/google/start' && method === 'GET' && options.google) {
      // Only a Telegram login link's own page may be returned to; anything else is refused.
      const back = url.searchParams.get('return');
      const backToken = back === null ? undefined : TELEGRAM_LINK_RETURN.exec(back)?.[1];
      if (back !== null && (!backToken || !options.telegram))
        throw new ApiError('INVALID_INPUT', 'Sign-in cannot return there.');
      const verifier = random();
      const loginCookie = random();
      const attempt = {
        id: storedId(loginCookie),
        state: random(),
        nonce: random(),
        codeVerifier: verifier,
        expiresAt: now() + LOGIN_SECONDS,
      };
      await store.createLoginAttempt(attempt);
      const to = new URL(options.google.authorizeUrl ?? GOOGLE_AUTHORIZE);
      for (const [name, value] of Object.entries({
        client_id: options.clientId,
        redirect_uri: callbackUrl,
        response_type: 'code',
        scope: 'openid email',
        state: attempt.state,
        nonce: attempt.nonce,
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
        code_challenge_method: 'S256',
        hd: options.allowedEmailDomain,
        prompt: 'select_account',
      }))
        to.searchParams.set(name, value);
      const loginSet = `${LOGIN_COOKIE}=${loginCookie}; Path=/api/v1/auth; Max-Age=${LOGIN_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
      return send(res, 302, undefined, {
        location: to.href,
        'referrer-policy': 'no-referrer',
        'set-cookie': backToken
          ? [
              loginSet,
              `${RETURN_COOKIE}=${backToken}.${returnBinding(loginCookie, backToken)}; Path=/api/v1/auth; Max-Age=${LOGIN_SECONDS}; HttpOnly; Secure; SameSite=Lax`,
            ]
          : loginSet,
      });
    }

    if (path === '/auth/google/callback' && method === 'GET' && options.google) {
      const back = returnPath(req);
      const hadReturn = cookieValue(req, RETURN_COOKIE) !== undefined;
      const outcome = await finishGoogle(options.google, req, url);
      const clearLogin = `${LOGIN_COOKIE}=; Path=/api/v1/auth; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
      const clear = hadReturn ? [clearLogin, clearReturn] : [clearLogin];
      if ('session' in outcome)
        return send(res, 303, undefined, {
          // Back to the Telegram login link this sign-in started from, else to Settings.
          location: `${options.origin}${back ?? '/#/settings'}`,
          'referrer-policy': 'no-referrer',
          'set-cookie': [sessionCookie(outcome.session), ...clear],
        });
      return send(res, 303, undefined, {
        location: `${options.origin}/?signin=${outcome.result}#/settings`,
        'referrer-policy': 'no-referrer',
        'set-cookie': clear.length === 1 ? clearLogin : clear,
      });
    }

    if ((match = /^\/telegram\/link\/([^/]+)$/.exec(path)) && options.telegram)
      return telegramLogin(options.telegram, req, res, match[1], method);
    if ((match = /^\/telegram\/open\/([^/]+)$/.exec(path)) && options.telegram)
      return telegramOpen(options.telegram, req, res, match[1], method);

    // One-time WhatsApp links, each opening only that sender's vault.
    const linkChannel =
      (match = /^\/whatsapp\/open\/([^/]+)$/.exec(path)) && options.whatsapp
        ? { bot: options.whatsapp.bot, signin: 'whatsapp', name: 'WhatsApp', again: undefined }
        : undefined;
    if (match && linkChannel) {
      const { bot } = linkChannel;
      const errorPage = () => linkErrorPage(linkChannel.again);
      const token = match[1];
      const hash = isLinkToken(token) ? hashLinkToken(token) : undefined;
      if (method === 'GET' || method === 'HEAD') {
        // Looking does not use the link up, so a link preview cannot spend it.
        const link = hash && (await bot.peekLink(hash, now()));
        return link
          ? send(res, 200, confirmPage(link.label, linkChannel.name), PAGE_HEADERS)
          : send(res, 404, errorPage(), PAGE_HEADERS);
      }
      if (method !== 'POST') throw new ApiError('NOT_FOUND', 'No such endpoint.');
      if (req.headers.origin !== options.origin) return send(res, 403, errorPage(), PAGE_HEADERS);
      const found = hash && (await bot.peekLink(hash, now()));
      if (!found) return send(res, 404, errorPage(), PAGE_HEADERS);
      // Under the vault's lock, like DELETE ALL: a link taken after an erase finds nothing, so no
      // session opens on a vault that was just erased.
      const opened = await store.withOwnerLock(found.ownerKey, async () => {
        const link = await bot.takeLink(hash, now());
        if (!link || link.ownerKey !== found.ownerKey) return undefined;
        return openSession({ ownerKey: link.ownerKey, email: link.label });
      });
      if (!opened) return send(res, 404, errorPage(), PAGE_HEADERS);
      // A session this browser already had is replaced, not left behind.
      const previous = await sessionFromCookie(req);
      if (previous && previous.id !== opened.session.id) await store.deleteSession(previous.id);
      return send(res, 303, undefined, {
        location: `${options.origin}/?signin=${linkChannel.signin}#/settings`,
        'referrer-policy': 'no-referrer',
        'set-cookie': sessionCookie(opened),
      });
    }

    if (path === '/session' && method === 'GET') {
      // Same-origin pages restore their CSRF token after a reload; other sites cannot read it.
      return send(res, 200, await sessionBody(await requireSession(req, false)));
    }

    if (path === '/config' && method === 'GET') {
      return send(res, 200, { signIn: options.devSigner ? 'dev' : 'google' });
    }

    if (path === '/dev/token' && method === 'POST') {
      if (!options.devSigner) throw new ApiError('NOT_FOUND', 'No such endpoint.');
      if (req.headers.origin !== options.origin)
        throw new ApiError(
          'FORBIDDEN',
          'Development sign-in is only accepted from the pilot site.',
        );
      const body = await readJson(req);
      if (typeof body.email !== 'string' || !body.email || body.email.length > 254)
        throw new ApiError('INVALID_INPUT', 'Enter an email address.');
      return send(res, 200, { idToken: options.devSigner(body.email) });
    }

    if (path === '/session' && method === 'DELETE') {
      const session = await requireSession(req, true);
      await store.deleteSession(session.id);
      return send(res, 204, undefined, {
        'set-cookie': `${COOKIE}=; Path=/api; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
      });
    }

    if (path === '/changes' && method === 'GET') {
      const session = await requireSession(req, false);
      const { epoch } = await store.vault(session.ownerKey);
      if (Number(url.searchParams.get('epoch')) !== epoch)
        throw new ApiError('RESYNC_REQUIRED', 'The cloud library was reset; fetch it again.');
      const after = Number(url.searchParams.get('after') ?? '0');
      if (!Number.isSafeInteger(after) || after < 0)
        throw new ApiError('INVALID_INPUT', 'after must be a cursor.');
      return send(res, 200, await store.changesAfter(session.ownerKey, after));
    }

    if ((match = /^\/items\/([^/]+)\/upload$/.exec(path)) && method === 'POST') {
      const session = await requireSession(req, true);
      const globalId = match[1];
      const body = await readJson(req);
      const opId = opIdOf(body);
      const epoch = await requireEpoch(session.ownerKey, body);
      const result = await idempotent(session.ownerKey, opId, async () => {
        // An encrypted library takes only sealed items from devices, and a plain one only plain
        // items; the server checks and stores the ciphertext's length and hash.
        const encrypted = (await store.vaultE2ee(session.ownerKey)) !== undefined;
        let declared: ItemDescription | SealedUpload;
        if (body.sealed !== undefined) {
          if (!encrypted)
            throw new ApiError(
              'INVALID_INPUT',
              'End-to-end encryption is not on for this library.',
            );
          if (!UUID_V4.test(globalId))
            throw new ApiError('INVALID_INPUT', 'globalId must be a lowercase UUID v4.');
          const valid = validateSealedItemFields(body.sealed);
          if (!valid.ok) throw new ApiError(valid.code, valid.reason);
          declared = {
            byteLength: valid.value.cipherByteLength,
            contentSha256: valid.value.cipherSha256,
            sealed: valid.value,
          };
        } else {
          if (encrypted)
            throw new ApiError('INVALID_INPUT', 'This library is end-to-end encrypted.');
          const description = pickItemDescription(body.item);
          const valid = validateCloudItem({ ...description, globalId });
          if (!valid.ok) throw new ApiError(valid.code, valid.reason);
          declared = description;
        }
        const existing = await findItem(session.ownerKey, globalId);
        if (existing?.deleted) throw new ApiError('ITEM_DELETED', 'This item was deleted.');
        if (existing) throw new ApiError('INVALID_INPUT', 'This item already exists.');
        if (
          (await store.committedBytes(session.ownerKey)) + declared.byteLength >
          options.quotaBytes
        )
          throw new ApiError('QUOTA_EXCEEDED', 'This would exceed your cloud storage quota.');
        const uploadId = randomUUID();
        await store.createUpload({
          uploadId,
          ownerKey: session.ownerKey,
          epoch,
          globalId,
          item: declared,
          createdAt: now(),
        });
        return { status: 200, body: { uploadId, chunkBytes } };
      });
      return send(res, result.status, result.body);
    }

    if ((match = /^\/uploads\/([^/]+)\/chunks\/(\d{1,5})$/.exec(path)) && method === 'PUT') {
      const session = await requireSession(req, true);
      const upload = await store.getUpload(match[1]);
      if (!upload || upload.ownerKey !== session.ownerKey)
        throw new ApiError('NOT_FOUND', 'Upload not found.');
      if (upload.result) return send(res, 204);
      if (upload.createdAt + uploadTtl <= now())
        throw new ApiError('NOT_FOUND', 'This upload expired; start it again.');
      const n = Number(match[2]);
      if (n * chunkBytes >= upload.item.byteLength)
        throw new ApiError('INVALID_INPUT', 'Chunk is beyond the declared length.');
      // Each chunk must fill exactly its place, so stored bytes never exceed the declared size.
      const expected = Math.min(chunkBytes, upload.item.byteLength - n * chunkBytes);
      const part = await readBody(req, chunkBytes);
      if (part.length !== expected)
        throw new ApiError('INVALID_INPUT', `Chunk ${n} must be ${expected} bytes.`);
      await objects.put(stagingKey(upload.uploadId, n), part);
      await store.recordChunk(upload.uploadId, n);
      return send(res, 204);
    }

    if ((match = /^\/uploads\/([^/]+)\/complete$/.exec(path)) && method === 'POST') {
      const session = await requireSession(req, true);
      const body = await readJson(req);
      const opId = opIdOf(body);
      // Checked first: uploads begun before the library was removed must not complete.
      const epoch = await requireEpoch(session.ownerKey, body);
      const upload = await store.getUpload(match[1]);
      if (!upload || upload.ownerKey !== session.ownerKey)
        throw new ApiError('NOT_FOUND', 'Upload not found.');
      // A completed upload answers with its item, whatever the retry's operation ID.
      if (upload.result) return send(res, 200, { item: upload.result });
      if (upload.createdAt + uploadTtl <= now())
        throw new ApiError('NOT_FOUND', 'This upload expired; start it again.');
      const result = await idempotent(session.ownerKey, opId, async () => {
        const count = Math.ceil(upload.item.byteLength / chunkBytes);
        const received = new Set(await store.receivedChunks(upload.uploadId));
        const parts: string[] = [];
        for (let n = 0; n < count; n++) {
          if (!received.has(n)) throw new ApiError('INVALID_INPUT', `Chunk ${n} is missing.`);
          parts.push(stagingKey(upload.uploadId, n));
        }
        // Hash the staged parts one at a time; the whole file is never held in memory.
        const hash = createHash('sha256');
        let length = 0;
        for (const key of parts) {
          const part = await objects.get(key);
          if (!part) throw new ApiError('INVALID_INPUT', 'A chunk is missing; send it again.');
          hash.update(part);
          length += part.length;
        }
        if (length !== upload.item.byteLength)
          throw new ApiError('HASH_MISMATCH', 'Uploaded length does not match the declaration.');
        if (hash.digest('hex') !== upload.item.contentSha256)
          throw new ApiError('HASH_MISMATCH', 'Uploaded bytes do not match the declared SHA-256.');
        const existing = await findItem(session.ownerKey, upload.globalId);
        if (existing?.deleted) throw new ApiError('ITEM_DELETED', 'This item was deleted.');
        if (existing) {
          // Published before a crash, but not yet marked finished: finish it now.
          const published = publicItem(existing);
          await store.finishUpload(upload.uploadId, published);
          return { status: 200, body: { item: published } };
        }
        const objectKey = `${session.ownerKey}/${upload.epoch}/${upload.globalId}/original`;
        await objects.compose(objectKey, parts);
        const identity = { globalId: upload.globalId, revision: 1, deleted: false, objectKey };
        const item: AnyStoredItem = isSealedUpload(upload.item)
          ? { ...identity, byteLength: upload.item.byteLength, sealed: upload.item.sealed }
          : { ...pickItemDescription(upload.item), ...identity };
        await store.publish(session.ownerKey, item, epoch);
        const published = publicItem(item);
        await store.finishUpload(upload.uploadId, published);
        for (const key of parts) await objects.delete(key);
        return { status: 200, body: { item: published } };
      });
      return send(res, result.status, result.body);
    }

    if ((match = /^\/items\/([^/]+)$/.exec(path)) && (method === 'PATCH' || method === 'DELETE')) {
      const session = await requireSession(req, true);
      const body = await readJson(req);
      const opId = opIdOf(body);
      const epoch = await requireEpoch(session.ownerKey, body);
      const result = await idempotent(session.ownerKey, opId, async () => {
        const current = await findItem(session.ownerKey, match![1]);
        if (!current) throw new ApiError('NOT_FOUND', 'Item not found.');
        const write = (
          method === 'DELETE'
            ? { type: 'delete', expectedRevision: body.expectedRevision }
            : { type: 'rename', expectedRevision: body.expectedRevision, title: body.title }
        ) as ItemWrite;
        // An encrypted item is renamed with sealed metadata; a plain title is refused.
        const decision =
          isSealed(current) && write.type === 'rename'
            ? decideSealedRename(current, body)
            : decideWrite(current, write);
        if (decision.action === 'reject') {
          if (decision.code === 'REVISION_CONFLICT')
            throw new ApiError(decision.code, 'The item changed on another device.', {
              current: publicItem(current),
            });
          throw new ApiError(decision.code, 'This change cannot be applied.');
        }
        const revision = decision.nextRevision;
        let next: AnyStoredItem;
        if (isSealed(current))
          next =
            write.type === 'delete'
              ? // A sealed tombstone keeps nothing but identity: no wrapped key, no ciphertext.
                { globalId: current.globalId, revision, deleted: true, byteLength: 0 }
              : {
                  ...current,
                  revision,
                  sealed: {
                    ...current.sealed!,
                    sealedMeta: body.sealedMeta as string,
                    metaRevision: body.metaRevision as number,
                  },
                };
        else
          next =
            write.type === 'delete'
              ? {
                  ...current,
                  revision,
                  deleted: true,
                  objectKey: undefined,
                  indexObjectKey: undefined,
                  indexBytes: undefined,
                  index: undefined,
                }
              : { ...current, revision, title: write.title };
        await store.publish(session.ownerKey, next, epoch);
        // Blobs go only after the tombstone has committed: if publishing or the commit fails,
        // the item and its original stay readable everywhere, and a retried delete finishes
        // the job.
        if (write.type === 'delete') {
          for (const key of [current.objectKey, current.indexObjectKey])
            if (key?.startsWith(`${session.ownerKey}/`))
              await afterCommit(res, () => objects.delete(key));
        }
        return { status: 200, body: { item: publicItem(next) } };
      });
      return send(res, result.status, result.body);
    }

    if ((match = /^\/items\/([^/]+)\/original$/.exec(path)) && method === 'GET') {
      const session = await requireSession(req, false);
      const item = await findItem(session.ownerKey, match[1]);
      if (
        !item ||
        item.deleted ||
        !item.objectKey ||
        !item.objectKey.startsWith(`${session.ownerKey}/`)
      )
        throw new ApiError('NOT_FOUND', 'Item not found.');
      // An encrypted original is served as the ciphertext it was stored as.
      const sealed = isSealed(item) ? item.sealed : undefined;
      const size = item.byteLength;
      const headers = {
        'content-type': sealed ? 'application/octet-stream' : (item as StoredItem).mimeType,
        etag: `"sha256-${sealed ? sealed.cipherSha256 : (item as StoredItem).contentSha256}"`,
        'accept-ranges': 'bytes',
        // The app reads originals with fetch; a browser opening this URL directly must neither
        // render nor run what was uploaded.
        'content-disposition': 'attachment',
        'content-security-policy': "sandbox; default-src 'none'",
      };
      const range = req.headers.range;
      const parsed = range === undefined ? undefined : parseRange(range, size);
      if (range !== undefined && !parsed)
        return send(res, 416, errorBody('INVALID_INPUT', 'Requested range is not available.'), {
          'content-range': `bytes */${size}`,
        });
      // Only the requested part is read from storage.
      const bytes = await objects.get(item.objectKey, parsed);
      if (!bytes) throw new ApiError('NOT_FOUND', 'Item not found.');
      if (!parsed) return send(res, 200, bytes, headers);
      return send(res, 206, bytes, {
        ...headers,
        'content-range': `bytes ${parsed.start}-${parsed.end}/${size}`,
      });
    }

    if (path === '/vault' && method === 'DELETE') {
      const session = await requireSession(req, true);
      const body = await readJson(req);
      if (body.confirm !== 'remove-cloud-library')
        throw new ApiError('INVALID_INPUT', 'Confirm removing the cloud library.');
      await requireEpoch(session.ownerKey, body);
      const epoch = await resetOwnerVault(store, objects, session.ownerKey, (task) =>
        afterCommit(res, task),
      );
      return send(res, 200, { vault: { epoch } });
    }

    if ((match = /^\/items\/([^/]+)\/index$/.exec(path)) && method === 'PUT') {
      const session = await requireSession(req, true);
      const { value: body, bytes: received } = await readJsonWithBytes(req, MAX_INDEX_BYTES);
      const opId = opIdOf(body);
      const epoch = await requireEpoch(session.ownerKey, body);
      const result = await idempotent(session.ownerKey, opId, async () => {
        const current = await store.getAnyItem(session.ownerKey, match![1]);
        if (current && isSealed(current)) {
          const next = await publishSealedIndex(session.ownerKey, epoch, current, body);
          return { status: 200, body: { item: publicItem(next) } };
        }
        if (current && body.sealedIndex !== undefined)
          throw new ApiError('INVALID_INPUT', 'Only an encrypted item takes a sealed index.');
        try {
          const next = await publishIndexBundle(
            {
              store,
              objects,
              quotaBytes: options.quotaBytes,
              supportedIndexVersions: options.supportedIndexVersions,
            },
            session.ownerKey,
            epoch,
            match![1],
            body.bundle as IndexBundle,
            // Stored as received: the bundle's own bytes from the validated body, not re-encoded.
            () => memberBytes(received, 'bundle'),
          );
          return { status: 200, body: { item: publicItem(next) } };
        } catch (cause) {
          if (cause instanceof IndexPublishError) throw new ApiError(cause.code, cause.message);
          throw cause;
        }
      });
      return send(res, result.status, result.body);
    }

    if ((match = /^\/items\/([^/]+)\/index$/.exec(path)) && method === 'GET') {
      const session = await requireSession(req, false);
      const item = await findItem(session.ownerKey, match[1]);
      if (item?.deleted) throw new ApiError('ITEM_DELETED', 'This item was deleted.');
      if (!item || !item.indexObjectKey || !item.indexObjectKey.startsWith(`${session.ownerKey}/`))
        throw new ApiError('NOT_FOUND', 'No index for this item.');
      const bytes = await objects.get(item.indexObjectKey);
      if (!bytes) throw new ApiError('NOT_FOUND', 'No index for this item.');
      return send(res, 200, bytes, {
        'content-type': isSealed(item) ? 'application/octet-stream' : 'application/json',
      });
    }

    if (path === '/vault/e2ee' && method === 'PUT') {
      const session = await requireSession(req, true);
      const body = await readJson(req);
      const opId = opIdOf(body);
      const epoch = await requireEpoch(session.ownerKey, body);
      const result = await idempotent(session.ownerKey, opId, async () => {
        const valid = validateVaultE2ee(body);
        if (!valid.ok) throw new ApiError(valid.code, valid.reason);
        const outcome = await store.setVaultE2ee(session.ownerKey, epoch, valid.value);
        if (outcome === 'reset') throw new VaultResetError();
        // Once per epoch: replacing the key would strand every device and every sealed item.
        if (outcome === 'conflict')
          throw new ApiError(
            'INVALID_INPUT',
            'End-to-end encryption is already on for this library.',
          );
        return { status: 200, body: { e2ee: valid.value } };
      });
      return send(res, result.status, result.body);
    }

    // Pairing (docs/pilot/e2ee-design.md, "Adding a device"). The server relays public keys and
    // the sealed recovery secret within one account; it never sees the secret itself.
    if (path === '/pairing' && method === 'POST') {
      const session = await requireSession(req, true);
      const body = await readJson(req);
      await requireE2ee(session.ownerKey);
      if (!validPairingPublicKey(body.publicKey))
        throw new ApiError('INVALID_INPUT', 'publicKey must be an uncompressed P-256 key.');
      const code = newPairingCode();
      const pairing = {
        pairingId: randomUUID(),
        ownerKey: session.ownerKey,
        codeHash: pairingCodeHash(code),
        newPublicKey: body.publicKey,
        expiresAt: now() + PAIRING_SECONDS,
      };
      await store.createPairing(pairing);
      return send(res, 200, { pairingId: pairing.pairingId, code, expiresAt: pairing.expiresAt });
    }

    if (path === '/pairing/claim' && method === 'POST') {
      const session = await requireSession(req, true);
      const body = await readJson(req);
      await requireE2ee(session.ownerKey);
      // Every try counts, right or wrong, so codes cannot be guessed.
      const wait = pairingClaims.take(session.ownerKey);
      if (wait) throw limited(wait);
      const code = normalizePairingCode(body.code);
      const pairing = code && (await store.findPairing(session.ownerKey, pairingCodeHash(code)));
      if (!pairing || pairing.claimed || pairing.expiresAt <= now())
        throw new ApiError('NOT_FOUND', 'That code is not valid. Check it, or start again.');
      await store.updatePairing({ ...pairing, claimed: true });
      return send(res, 200, { pairingId: pairing.pairingId, publicKey: pairing.newPublicKey });
    }

    if ((match = /^\/pairing\/([^/]+)\/secret$/.exec(path)) && method === 'PUT') {
      const session = await requireSession(req, true);
      const body = await readJson(req);
      await requireE2ee(session.ownerKey);
      const pairing = await store.getPairing(match[1]);
      if (
        !pairing ||
        pairing.ownerKey !== session.ownerKey ||
        pairing.expiresAt <= now() ||
        !pairing.claimed ||
        pairing.sealedSecret
      )
        throw new ApiError('NOT_FOUND', 'This pairing is not waiting for a key.');
      if (!validPairingPublicKey(body.publicKey) || !validPairingSealedSecret(body.sealedSecret))
        throw new ApiError('INVALID_INPUT', 'Send a P-256 public key and the sealed secret.');
      await store.updatePairing({
        ...pairing,
        oldPublicKey: body.publicKey,
        sealedSecret: body.sealedSecret,
      });
      return send(res, 204);
    }

    if ((match = /^\/pairing\/([^/]+)$/.exec(path)) && method === 'GET') {
      const session = await requireSession(req, false);
      const pairing = await store.getPairing(match[1]);
      if (!pairing || pairing.ownerKey !== session.ownerKey || pairing.expiresAt <= now())
        throw new ApiError('NOT_FOUND', 'Pairing not found.');
      if (!pairing.sealedSecret)
        return send(res, 200, { status: pairing.claimed ? 'claimed' : 'waiting' });
      // Handed over once: the new device has what it needs, and the record goes.
      await store.deletePairing(pairing.pairingId);
      return send(res, 200, {
        status: 'ready',
        publicKey: pairing.oldPublicKey,
        sealedSecret: pairing.sealedSecret,
      });
    }

    throw new ApiError('NOT_FOUND', 'No such endpoint.');
  }

  /**
   * Stores an encrypted item's sealed index bundle. The server can check only that it is
   * for the item's current sealed metadata; devices check its contents after opening it.
   */
  async function publishSealedIndex(
    ownerKey: string,
    epoch: number,
    current: SealedStoredItem,
    body: Record<string, unknown>,
  ) {
    if (current.deleted || !current.sealed)
      throw new ApiError('ITEM_DELETED', 'This item was deleted.');
    if (
      !validSealedBlob(body.sealedIndex, MAX_INDEX_BYTES) ||
      !validMetaRevision(body.metaRevision)
    )
      throw new ApiError(
        'INVALID_INPUT',
        'An encrypted item takes a sealedIndex and metaRevision.',
      );
    if (body.metaRevision !== current.sealed.metaRevision)
      throw new ApiError('INDEX_INCOMPATIBLE', 'This index was built for other item metadata.');
    const stored = new Uint8Array(Buffer.from(body.sealedIndex, 'base64url'));
    // The new bundle replaces any earlier one, so only the difference is new storage.
    const used = (await store.committedBytes(ownerKey)) - (current.indexBytes ?? 0);
    if (used + stored.length > options.quotaBytes)
      throw new ApiError('QUOTA_EXCEEDED', 'This would exceed your cloud storage quota.');
    const indexObjectKey = `${ownerKey}/${epoch}/${current.globalId}/index`;
    await objects.put(indexObjectKey, stored);
    const next: SealedStoredItem = {
      ...current,
      sealedIndex: { metaRevision: body.metaRevision, byteLength: stored.length },
      indexObjectKey,
      indexBytes: stored.length,
    };
    await store.publish(ownerKey, next, epoch);
    return next;
  }

  /** The largest body any route on this path accepts; each route still applies its own limit. */
  function bodyLimitFor(method: string, rawUrl: string) {
    const path = new URL(rawUrl, 'http://pilot.local').pathname.replace(/^\/api\/v1/, '');
    if (method === 'PUT' && /^\/uploads\/[^/]+\/chunks\/\d{1,5}$/.test(path)) return chunkBytes;
    if (method === 'PUT' && /^\/items\/[^/]+\/index$/.test(path)) return MAX_INDEX_BYTES;
    return MAX_JSON_BYTES;
  }

  const whatsapp = options.whatsapp && createWhatsAppWebhook(options.whatsapp, now);
  const telegram = options.telegram?.webhook && createTelegramWebhook(options.telegram.webhook);

  async function dispatch(req: IncomingMessage, res: ServerResponse) {
    if (whatsapp) {
      const url = new URL(req.url ?? '/', 'http://pilot.local');
      if (url.pathname === WEBHOOK_PATH) return whatsapp(req, res, url);
    }
    if (telegram) {
      const url = new URL(req.url ?? '/', 'http://pilot.local');
      if (url.pathname === TELEGRAM_WEBHOOK_PATH) return telegram(req, res);
    }
    const method = req.method ?? 'GET';
    if (method === 'GET' || method === 'HEAD') return route(req, res);
    // Opening a bot link takes that vault's lock itself; holding the browser's current
    // session's lock as well could wait on itself when both are the same vault.
    if (options.whatsapp && (req.url ?? '').startsWith(OPEN_PATH_PREFIX)) return route(req, res);
    if (
      options.telegram &&
      ((req.url ?? '').startsWith(TELEGRAM_OPEN_PREFIX) ||
        (req.url ?? '').startsWith(TELEGRAM_LINK_PREFIX))
    )
      return route(req, res);
    const session = await sessionFromCookie(req);
    if (!session || session.expiresAt <= now()) return route(req, res);
    // The body is read before the lock is taken: the lock holds a database connection for the
    // whole request, so a client sending slowly would otherwise keep one of the pool's few
    // connections (and the account's lock) until it finished, and a handful of slow uploads
    // would stall every account's requests (#66).
    await preloadBody(req, bodyLimitFor(method, req.url ?? '/'));
    const pending: { flush?: () => void; afterCommit: Array<() => Promise<void>> } = {
      afterCommit: [],
    };
    pendingResponses.set(res, pending);
    try {
      await store.withOwnerLock(session.ownerKey, () => route(req, res));
    } finally {
      pendingResponses.delete(res);
    }
    // Work that must not run inside the transaction (see `afterCommit`). The change is already
    // committed, so a failure here cannot undo it and does not change the answer.
    await runAfterCommit(pending.afterCommit);
    pending.flush?.();
  }

  return (req, res) => {
    dispatch(req, res).catch((caught: unknown) => {
      if (res.headersSent) return res.destroy();
      // A reset between the epoch check and the write is reported like an old epoch.
      const cause =
        caught instanceof VaultResetError
          ? new ApiError('VAULT_RESET', 'This cloud library was reset; resynchronise first.')
          : caught;
      if (cause instanceof ApiError)
        return send(
          res,
          STATUS[cause.code],
          { ...errorBody(cause.code, cause.message), ...cause.extra },
          cause.headers,
        );
      console.error('Pilot API error', cause);
      send(res, 500, errorBody('INTERNAL_ERROR', 'Something went wrong. Try again.'));
    });
  };
}
