import { describe, expect, it } from 'vitest';
import {
  checkIdentityClaims,
  decideWrite,
  validateCloudItem,
  validateIndexBundle,
  type IdentityClaims,
  type IndexBundle,
} from '../contract';

const clientId = '1234-pilot.apps.googleusercontent.com';
const now = 1_762_300_000;
const policy = { clientId, allowedEmailDomain: 'iitgn.ac.in', nowSeconds: now, skewSeconds: 60 };
const claims = (over: Partial<IdentityClaims> = {}): IdentityClaims => ({
  iss: 'https://accounts.google.com',
  aud: clientId,
  sub: 'google-subject-1',
  iat: now - 30,
  exp: now + 3000,
  email: 'student@iitgn.ac.in',
  email_verified: true,
  hd: 'iitgn.ac.in',
  ...over,
});

describe('P03/P12 identity: only verified IITGN Google accounts own a vault', () => {
  it('derives the owner from the Google subject, never the email', () => {
    const result = checkIdentityClaims(claims(), policy);
    expect(result).toEqual({
      ok: true,
      value: {
        ownerKey: 'google:google-subject-1',
        subject: 'google-subject-1',
        email: 'student@iitgn.ac.in',
      },
    });
  });

  it("accepts both of Google's issuer spellings", () => {
    expect(checkIdentityClaims(claims({ iss: 'accounts.google.com' }), policy).ok).toBe(true);
  });

  it('requires the nonce of the sign-in attempt when there is one', () => {
    const attempt = { ...policy, nonce: 'nonce-1' };
    expect(checkIdentityClaims(claims({ nonce: 'nonce-1' }), attempt).ok).toBe(true);
    for (const nonce of ['nonce-2', undefined])
      expect(checkIdentityClaims(claims({ nonce }), attempt)).toMatchObject({
        ok: false,
        code: 'UNAUTHENTICATED',
      });
  });

  it('accepts the domain case-insensitively', () => {
    expect(checkIdentityClaims(claims({ email: 'Student@IITGN.AC.IN' }), policy).ok).toBe(true);
  });

  it.each([
    ['wrong audience', { aud: '9999-other.apps.googleusercontent.com' }],
    ['wrong issuer', { iss: 'https://securetoken.google.com/another-project' }],
    ['expired token', { exp: now - 120 }],
    ['token issued in the future', { iat: now + 600 }],
    ['empty subject', { sub: '' }],
  ])('rejects %s as UNAUTHENTICATED', (_name, over) => {
    expect(checkIdentityClaims(claims(over), policy)).toMatchObject({
      ok: false,
      code: 'UNAUTHENTICATED',
    });
  });

  it.each([
    ['an unverified email', { email_verified: false }],
    ['a non-IITGN domain', { email: 'student@gmail.com' }],
    ['a look-alike domain', { email: 'student@iitgn.ac.in.example.com' }],
    ['a subdomain', { email: 'student@mail.iitgn.ac.in' }],
    ['a missing email', { email: undefined }],
    ['a personal Google account with no IITGN Workspace domain', { hd: undefined }],
    ['another Workspace domain', { hd: 'example.edu' }],
  ])('rejects %s as NOT_ELIGIBLE', (_name, over) => {
    expect(checkIdentityClaims(claims(over), policy)).toMatchObject({
      ok: false,
      code: 'NOT_ELIGIBLE',
    });
  });
});

const sha = 'a'.repeat(64);
const item = {
  globalId: '3f2b8c1e-6d4a-4b7e-9c2f-1a2b3c4d5e6f',
  kind: 'pdf' as const,
  title: 'Hostel mess rules',
  mimeType: 'application/pdf',
  byteLength: 120_000,
  contentSha256: sha,
  createdAt: 1_762_000_000_000,
};

describe('P04/P11 cloud item descriptions', () => {
  it('accepts a valid PDF description', () => {
    expect(validateCloudItem(item)).toEqual({ ok: true, value: true });
  });

  it.each([
    ['a non-UUID global ID', { globalId: 'item-1' }],
    ['an empty title', { title: '' }],
    ['a 121 code point title', { title: 'x'.repeat(121) }],
    ['an uppercase hash', { contentSha256: 'A'.repeat(64) }],
    ['a short hash', { contentSha256: 'a'.repeat(63) }],
    ['a MIME type that does not match the kind', { mimeType: 'image/png' }],
    ['a script source URL', { sourceUrl: 'javascript:alert(1)' }],
    ['a zero byte length', { byteLength: 0 }],
  ])('rejects %s as INVALID_INPUT', (_name, over) => {
    expect(validateCloudItem({ ...item, ...over })).toMatchObject({
      ok: false,
      code: 'INVALID_INPUT',
    });
  });

  it.each([
    ['a PDF over 20 MB', { byteLength: 20_000_001 }],
    [
      'an image over 20 MB',
      { kind: 'image' as const, mimeType: 'image/png', byteLength: 20_000_001 },
    ],
    [
      'a video over 100 MB',
      { kind: 'video' as const, mimeType: 'video/mp4', byteLength: 100_000_001 },
    ],
  ])('rejects %s as LIMIT_EXCEEDED', (_name, over) => {
    expect(validateCloudItem({ ...item, ...over })).toMatchObject({
      ok: false,
      code: 'LIMIT_EXCEEDED',
    });
  });
});

