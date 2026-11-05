// Pilot Auto-sync contract. Mirrors docs/pilot/protocol.md; change both together.
import { LIMITS, SUPPORTED_MIME_TYPES, type ItemKind, type SourceLocation } from '../../src/shared';

export const INDEX_DIMENSION = 768;
/** Index versions the pilot accepts; must include the app's current INDEX_VERSION. */
export const PILOT_INDEX_VERSIONS: readonly string[] = [
  'gemma2-daa72c5-q4-768-ch256o48-img70-lowered1-notitledup1-asr2-ocrconf1-v8',
];
export const MAX_SEGMENTS_PER_BUNDLE = 2000;
export const NORM_TOLERANCE = 1e-3;
export const MAX_TITLE_CODE_POINTS = 120;

export type PilotErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'NOT_ELIGIBLE'
  | 'VAULT_RESET'
  | 'REVISION_CONFLICT'
  | 'ITEM_DELETED'
  | 'QUOTA_EXCEEDED'
  | 'LIMIT_EXCEEDED'
  | 'HASH_MISMATCH'
  | 'INDEX_INCOMPATIBLE'
  | 'INVALID_INPUT'
  | 'RESYNC_REQUIRED'
  | 'INTERNAL_ERROR';

export type Result<T> =
  { ok: true; value: T } | { ok: false; code: PilotErrorCode; reason: string };

/** Decoded payload of a Firebase ID token whose signature has already been checked. */
export interface IdentityClaims {
  iss: string;
  aud: string;
  sub: string;
  iat: number;
  exp: number;
  email?: string;
  email_verified?: boolean;
  firebase?: { sign_in_provider?: string };
}

export interface IdentityPolicy {
  projectId: string;
  allowedEmailDomain: string;
  nowSeconds: number;
  /** Allowed clock skew in seconds for iat/exp. */
  skewSeconds: number;
}

export interface VerifiedIdentity {
  /** Ownership key: `${projectId}:${sub}`. Never the email. */
  ownerKey: string;
  projectId: string;
  subject: string;
  email: string;
}

export interface CloudItem {
  globalId: string;
  kind: ItemKind;
  title: string;
  mimeType: string;
  byteLength: number;
  contentSha256: string;
  createdAt: number;
  sourceUrl?: string;
  revision: number;
  deleted: boolean;
  index?: IndexDescriptor;
}

export interface IndexDescriptor {
  indexVersion: string;
  contentSha256: string;
  searchMetadataDigest: string;
  segmentCount: number;
}

export interface IndexSegment {
  modality: 'text' | 'visual';
  location: SourceLocation;
  text?: string;
  vector: number[];
}

export interface IndexBundle {
  globalId: string;
  contentSha256: string;
  searchMetadataDigest: string;
  indexVersion: string;
  dimension: number;
  segments: IndexSegment[];
}

export interface ItemState {
  revision: number;
  deleted: boolean;
}

export type ItemWrite =
  | { type: 'rename'; expectedRevision: number; title: string }
  | { type: 'delete'; expectedRevision: number };

export type WriteDecision =
  | { action: 'apply'; nextRevision: number }
  | { action: 'reject'; code: 'REVISION_CONFLICT' | 'ITEM_DELETED' | 'INVALID_INPUT' };

