// Typed browser client for the pilot API (docs/pilot/protocol.md).
import type { CloudItem, PilotErrorCode } from '../contract';

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

export interface ApiClient {
  signIn(idToken: string): Promise<{ csrf: string; email: string; vault: { epoch: number } }>;
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
  original(globalId: string): Promise<Uint8Array>;
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
    async signIn(idToken) {
      const body = await json<{ csrf: string; email: string; vault: { epoch: number } }>(
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
    async original(globalId) {
      const res = await request(`/items/${enc(globalId)}/original`);
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}
