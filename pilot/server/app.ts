/// <reference types="node" />
// Pilot sync API (docs/pilot/protocol.md). Plain node:http, no framework.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import {
  decideWrite,
  PILOT_INDEX_VERSIONS,
  searchMetadataDigest,
  validateCloudItem,
  validateIndexBundle,
  type IndexBundle,
  type CloudItem,
  type ItemWrite,
  type PilotErrorCode,
} from '../contract';
import {
  publicItem,
  type ItemDescription,
  type ObjectStore,
  type PilotStore,
  type Session,
} from './store';
import type { KeySource } from './tokens';
import { verifyIdToken } from './tokens';

export interface PilotServerOptions {
  projectId: string;
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
   * Local development only: signs a token for an email so the app can sign in before the
   * Firebase project exists. When set, `/config` reports `dev` and `/dev/token` is enabled.
   */
  devSigner?: (email: string) => string;
  /** Index versions accepted from devices; defaults to the pilot contract's list. */
  supportedIndexVersions?: readonly string[];
  /** Public Firebase web-app settings for direct Google sign-in; not secrets. */
  firebaseWeb?: { apiKey: string; authDomain: string };
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
  INTERNAL_ERROR: 500,
};
const RETRYABLE = new Set<PilotErrorCode>(['INTERNAL_ERROR']);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const COOKIE = 'recall_session';
const MAX_JSON_BYTES = 64 * 1024;
// 2,000 segments of 768 numbers as JSON stay well under this.
const MAX_INDEX_BYTES = 24 * 1024 * 1024;