const unit = (axis = 0) => Array.from({ length: 768 }, (_, i) => (i === axis ? 1 : 0));
const version = 'gemma2-daa72c5-q4-768-ch256o48-img70-lowered1-notitledup1-asr2-ocrconf1-v8';
const current = {
  globalId: item.globalId,
  contentSha256: sha,
  searchMetadataDigest: 'b'.repeat(64),
};
const bundle = (over: Partial<IndexBundle> = {}): IndexBundle => ({
  globalId: item.globalId,
  contentSha256: sha,
  searchMetadataDigest: 'b'.repeat(64),
  indexVersion: version,
  dimension: 768,
  segments: [
    {
      modality: 'text',
      location: { kind: 'page', page: 2 },
      text: 'Guests need a pass.',
      vector: unit(0),
    },
    { modality: 'visual', location: { kind: 'whole' }, vector: unit(5) },
  ],
  ...over,
});

describe('P05 index bundles must match the current original and version', () => {
  it('accepts a matching bundle and describes it', () => {
    expect(validateIndexBundle(bundle(), current, [version])).toEqual({
      ok: true,
      value: {
        indexVersion: version,
        contentSha256: sha,
        searchMetadataDigest: 'b'.repeat(64),
        segmentCount: 2,
      },
    });
  });

  it.each([
    ['a stale original hash', { contentSha256: 'c'.repeat(64) }],
    ['a stale search-metadata digest', { searchMetadataDigest: 'd'.repeat(64) }],
    ['an unsupported index version', { indexVersion: 'older-version-v7' }],
  ])('rejects %s as INDEX_INCOMPATIBLE', (_name, over) => {
    expect(validateIndexBundle(bundle(over), current, [version])).toMatchObject({
      ok: false,
      code: 'INDEX_INCOMPATIBLE',
    });
  });

  it.each([
    ['another item ID', bundle({ globalId: '0f2b8c1e-6d4a-4b7e-9c2f-1a2b3c4d5e6f' })],
    ['a 512-dimensional bundle', bundle({ dimension: 512 })],
    [
      'a short vector',
      bundle({ segments: [{ modality: 'text', location: { kind: 'whole' }, vector: [1, 0] }] }),
    ],
    [
      'a non-finite value',
      bundle({
        segments: [
          {
            modality: 'text',
            location: { kind: 'whole' },
            vector: [Number.NaN, ...unit().slice(1)],
          },
        ],
      }),
    ],
    [
      'an unnormalized vector',
      bundle({
        segments: [
          { modality: 'text', location: { kind: 'whole' }, vector: unit().map((v) => v * 2) },
        ],
      }),
    ],
    [
      'page zero',
      bundle({
        segments: [{ modality: 'text', location: { kind: 'page', page: 0 }, vector: unit() }],
      }),
    ],
    [
      'an empty time range',
      bundle({
        segments: [
          {
            modality: 'text',
            location: { kind: 'time', startMs: 5000, endMs: 5000 },
            vector: unit(),
          },
        ],
      }),
    ],
  ])('rejects %s as INVALID_INPUT', (_name, value) => {
    expect(validateIndexBundle(value, current, [version])).toMatchObject({
      ok: false,
      code: 'INVALID_INPUT',
    });
  });

  it('rejects more than 2,000 segments as LIMIT_EXCEEDED', () => {
    const segments = Array.from({ length: 2001 }, () => ({
      modality: 'text' as const,
      location: { kind: 'whole' as const },
      vector: unit(),
    }));
    expect(validateIndexBundle(bundle({ segments }), current, [version])).toMatchObject({
      ok: false,
      code: 'LIMIT_EXCEEDED',
    });
  });
});

describe('P09 revisions: expected revision for renames, deletion always wins', () => {
  it('applies a rename at the current revision', () => {
    expect(
      decideWrite(
        { revision: 3, deleted: false },
        { type: 'rename', expectedRevision: 3, title: 'New' },
      ),
    ).toEqual({ action: 'apply', nextRevision: 4 });
  });

  it('reports a conflict for a rename from an older revision', () => {
    expect(
      decideWrite(
        { revision: 4, deleted: false },
        { type: 'rename', expectedRevision: 3, title: 'B' },
      ),
    ).toEqual({ action: 'reject', code: 'REVISION_CONFLICT' });
  });

  it('applies a delete even from an older revision', () => {
    expect(
      decideWrite({ revision: 7, deleted: false }, { type: 'delete', expectedRevision: 2 }),
    ).toEqual({
      action: 'apply',
      nextRevision: 8,
    });
  });

  it.each([
    ['rename', { type: 'rename' as const, expectedRevision: 8, title: 'Back again' }],
    ['delete', { type: 'delete' as const, expectedRevision: 8 }],
  ])('never lets a %s touch a deleted item', (_name, write) => {
    expect(decideWrite({ revision: 8, deleted: true }, write)).toEqual({
      action: 'reject',
      code: 'ITEM_DELETED',
    });
  });

  it('rejects writes to an unknown item and invalid titles', () => {
    expect(decideWrite(undefined, { type: 'delete', expectedRevision: 1 })).toEqual({
      action: 'reject',
      code: 'INVALID_INPUT',
    });
    expect(
      decideWrite(
        { revision: 1, deleted: false },
        { type: 'rename', expectedRevision: 1, title: '' },
      ),
    ).toEqual({ action: 'reject', code: 'INVALID_INPUT' });
  });
});
