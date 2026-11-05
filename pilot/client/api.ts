// Typed browser client for the pilot API (docs/pilot/protocol.md).
import type { CloudItem, IndexBundle, PilotErrorCode } from '../contract';

export type ChangeItem = Partial<CloudItem> & Pick<CloudItem, 'globalId' | 'revision' | 'deleted'>;
export type ItemDescription = Omit<CloudItem, 'globalId' | 'revision' | 'deleted' | 'index'>;

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: PilotErrorCode,
    message: string,
    readonly body: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiFailure';
  }
}

export interface SessionInfo {
  csrf: string;
  email: string;
  account: string;
  vault: { epoch: number };
}

export interface ApiClient {
  config(): Promise<{
    signIn: 'google' | 'dev';
    projectId: string;
    firebase?: { apiKey: string; authDomain: string };
  }>;
  /** Development servers only: a token for a typed email. */
  devToken(email: string): Promise<string>;
  /** The current session from the cookie, or undefined when signed out. */
  restoreSession(): Promise<SessionInfo | undefined>;
  signIn(idToken: string): Promise<SessionInfo>;
  signOut(): Promise<void>;
  changes(
    epoch: number,
    after: number,
  ): Promise<{ cursor: number; changes: { cursor: number; item: ChangeItem }[] }>;
  beginUpload(
    globalId: string,
    body: { opId: string; epoch: number; item: ItemDescription },
  ): Promise<{ uploadId: string; chunkBytes: number }>;
  putChunk(uploadId: string, index: number, bytes: Uint8Array): Promise<void>;
  completeUpload(
    uploadId: string,
    body: { opId: string; epoch: number },
  ): Promise<{ item: CloudItem }>;
  rename(
    globalId: string,
    body: { opId: string; epoch: number; expectedRevision: number; title: string },
  ): Promise<{ item: CloudItem }>;
  remove(
    globalId: string,
    body: { opId: string; epoch: number; expectedRevision: number },
  ): Promise<{ item: ChangeItem }>;
  /** The original, or bytes `start` to `end` inclusive of it. */
  original(globalId: string, range?: { start: number; end: number }): Promise<Uint8Array>;
  publishIndex(
    globalId: string,
    body: { opId: string; epoch: number; bundle: IndexBundle },
  ): Promise<{ item: CloudItem }>;
  index(globalId: string): Promise<IndexBundle>;
  removeVault(body: { epoch: number; confirm: string }): Promise<{ vault: { epoch: number } }>;
}

export function createApiClient(options: { base: string; fetch?: typeof fetch }): ApiClient {
  const fetchImpl = options.fetch ?? fetch.bind(globalThis);
  let csrf = '';
  async function request(path: string, init: RequestInit = {}, json?: unknown) {
    const headers = new Headers(init.headers);
    if (csrf) headers.set('x-recall-csrf', csrf);
    if (json !== undefined) headers.set('content-type', 'application/json');
    const res = await fetchImpl(`${options.base}${path}`, {
      credentials: 'include',
      cache: 'no-store',
      ...init,
      headers,
      body: json !== undefined ? JSON.stringify(json) : init.body,
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {
        error?: { code?: PilotErrorCode; message?: string };
      };
      throw new ApiFailure(
        res.status,
        body.error?.code ?? 'INTERNAL_ERROR',
        body.error?.message ?? `HTTP ${res.status}`,
        body as Record<string, unknown>,
      );
    }
    return res;
  }
  const json = async <T>(res: Response) => (await res.json()) as T;
  const enc = encodeURIComponent;

  return {
    async config() {
      return json(await request('/config'));
    },
    async devToken(email) {
      return (
        await json<{ idToken: string }>(await request('/dev/token', { method: 'POST' }, { email }))
      ).idToken;
    },
    async restoreSession() {
      try {
        const body = await json<SessionInfo>(await request('/session'));
        csrf = body.csrf;
        return body;
      } catch (cause) {
        if (cause instanceof ApiFailure && cause.code === 'UNAUTHENTICATED') return undefined;
        throw cause;
      }
    },
    async signIn(idToken) {
      const body = await json<SessionInfo>(
        await request('/session', { method: 'POST' }, { idToken }),
      );
      csrf = body.csrf;
      return body;
    },
    async signOut() {
      await request('/session', { method: 'DELETE' });
      csrf = '';
    },
    async changes(epoch, after) {
      return json(await request(`/changes?epoch=${epoch}&after=${after}`));
    },
    async beginUpload(globalId, body) {
      return json(await request(`/items/${enc(globalId)}/upload`, { method: 'POST' }, body));
    },
    async putChunk(uploadId, index, bytes) {
      await request(`/uploads/${enc(uploadId)}/chunks/${index}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream' },
        body: bytes as BodyInit,
      });
    },
    async completeUpload(uploadId, body) {
      return json(await request(`/uploads/${enc(uploadId)}/complete`, { method: 'POST' }, body));
    },
    async rename(globalId, body) {
      return json(await request(`/items/${enc(globalId)}`, { method: 'PATCH' }, body));
    },
    async remove(globalId, body) {
      return json(await request(`/items/${enc(globalId)}`, { method: 'DELETE' }, body));
    },
    async publishIndex(globalId, body) {
      return json(await request(`/items/${enc(globalId)}/index`, { method: 'PUT' }, body));
    },
    async removeVault(body) {
      return json(await request('/vault', { method: 'DELETE' }, body));
    },
    async index(globalId) {
      return json(await request(`/items/${enc(globalId)}/index`));
    },
    async original(globalId, range) {
      const res = await request(
        `/items/${enc(globalId)}/original`,
        range ? { headers: { range: `bytes=${range.start}-${range.end}` } } : {},
      );
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (range && (res.status !== 206 || bytes.length !== range.end - range.start + 1))
        throw new Error('The server did not return the requested part of the original.');
      return bytes;
    },
  };
}