const fail = <T>(code: PilotErrorCode, reason: string): Result<T> => ({ ok: false, code, reason });
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const KINDS: readonly ItemKind[] = ['image', 'pdf', 'note', 'webpage', 'audio', 'video'];
// Text kinds are limited in code points; 4 bytes per code point bounds their UTF-8 size.
const BYTE_LIMITS: Record<ItemKind, number> = {
  image: LIMITS.maxImageBytes,
  pdf: LIMITS.maxPdfBytes,
  audio: LIMITS.maxAudioBytes,
  video: LIMITS.maxVideoBytes,
  note: LIMITS.maxTextCodePoints * 4,
  webpage: LIMITS.maxTextCodePoints * 4,
};
const isCount = (value: unknown, min: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min;
const validTitle = (title: unknown) =>
  typeof title === 'string' &&
  title.trim().length > 0 &&
  Array.from(title).length <= MAX_TITLE_CODE_POINTS;
const mimeMatchesKind = (mimeType: string, kind: ItemKind) =>
  kind === 'note' || kind === 'webpage'
    ? mimeType.startsWith('text/plain')
    : SUPPORTED_MIME_TYPES[mimeType] === kind;

/** Checks eligibility and derives the owner from already signature-verified claims. */
export function checkIdentityClaims(
  claims: IdentityClaims,
  policy: IdentityPolicy,
): Result<VerifiedIdentity> {
  if (claims.iss !== `https://securetoken.google.com/${policy.projectId}`)
    return fail('UNAUTHENTICATED', 'Token issuer does not match the pilot project.');
  if (claims.aud !== policy.projectId)
    return fail('UNAUTHENTICATED', 'Token audience does not match the pilot project.');
  if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 128)
    return fail('UNAUTHENTICATED', 'Token subject is missing or invalid.');
  if (!Number.isFinite(claims.exp) || claims.exp + policy.skewSeconds <= policy.nowSeconds)
    return fail('UNAUTHENTICATED', 'Token has expired.');
  if (!Number.isFinite(claims.iat) || claims.iat - policy.skewSeconds > policy.nowSeconds)
    return fail('UNAUTHENTICATED', 'Token was issued in the future.');
  if (claims.firebase?.sign_in_provider !== 'google.com')
    return fail('NOT_ELIGIBLE', 'Only Google sign-in is accepted.');
  if (claims.email_verified !== true) return fail('NOT_ELIGIBLE', 'Email is not verified.');
  const email = typeof claims.email === 'string' ? claims.email.toLowerCase() : '';
  const at = email.lastIndexOf('@');
  if (at < 1 || email.slice(at + 1) !== policy.allowedEmailDomain.toLowerCase())
    return fail(
      'NOT_ELIGIBLE',
      `Only verified @${policy.allowedEmailDomain} accounts can sign in.`,
    );
  return {
    ok: true,
    value: {
      ownerKey: `${policy.projectId}:${claims.sub}`,
      projectId: policy.projectId,
      subject: claims.sub,
      email,
    },
  };
}

/** Validates a client-supplied item description before an upload is accepted. */
export function validateCloudItem(
  item: Omit<CloudItem, 'revision' | 'deleted' | 'index'>,
): Result<true> {
  if (typeof item.globalId !== 'string' || !UUID_V4.test(item.globalId))
    return fail('INVALID_INPUT', 'globalId must be a lowercase UUID v4.');
  if (!KINDS.includes(item.kind)) return fail('INVALID_INPUT', 'Unsupported item kind.');
  if (!validTitle(item.title))
    return fail('INVALID_INPUT', `Title must be 1 to ${MAX_TITLE_CODE_POINTS} code points.`);
  if (typeof item.contentSha256 !== 'string' || !SHA256_HEX.test(item.contentSha256))
    return fail('INVALID_INPUT', 'contentSha256 must be 64 lowercase hex characters.');
  if (typeof item.mimeType !== 'string' || !mimeMatchesKind(item.mimeType, item.kind))
    return fail('INVALID_INPUT', 'MIME type does not match the item kind.');
  if (!isCount(item.byteLength, 1)) return fail('INVALID_INPUT', 'byteLength must be positive.');
  if (!isCount(item.createdAt, 1)) return fail('INVALID_INPUT', 'createdAt must be positive.');
  if (item.sourceUrl !== undefined) {
    const protocol = URL.canParse(item.sourceUrl) ? new URL(item.sourceUrl).protocol : '';
    if (protocol !== 'https:' && protocol !== 'http:')
      return fail('INVALID_INPUT', 'sourceUrl must be an http or https URL.');
  }
  if (item.byteLength > BYTE_LIMITS[item.kind])
    return fail('LIMIT_EXCEEDED', `This ${item.kind} is larger than its limit.`);
  return { ok: true, value: true };
}

