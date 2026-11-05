/// <reference types="node" />
// Google ID token verification with Node's crypto: signature here, claims in the contract.
import { createPublicKey, verify, type JsonWebKey, type KeyObject } from 'node:crypto';
import {
  checkIdentityClaims,
  type IdentityClaims,
  type IdentityPolicy,
  type Result,
  type VerifiedIdentity,
} from '../contract';

export interface KeySource {
  getKey(kid: string): Promise<KeyObject | undefined>;
}

export const staticKeySource = (keys: Record<string, KeyObject>): KeySource => ({
  getKey: async (kid) => (Object.hasOwn(keys, kid) ? keys[kid] : undefined),
});

const GOOGLE_JWKS = 'https://www.googleapis.com/oauth2/v3/certs';

/** Google's published OpenID Connect signing keys, cached for their max-age. */
export function googleKeySource(fetchJson: typeof fetch = fetch): KeySource {
  let keys = new Map<string, KeyObject>();
  let expiresAt = 0;
  let lastFetch = 0;
  return {
    async getKey(kid) {
      const now = Date.now();
      // Refresh when expired, or once a minute at most when a new key ID appears.
      if (now >= expiresAt || (!keys.has(kid) && now - lastFetch > 60_000)) {
        lastFetch = now;
        const res = await fetchJson(GOOGLE_JWKS);
        if (!res.ok) throw new Error(`Google signing keys returned HTTP ${res.status}`);
        const body = (await res.json()) as { keys?: (JsonWebKey & { kid?: string })[] };
        keys = new Map(
          (body.keys ?? [])
            .filter((jwk) => typeof jwk.kid === 'string')
            .map((jwk) => [jwk.kid!, createPublicKey({ key: jwk, format: 'jwk' })]),
        );
        const maxAge = /max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '');
        expiresAt = now + Math.min(Number(maxAge?.[1] ?? 3600), 86_400) * 1000;
      }
      return keys.get(kid);
    },
  };
}

const unauthenticated = (reason: string): Result<VerifiedIdentity> => ({
  ok: false,
  code: 'UNAUTHENTICATED',
  reason,
});
const decode = (part: string): unknown => {
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
};

/** Verifies an RS256 Google ID token, then applies the contract's identity rules. */
export async function verifyIdToken(
  token: unknown,
  keys: KeySource,
  policy: IdentityPolicy,
): Promise<Result<VerifiedIdentity>> {
  if (typeof token !== 'string' || token.length > 8192) return unauthenticated('Missing token.');
  const parts = token.split('.');
  if (parts.length !== 3) return unauthenticated('Malformed token.');
  const header = decode(parts[0]) as { alg?: unknown; kid?: unknown } | undefined;
  if (header?.alg !== 'RS256' || typeof header.kid !== 'string')
    return unauthenticated('Unsupported token header.');
  const key = await keys.getKey(header.kid);
  if (!key) return unauthenticated('Unknown signing key.');
  const signed = verify(
    'RSA-SHA256',
    Buffer.from(`${parts[0]}.${parts[1]}`),
    key,
    Buffer.from(parts[2], 'base64url'),
  );
  if (!signed) return unauthenticated('Invalid token signature.');
  const claims = decode(parts[1]);
  if (!claims || typeof claims !== 'object') return unauthenticated('Malformed token payload.');
  return checkIdentityClaims(claims as IdentityClaims, policy);
}
