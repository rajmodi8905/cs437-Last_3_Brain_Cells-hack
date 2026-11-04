// Pilot Auto-sync contract. Mirrors docs/pilot/protocol.md; change both together.
import type { ItemKind, SourceLocation } from '../../src/shared';

export const INDEX_DIMENSION = 768;
export const MAX_SEGMENTS_PER_BUNDLE = 2000;
export const NORM_TOLERANCE = 1e-3;
export const MAX_TITLE_CODE_POINTS = 120;

export type PilotErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
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

const notImplemented = (name: string): never => {
  throw new Error(`Pilot contract not implemented yet: ${name}`);
};

/** Checks eligibility and derives the owner from already signature-verified claims. */
export function checkIdentityClaims(
  _claims: IdentityClaims,
  _policy: IdentityPolicy,
): Result<VerifiedIdentity> {
  return notImplemented('checkIdentityClaims');
}

/** Validates a client-supplied item description before an upload is accepted. */
export function validateCloudItem(
  _item: Omit<CloudItem, 'revision' | 'deleted' | 'index'>,
): Result<true> {
  return notImplemented('validateCloudItem');
}

/** Accepts an index bundle only if it matches the current original and a supported version. */
export function validateIndexBundle(
  _bundle: IndexBundle,
  _current: { globalId: string; contentSha256: string; searchMetadataDigest: string },
  _supportedIndexVersions: readonly string[],
): Result<IndexDescriptor> {
  return notImplemented('validateIndexBundle');
}

/** Decides a rename or delete against the item's current state. Deletion always wins. */
export function decideWrite(_current: ItemState | undefined, _write: ItemWrite): WriteDecision {
  return notImplemented('decideWrite');
}
