/// <reference types="node" />
// Pilot sync API (docs/pilot/protocol.md). Plain node:http, no framework.
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import {
  decideWrite,
  pickItemDescription,
  validateCloudItem,
  type IndexBundle,
  type CloudItem,
  type ItemWrite,
  type PilotErrorCode,
} from '../contract';
import {
  VaultResetError,
  publicItem,
  stagingKey,
  type ObjectStore,
  type PilotStore,
  type Session,
  type StoredItem,
} from './store';
import { IndexPublishError, publishIndexBundle } from './index-publish';
import { DEFAULT_LIMITS, RateLimiter, type RateLimits } from './limits';
import { resetOwnerVault } from './vault-reset';
import type { KeySource } from './tokens';
import { verifyIdToken } from './tokens';
import {
  WEBHOOK_PATH,
  createWhatsAppWebhook,
  type WhatsAppWebhookOptions,
} from './whatsapp/webhook';

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
   */
  whatsapp?: WhatsAppWebhookOptions;
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
const LOGIN_SECONDS = 600;
const GOOGLE_AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const random = () => randomBytes(32).toString('base64url');
/**
 * Sessions and sign-in attempts are stored under the SHA-256 of their cookie value, so a copy
 * of the database cannot be turned back into a working cookie.
 */
const storedId = (cookie: string) => createHash('sha256').update(cookie).digest('hex');
const sameText = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const MAX_JSON_BYTES = 64 * 1024;
// 2,000 segments of 768 numbers as JSON stay well under this.
const MAX_INDEX_BYTES = 24 * 1024 * 1024;

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
const pendingResponses = new WeakMap<ServerResponse, { flush?: () => void }>();
/** A session just opened, with the cookie value that only the browser keeps. */
interface OpenedSession {
  session: Session;
  cookie: string;
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

async function readBody(req: IncomingMessage, limit: number): Promise<Uint8Array> {
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
  const clientAddress = (req: IncomingMessage) => {
    const forwarded = options.trustProxy ? req.headers['x-forwarded-for'] : undefined;
    const last = typeof forwarded === 'string' ? forwarded.split(',').at(-1)?.trim() : undefined;
    return last || req.socket.remoteAddress || 'unknown';
  };
  const limitSignIn = (req: IncomingMessage) => {
    const wait = signIns.take(clientAddress(req));
    if (wait) throw limited(wait);
  };
  const sessionBody = async (session: Session) => ({
    csrf: session.csrf,
    email: session.email,
    // Opaque per-account ID so devices can keep each account's state apart.
    account: createHash('sha256').update(session.ownerKey).digest('hex').slice(0, 32),
    vault: await store.vault(session.ownerKey),
  });

  const sessionCookie = (opened: OpenedSession) =>
    `${COOKIE}=${opened.cookie}; Path=/api; Max-Age=${sessionSeconds}; HttpOnly; Secure; SameSite=Lax`;
  /** Stores a new session; only its hash is kept, the cookie value goes to the browser. */
  async function openSession(identity: { ownerKey: string; email: string }) {
    const cookie = randomBytes(32).toString('base64url');
    const session: Session = {
      id: storedId(cookie),
      csrf: randomBytes(24).toString('base64url'),
      ownerKey: identity.ownerKey,
      email: identity.email,
      expiresAt: now() + sessionSeconds,
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

  async function route(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://pilot.local');
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const method = req.method ?? 'GET';
    let match: RegExpExecArray | null;
    const wait = byAddress.take(clientAddress(req));
    if (wait) throw limited(wait);
    if (
      (method === 'POST' && (path === '/session' || path === '/dev/token')) ||
      path.startsWith('/auth/')
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
      return send(res, 302, undefined, {
        location: to.href,
        'referrer-policy': 'no-referrer',
        'set-cookie': `${LOGIN_COOKIE}=${loginCookie}; Path=/api/v1/auth; Max-Age=${LOGIN_SECONDS}; HttpOnly; Secure; SameSite=Lax`,
      });
    }

    if (path === '/auth/google/callback' && method === 'GET' && options.google) {
      const outcome = await finishGoogle(options.google, req, url);
      const clearLogin = `${LOGIN_COOKIE}=; Path=/api/v1/auth; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
      if ('session' in outcome)
        return send(res, 303, undefined, {
          location: `${options.origin}/#/settings`,
          'referrer-policy': 'no-referrer',
          'set-cookie': [sessionCookie(outcome.session), clearLogin],
        });
      return send(res, 303, undefined, {
        location: `${options.origin}/?signin=${outcome.result}#/settings`,
        'referrer-policy': 'no-referrer',
        'set-cookie': clearLogin,
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
        const description = pickItemDescription(body.item);
        const item = { ...description, globalId };
        const valid = validateCloudItem(item);
        if (!valid.ok) throw new ApiError(valid.code, valid.reason);
        const existing = await store.getItem(session.ownerKey, globalId);
        if (existing?.deleted) throw new ApiError('ITEM_DELETED', 'This item was deleted.');
        if (existing) throw new ApiError('INVALID_INPUT', 'This item already exists.');
        if ((await store.committedBytes(session.ownerKey)) + item.byteLength > options.quotaBytes)
          throw new ApiError('QUOTA_EXCEEDED', 'This would exceed your cloud storage quota.');
        const uploadId = randomUUID();
        await store.createUpload({
          uploadId,
          ownerKey: session.ownerKey,
          epoch,
          globalId,
          item: description,
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
        const existing = await store.getItem(session.ownerKey, upload.globalId);
        if (existing?.deleted) throw new ApiError('ITEM_DELETED', 'This item was deleted.');
        if (existing) {
          // Published before a crash, but not yet marked finished: finish it now.
          const published = publicItem(existing) as CloudItem;
          await store.finishUpload(upload.uploadId, published);
          return { status: 200, body: { item: published } };
        }
        const objectKey = `${session.ownerKey}/${upload.epoch}/${upload.globalId}/original`;
        await objects.compose(objectKey, parts);
        const description = pickItemDescription(upload.item);
        const item: StoredItem = {
          ...description,
          globalId: upload.globalId,
          revision: 1,
          deleted: false,
          objectKey,
        };
        await store.publish(session.ownerKey, item, epoch);
        const published = publicItem(item) as CloudItem;
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
        const current = await store.getItem(session.ownerKey, match![1]);
        if (!current) throw new ApiError('NOT_FOUND', 'Item not found.');
        const write = (
          method === 'DELETE'
            ? { type: 'delete', expectedRevision: body.expectedRevision }
            : { type: 'rename', expectedRevision: body.expectedRevision, title: body.title }
        ) as ItemWrite;
        const decision = decideWrite(current, write);
        if (decision.action === 'reject') {
          if (decision.code === 'REVISION_CONFLICT')
            throw new ApiError(decision.code, 'The item changed on another device.', {
              current: publicItem(current),
            });
          throw new ApiError(decision.code, 'This change cannot be applied.');
        }
        const next =
          write.type === 'delete'
            ? {
                ...current,
                revision: decision.nextRevision,
                deleted: true,
                objectKey: undefined,
                indexObjectKey: undefined,
                indexBytes: undefined,
                index: undefined,
              }
            : { ...current, revision: decision.nextRevision, title: write.title };
        await store.publish(session.ownerKey, next, epoch);
        // Blobs go only after the tombstone is written: if publishing fails, the item and its
        // original stay readable everywhere, and a retried delete finishes the job.
        if (write.type === 'delete') {
          for (const key of [current.objectKey, current.indexObjectKey])
            if (key?.startsWith(`${session.ownerKey}/`)) await objects.delete(key);
        }
        return { status: 200, body: { item: publicItem(next) } };
      });
      return send(res, result.status, result.body);
    }

    if ((match = /^\/items\/([^/]+)\/original$/.exec(path)) && method === 'GET') {
      const session = await requireSession(req, false);
      const item = await store.getItem(session.ownerKey, match[1]);
      if (
        !item ||
        item.deleted ||
        !item.objectKey ||
        !item.objectKey.startsWith(`${session.ownerKey}/`)
      )
        throw new ApiError('NOT_FOUND', 'Item not found.');
      const size = item.byteLength;
      const headers = {
        'content-type': item.mimeType,
        etag: `"sha256-${item.contentSha256}"`,
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
      const epoch = await resetOwnerVault(store, objects, session.ownerKey);
      return send(res, 200, { vault: { epoch } });
    }

    if ((match = /^\/items\/([^/]+)\/index$/.exec(path)) && method === 'PUT') {
      const session = await requireSession(req, true);
      const { value: body, bytes: received } = await readJsonWithBytes(req, MAX_INDEX_BYTES);
      const opId = opIdOf(body);
      const epoch = await requireEpoch(session.ownerKey, body);
      const result = await idempotent(session.ownerKey, opId, async () => {
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
      const item = await store.getItem(session.ownerKey, match[1]);
      if (item?.deleted) throw new ApiError('ITEM_DELETED', 'This item was deleted.');
      if (!item || !item.indexObjectKey || !item.indexObjectKey.startsWith(`${session.ownerKey}/`))
        throw new ApiError('NOT_FOUND', 'No index for this item.');
      const bytes = await objects.get(item.indexObjectKey);
      if (!bytes) throw new ApiError('NOT_FOUND', 'No index for this item.');
      return send(res, 200, bytes, { 'content-type': 'application/json' });
    }

    throw new ApiError('NOT_FOUND', 'No such endpoint.');
  }

  const whatsapp = options.whatsapp && createWhatsAppWebhook(options.whatsapp, now);

  async function dispatch(req: IncomingMessage, res: ServerResponse) {
    if (whatsapp) {
      const url = new URL(req.url ?? '/', 'http://pilot.local');
      if (url.pathname === WEBHOOK_PATH) return whatsapp(req, res, url);
    }
    const method = req.method ?? 'GET';
    if (method === 'GET' || method === 'HEAD') return route(req, res);
    const session = await sessionFromCookie(req);
    if (!session || session.expiresAt <= now()) return route(req, res);
    const pending: { flush?: () => void } = {};
    pendingResponses.set(res, pending);
    try {
      await store.withOwnerLock(session.ownerKey, () => route(req, res));
    } finally {
      pendingResponses.delete(res);
    }
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