class ApiError extends Error {
  constructor(
    readonly code: PilotErrorCode,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}
const errorBody = (code: PilotErrorCode, message: string) => ({
  error: { code, message, retryable: RETRYABLE.has(code) },
});

function send(
  res: ServerResponse,
  status: number,
  body?: unknown,
  headers: Record<string, string> = {},
) {
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
  return new Uint8Array(Buffer.concat(parts));
}
async function readJson(
  req: IncomingMessage,
  limit = MAX_JSON_BYTES,
): Promise<Record<string, unknown>> {
  const bytes = await readBody(req, limit);
  try {
    const value = JSON.parse(Buffer.from(bytes).toString('utf8'));
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch {
    // Fall through to the error below.
  }
  throw new ApiError('INVALID_INPUT', 'Body must be a JSON object.');
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
  const sessionBody = async (session: Session) => ({
    csrf: session.csrf,
    email: session.email,
    // Opaque per-account ID so devices can keep each account's state apart.
    account: createHash('sha256').update(session.ownerKey).digest('hex').slice(0, 32),
    vault: await store.vault(session.ownerKey),
  });

  async function requireSession(req: IncomingMessage, write: boolean): Promise<Session> {
    const id = cookieValue(req, COOKIE);
    const session = id ? await store.getSession(id) : undefined;
    if (!session || session.expiresAt <= now()) {
      if (session) await store.deleteSession(session.id);
      throw new ApiError('UNAUTHENTICATED', 'Sign in again.');
    }
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
    await store.saveResponse(ownerKey, opId, result);
    return result;
  }

  async function route(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://pilot.local');
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const method = req.method ?? 'GET';
    let match: RegExpExecArray | null;

    if (path === '/session' && method === 'POST') {
      if (req.headers.origin !== options.origin)
        throw new ApiError('FORBIDDEN', 'Sign-in is only accepted from the pilot site.');
      const body = await readJson(req);
      const verified = await verifyIdToken(body.idToken, options.keys, {
        projectId: options.projectId,
        allowedEmailDomain: options.allowedEmailDomain,
        nowSeconds: now(),
        skewSeconds: 60,
      });
      if (!verified.ok) throw new ApiError(verified.code, verified.reason);
      const session: Session = {
        id: randomBytes(32).toString('base64url'),
        csrf: randomBytes(24).toString('base64url'),
        ownerKey: verified.value.ownerKey,
        email: verified.value.email,
        expiresAt: now() + sessionSeconds,
      };
      await store.createSession(session);
      return send(res, 200, await sessionBody(session), {
        'set-cookie': `${COOKIE}=${session.id}; Path=/api; Max-Age=${sessionSeconds}; HttpOnly; Secure; SameSite=Lax`,
      });
    }

    if (path === '/session' && method === 'GET') {
      // Same-origin pages restore their CSRF token after a reload; other sites cannot read it.
      return send(res, 200, await sessionBody(await requireSession(req, false)));
    }

    if (path === '/config' && method === 'GET') {
      return send(res, 200, {
        signIn: options.devSigner ? 'dev' : 'google',
        projectId: options.projectId,
        ...(options.firebaseWeb && !options.devSigner ? { firebase: options.firebaseWeb } : {}),
      });
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
        const item = { ...(body.item as ItemDescription), globalId };
        const valid = validateCloudItem(item);
        if (!valid.ok) throw new ApiError(valid.code, valid.reason);
        const existing = await store.getItem(session.ownerKey, globalId);
        if (existing?.deleted) throw new ApiError('ITEM_DELETED', 'This item was deleted.');
        if (existing) throw new ApiError('INVALID_INPUT', 'This item already exists.');
        if ((await store.committedBytes(session.ownerKey)) + item.byteLength > options.quotaBytes)
          throw new ApiError('QUOTA_EXCEEDED', 'This would exceed your cloud storage quota.');
        const { globalId: _id, ...description } = item;
        const uploadId = randomUUID();
        await store.createUpload({
          uploadId,
          ownerKey: session.ownerKey,
          epoch,
          globalId,
          item: description,
          chunks: new Map(),
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
      const n = Number(match[2]);
      if (n * chunkBytes >= upload.item.byteLength)
        throw new ApiError('INVALID_INPUT', 'Chunk is beyond the declared length.');
      // Each chunk must fill exactly its place, so stored bytes never exceed the declared size.
      const expected = Math.min(chunkBytes, upload.item.byteLength - n * chunkBytes);
      const part = await readBody(req, chunkBytes);
      if (part.length !== expected)
        throw new ApiError('INVALID_INPUT', `Chunk ${n} must be ${expected} bytes.`);
      upload.chunks.set(n, part);
      return send(res, 204);
    }

    if ((match = /^\/uploads\/([^/]+)\/complete$/.exec(path)) && method === 'POST') {
      const session = await requireSession(req, true);
      const body = await readJson(req);
      const opId = opIdOf(body);
      // Checked first: uploads begun before the library was removed must not complete.
      await requireEpoch(session.ownerKey, body);
      const upload = await store.getUpload(match[1]);
      if (!upload || upload.ownerKey !== session.ownerKey)
        throw new ApiError('NOT_FOUND', 'Upload not found.');
      // A completed upload answers with its item, whatever the retry's operation ID.
      if (upload.result) return send(res, 200, { item: upload.result });
      const result = await idempotent(session.ownerKey, opId, async () => {
        const count = Math.ceil(upload.item.byteLength / chunkBytes);
        const parts: Uint8Array[] = [];
        for (let n = 0; n < count; n++) {
          const part = upload.chunks.get(n);
          if (!part) throw new ApiError('INVALID_INPUT', `Chunk ${n} is missing.`);
          parts.push(part);
        }
        const bytes = new Uint8Array(Buffer.concat(parts));
        if (bytes.length !== upload.item.byteLength)
          throw new ApiError('HASH_MISMATCH', 'Uploaded length does not match the declaration.');
        if (createHash('sha256').update(bytes).digest('hex') !== upload.item.contentSha256)
          throw new ApiError('HASH_MISMATCH', 'Uploaded bytes do not match the declared SHA-256.');
        const existing = await store.getItem(session.ownerKey, upload.globalId);
        if (existing?.deleted) throw new ApiError('ITEM_DELETED', 'This item was deleted.');
        if (existing) throw new ApiError('INVALID_INPUT', 'This item already exists.');
        const objectKey = `${session.ownerKey}/${upload.epoch}/${upload.globalId}/original`;
        await objects.put(objectKey, bytes);
        const item = {
          ...upload.item,
          globalId: upload.globalId,
          revision: 1,
          deleted: false,
          objectKey,
        };
        await store.publish(session.ownerKey, item);
        upload.result = publicItem(item) as CloudItem;
        upload.chunks.clear();
        return { status: 200, body: { item: upload.result } };
      });
      return send(res, result.status, result.body);
    }

    if ((match = /^\/items\/([^/]+)$/.exec(path)) && (method === 'PATCH' || method === 'DELETE')) {
      const session = await requireSession(req, true);
      const body = await readJson(req);
      const opId = opIdOf(body);
      await requireEpoch(session.ownerKey, body);
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
                index: undefined,
              }
            : { ...current, revision: decision.nextRevision, title: write.title };
        if (write.type === 'delete') {
          if (current.objectKey) await objects.delete(current.objectKey);
          if (current.indexObjectKey) await objects.delete(current.indexObjectKey);
        }
        await store.publish(session.ownerKey, next);
        return { status: 200, body: { item: publicItem(next) } };
      });
      return send(res, result.status, result.body);
    }

    if ((match = /^\/items\/([^/]+)\/original$/.exec(path)) && method === 'GET') {
      const session = await requireSession(req, false);
      const item = await store.getItem(session.ownerKey, match[1]);
      const bytes =
        item && !item.deleted && item.objectKey ? await objects.get(item.objectKey) : undefined;
      if (!item || !bytes) throw new ApiError('NOT_FOUND', 'Item not found.');
      const headers = {
        'content-type': item.mimeType,
        etag: `"sha256-${item.contentSha256}"`,
        'accept-ranges': 'bytes',
      };
      const range = req.headers.range;
      if (range === undefined) return send(res, 200, bytes, headers);
      const parsed = parseRange(range, bytes.length);
      if (!parsed)
        return send(res, 416, errorBody('INVALID_INPUT', 'Requested range is not available.'), {
          'content-range': `bytes */${bytes.length}`,
        });
      return send(res, 206, bytes.subarray(parsed.start, parsed.end + 1), {
        ...headers,
        'content-range': `bytes ${parsed.start}-${parsed.end}/${bytes.length}`,
      });
    }

    if (path === '/vault' && method === 'DELETE') {
      const session = await requireSession(req, true);
      const body = await readJson(req);
      if (body.confirm !== 'remove-cloud-library')
        throw new ApiError('INVALID_INPUT', 'Confirm removing the cloud library.');
      await requireEpoch(session.ownerKey, body);
      const { epoch, removed } = await store.resetVault(session.ownerKey);
      for (const item of removed) {
        if (item.objectKey) await objects.delete(item.objectKey);
        if (item.indexObjectKey) await objects.delete(item.indexObjectKey);
      }
      return send(res, 200, { vault: { epoch } });
    }

    if ((match = /^\/items\/([^/]+)\/index$/.exec(path)) && method === 'PUT') {
      const session = await requireSession(req, true);
      const body = await readJson(req, MAX_INDEX_BYTES);
      const opId = opIdOf(body);
      const epoch = await requireEpoch(session.ownerKey, body);
      const result = await idempotent(session.ownerKey, opId, async () => {
        const current = await store.getItem(session.ownerKey, match![1]);
        if (!current) throw new ApiError('NOT_FOUND', 'Item not found.');
        if (current.deleted) throw new ApiError('ITEM_DELETED', 'This item was deleted.');
        const valid = validateIndexBundle(
          body.bundle as IndexBundle,
          {
            globalId: current.globalId,
            contentSha256: current.contentSha256,
            searchMetadataDigest: await searchMetadataDigest(current),
          },
          options.supportedIndexVersions ?? PILOT_INDEX_VERSIONS,
        );
        if (!valid.ok) throw new ApiError(valid.code, valid.reason);
        const indexObjectKey = `${session.ownerKey}/${epoch}/${current.globalId}/index`;
        await objects.put(indexObjectKey, new TextEncoder().encode(JSON.stringify(body.bundle)));
        // An index does not change the item's revision, so it never causes rename conflicts.
        const next = { ...current, index: valid.value, indexObjectKey };
        await store.publish(session.ownerKey, next);
        return { status: 200, body: { item: publicItem(next) } };
      });
      return send(res, result.status, result.body);
    }

    if ((match = /^\/items\/([^/]+)\/index$/.exec(path)) && method === 'GET') {
      const session = await requireSession(req, false);
      const item = await store.getItem(session.ownerKey, match[1]);
      if (item?.deleted) throw new ApiError('ITEM_DELETED', 'This item was deleted.');
      const bytes = item?.indexObjectKey ? await objects.get(item.indexObjectKey) : undefined;
      if (!item || !bytes) throw new ApiError('NOT_FOUND', 'No index for this item.');
      return send(res, 200, bytes, { 'content-type': 'application/json' });
    }

    throw new ApiError('NOT_FOUND', 'No such endpoint.');
  }

  return (req, res) => {
    route(req, res).catch((cause: unknown) => {
      if (res.headersSent) return res.destroy();
      if (cause instanceof ApiError)
        return send(res, STATUS[cause.code], {
          ...errorBody(cause.code, cause.message),
          ...cause.extra,
        });
      console.error('Pilot API error', cause);
      send(res, 500, errorBody('INTERNAL_ERROR', 'Something went wrong. Try again.'));
    });
  };
}
