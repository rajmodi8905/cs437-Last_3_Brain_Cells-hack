// Typed browser client for the pilot API (docs/pilot/protocol.md).
import type { CloudItem, IndexBundle, PilotErrorCode } from '../contract';
import type { SealedIndexDescriptor, SealedItemFields, VaultE2eeSettings } from '../contract/e2ee';

/**
 * A cloud item as the change feed lists it. An end-to-end encrypted item arrives with only
 * `sealed` (and `sealedIndex`); the sync engine adds the fields it opens from them.
 */
export type ChangeItem = Partial<CloudItem> &
  Pick<CloudItem, 'globalId' | 'revision' | 'deleted'> & {
    sealed?: SealedItemFields;
    sealedIndex?: SealedIndexDescriptor;
  };
export type ItemDescription = Omit<CloudItem, 'globalId' | 'revision' | 'deleted' | 'index'>;

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: PilotErrorCode,
    message: string,
    readonly body: Record<string, unknown>,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ApiFailure';
  }
}

/**
 * The browser's session now belongs to another account than the one this client was bound to
 * (another tab signed in as someone else). Nothing was read or changed.
 */
export const isAccountChanged = (cause: unknown) =>
  cause instanceof ApiFailure && cause.code === 'ACCOUNT_CHANGED';

export interface SessionInfo {
  csrf: string;
  email: string;
  account: string;
  vault: { epoch: number };
  /** Set for a WhatsApp vault opened from a bot link. */
  kind?: 'whatsapp';
  /**
   * `telegram` for an account session opened from a Telegram bot's app link. The account is the
   * student's own (as after Google sign-in); this only lets that link count as choosing Auto-sync.
   */
  via?: 'telegram';
  /** Set once the library is end-to-end encrypted (docs/pilot/e2ee-design.md). */
  e2ee?: VaultE2eeSettings;
}

/** A pairing as the server holds it: each field appears once its step is done. */
export interface PairingState {
  claimed: boolean;
  oldPublicKey?: string;
  newPublicKey?: string;
  sealedSecret?: string;
}

export interface ApiClient {
  config(): Promise<{ signIn: 'google' | 'dev' }>;
  /** Development servers only: a token for a typed email. */
  devToken(email: string): Promise<string>;
  /** The current session from the cookie, or undefined when signed out. */
  restoreSession(): Promise<SessionInfo | undefined>;
  signIn(idToken: string): Promise<SessionInfo>;
  signOut(): Promise<void>;
  changes(
    epoch: number,
    after: number,
  ): Promise<{
    cursor: number;
    changes: { cursor: number; item: ChangeItem }[];
    /** Present when the library is end-to-end encrypted. */
    e2ee?: VaultE2eeSettings;
  }>;
  beginUpload(
    globalId: string,
    body:
      | { opId: string; epoch: number; item: ItemDescription }
      | { opId: string; epoch: number; sealed: SealedItemFields },
  ): Promise<{ uploadId: string; chunkBytes: number }>;
  putChunk(uploadId: string, index: number, bytes: Uint8Array): Promise<void>;
  completeUpload(
    uploadId: string,
    body: { opId: string; epoch: number },
  ): Promise<{ item: ChangeItem }>;
  rename(
    globalId: string,
    body:
      | { opId: string; epoch: number; expectedRevision: number; title: string }
      | {
          opId: string;
          epoch: number;
          expectedRevision: number;
          sealedMeta: string;
          metaRevision: number;
        },
  ): Promise<{ item: ChangeItem }>;
  remove(
    globalId: string,
    body: { opId: string; epoch: number; expectedRevision: number },
  ): Promise<{ item: ChangeItem }>;
  /** The original, or bytes `start` to `end` inclusive of it. */
  original(globalId: string, range?: { start: number; end: number }): Promise<Uint8Array>;
  publishIndex(
    globalId: string,
    body:
      | { opId: string; epoch: number; bundle: IndexBundle }
      | { opId: string; epoch: number; sealedIndex: string; metaRevision: number },
  ): Promise<{ item: ChangeItem }>;
  index(globalId: string): Promise<IndexBundle>;
  /** An encrypted item's sealed index bundle, as stored. */
  sealedIndex(globalId: string): Promise<Uint8Array>;
  /** New device: starts a pairing with the hash of its public key. */
  startPairing(body: {
    commitment: string;
  }): Promise<{ pairingId: string; code: string; expiresAt: number }>;
  /** Device with the key: claims the code typed from the new device's screen. */
  claimPairing(body: { code: string }): Promise<{ pairingId: string; commitment: string }>;
  pairingStep(
    pairingId: string,
    step: 'old-key' | 'new-key' | 'secret',
    body: { publicKey: string } | { sealedSecret: string },
  ): Promise<void>;
  pairing(pairingId: string): Promise<PairingState>;
  deletePairing(pairingId: string): Promise<void>;
  /** Turns end-to-end encryption on for the library, once per epoch. */
  setVaultE2ee(
    body: { opId: string; epoch: number } & VaultE2eeSettings,
  ): Promise<{ e2ee: VaultE2eeSettings }>;
  removeVault(body: { epoch: number; confirm: string }): Promise<{ vault: { epoch: number } }>;
  /**
   * The same client, whose requests are refused with `ACCOUNT_CHANGED` unless the browser's
   * session still belongs to `account`. Every tab shares one session cookie, so whatever keeps
   * one account's state (the sync engine, an export) must use this, never the unbound client.
   */
  forAccount(account: string): ApiClient;
}