const validLocation = (location: SourceLocation | undefined) => {
  if (location?.kind === 'whole') return true;
  if (location?.kind === 'page') return isCount(location.page, 1);
  if (location?.kind === 'time')
    return (
      isCount(location.startMs, 0) &&
      isCount(location.endMs, 1) &&
      location.startMs < location.endMs
    );
  return false;
};
const validVector = (vector: unknown) => {
  if (!Array.isArray(vector) || vector.length !== INDEX_DIMENSION) return false;
  let squares = 0;
  for (const value of vector) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return false;
    squares += value * value;
  }
  return Math.abs(Math.sqrt(squares) - 1) <= NORM_TOLERANCE;
};

/** Accepts an index bundle only if it matches the current original and a supported version. */
export function validateIndexBundle(
  bundle: IndexBundle,
  current: { globalId: string; contentSha256: string; searchMetadataDigest: string },
  supportedIndexVersions: readonly string[],
): Result<IndexDescriptor> {
  if (bundle.globalId !== current.globalId)
    return fail('INVALID_INPUT', 'Bundle belongs to another item.');
  if (bundle.dimension !== INDEX_DIMENSION)
    return fail('INVALID_INPUT', `Vectors must be ${INDEX_DIMENSION}-dimensional.`);
  if (bundle.contentSha256 !== current.contentSha256)
    return fail('INDEX_INCOMPATIBLE', 'Bundle was built from a different original.');
  if (bundle.searchMetadataDigest !== current.searchMetadataDigest)
    return fail('INDEX_INCOMPATIBLE', 'Bundle was built from older search metadata.');
  if (!supportedIndexVersions.includes(bundle.indexVersion))
    return fail('INDEX_INCOMPATIBLE', 'Unsupported index version.');
  if (!Array.isArray(bundle.segments) || !bundle.segments.length)
    return fail('INVALID_INPUT', 'Bundle has no segments.');
  if (bundle.segments.length > MAX_SEGMENTS_PER_BUNDLE)
    return fail('LIMIT_EXCEEDED', `At most ${MAX_SEGMENTS_PER_BUNDLE} segments per bundle.`);
  for (const [i, segment] of bundle.segments.entries()) {
    if (segment.modality !== 'text' && segment.modality !== 'visual')
      return fail('INVALID_INPUT', `Segment ${i} has an unknown modality.`);
    if (!validLocation(segment.location))
      return fail('INVALID_INPUT', `Segment ${i} has an invalid location.`);
    if (
      segment.text !== undefined &&
      (typeof segment.text !== 'string' ||
        Array.from(segment.text).length > LIMITS.maxTextCodePoints)
    )
      return fail('INVALID_INPUT', `Segment ${i} has invalid text.`);
    if (!validVector(segment.vector))
      return fail('INVALID_INPUT', `Segment ${i} vector is not a finite unit vector.`);
  }
  return {
    ok: true,
    value: {
      indexVersion: bundle.indexVersion,
      contentSha256: bundle.contentSha256,
      searchMetadataDigest: bundle.searchMetadataDigest,
      segmentCount: bundle.segments.length,
    },
  };
}

/** Decides a rename or delete against the item's current state. Deletion always wins. */
export function decideWrite(current: ItemState | undefined, write: ItemWrite): WriteDecision {
  if (!current) return { action: 'reject', code: 'INVALID_INPUT' };
  if (current.deleted) return { action: 'reject', code: 'ITEM_DELETED' };
  if (!isCount(write.expectedRevision, 1)) return { action: 'reject', code: 'INVALID_INPUT' };
  if (write.type === 'delete') return { action: 'apply', nextRevision: current.revision + 1 };
  if (!validTitle(write.title)) return { action: 'reject', code: 'INVALID_INPUT' };
  if (write.expectedRevision !== current.revision)
    return { action: 'reject', code: 'REVISION_CONFLICT' };
  return { action: 'apply', nextRevision: current.revision + 1 };
}

/**
 * Digest of the item metadata that search embeds (the title). An index built under another
 * title is stale. Uses Web Crypto, available in browsers and Node.
 */
export async function searchMetadataDigest(item: { title: string }): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify({ title: item.title }));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