export function createApiClient(options: { base: string; fetch?: typeof fetch }): ApiClient {
  const fetchImpl = options.fetch ?? fetch.bind(globalThis);
  let csrf = '';
  async function send(
    account: string | undefined,
    path: string,
    init: RequestInit = {},
    json?: unknown,
  ) {
    const headers = new Headers(init.headers);
    if (csrf) headers.set('x-recall-csrf', csrf);
    if (account) headers.set('x-recall-account', account);
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
        res.headers.has('retry-after') ? Number(res.headers.get('retry-after')) : undefined,
      );
    }
    return res;
  }
  const json = async <T>(res: Response) => (await res.json()) as T;
  const enc = encodeURIComponent;

  /** The client's calls; with `account`, each is refused once the session is someone else's. */
  const client = (account?: string): ApiClient => {
    const request = (path: string, init?: RequestInit, body?: unknown) =>
      send(account, path, init, body);
    return {
      forAccount: (other) => client(other),
      async config() {
        return json(await request('/config'));
      },
      async devToken(email) {
        return (
          await json<{ idToken: string }>(
            await request('/dev/token', { method: 'POST' }, { email }),
          )
        ).idToken;
      },
      async restoreSession() {
        try {
          // Never bound: this is how a tab learns whose session the browser has now.
          const body = await json<SessionInfo>(await send(undefined, '/session'));
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
      async sealedIndex(globalId) {
        const res = await request(`/items/${enc(globalId)}/index`);
        return new Uint8Array(await res.arrayBuffer());
      },
      async startPairing(body) {
        return json(await request('/pairing', { method: 'POST' }, body));
      },
      async claimPairing(body) {
        return json(await request('/pairing/claim', { method: 'POST' }, body));
      },
      async pairingStep(pairingId, step, body) {
        await request(`/pairing/${enc(pairingId)}/${step}`, { method: 'PUT' }, body);
      },
      async pairing(pairingId) {
        return json(await request(`/pairing/${enc(pairingId)}`));
      },
      async deletePairing(pairingId) {
        await request(`/pairing/${enc(pairingId)}`, { method: 'DELETE' });
      },
      async setVaultE2ee(body) {
        return json(await request('/vault/e2ee', { method: 'PUT' }, body));
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
  };
  return client();
}
