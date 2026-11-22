import { createDecipheriv, createHmac, hkdfSync } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { IndexBundle } from '../contract';
import {
  E2EE_FORMAT,
  E2eeError,
  ORIGINAL_CHUNK_BYTES,
  TAG_BYTES,
  cipherChunkRange,
  decodeRecoveryCode,
  deriveVaultKeys,
  encodeRecoveryCode,
  keyCheck,
  newItemKey,
  newRecoverySecret,
  newVaultSalt,
  openIndexBundle,
  openMeta,
  openOriginal,
  openOriginalChunk,
  plainOriginalLength,
  sealIndexBundle,
  sealMeta,
  sealOriginal,
  sealedOriginalLength,
  unwrapItemKey,
  validateSealedItemFields,
  verifyKeyCheck,
  wrapItemKey,
  type SealedMeta,
} from '../contract/e2ee';

// Design: docs/pilot/e2ee-design.md (phase 0, the ar-e2ee-1 envelope).

const GLOBAL_A = '3f1c2b4a-5d6e-4f70-8a9b-0c1d2e3f4a5b';
const GLOBAL_B = '9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d';
const at = { globalId: GLOBAL_A, epoch: 1 };
const fromB64url = (text: string) => Buffer.from(text, 'base64url');
const bytesOf = (length: number, seed = 7) =>
  Uint8Array.from({ length }, (_, i) => (i * 31 + seed) & 0xff);
const rawKey = async (key: CryptoKey) =>
  Buffer.from(await globalThis.crypto.subtle.exportKey('raw', key));
async function code(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof E2eeError) return error.code;
    throw error;
  }
  return 'no error';
}

const meta: SealedMeta = {
  kind: 'pdf',
  title: 'DS201 course policy',
  mimeType: 'application/pdf',
  byteLength: 1285,
  contentSha256: 'a'.repeat(64),
  createdAt: 1_763_000_000_000,
  sourceUrl: 'https://example.test/policy',
};
const unit = (i: number) => {
  const v = new Array(768).fill(0);
  v[i % 768] = 1;
  return v;
};
const bundle: IndexBundle = {
  globalId: GLOBAL_A,
  contentSha256: 'a'.repeat(64),
  searchMetadataDigest: 'b'.repeat(64),
  indexVersion: 'v-test',
  dimension: 768,
  segments: [
    {
      modality: 'text',
      location: { kind: 'page', page: 2 },
      text: 'Written objections',
      vector: unit(1),
    },
    { modality: 'visual', location: { kind: 'whole' }, vector: unit(2) },
  ],
};

describe('E4 recovery codes and the vault key check', () => {
  it('round-trips a 128-bit secret as 27 characters in groups of four', async () => {
    const secret = newRecoverySecret();
    expect(secret).toHaveLength(16);
    const text = await encodeRecoveryCode(secret);
    expect(text).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){6}[0-9A-HJKMNP-TV-Z]{3}$/);
    expect(await decodeRecoveryCode(text)).toEqual(secret);
  });

  it('accepts lowercase, spaces and the look-alike letters I, L and O', async () => {
    const secret = Uint8Array.from({ length: 16 }, (_, i) => i * 17);
    const text = await encodeRecoveryCode(secret);
    const typed = text.toLowerCase().replaceAll('-', ' ').replaceAll('0', 'o').replaceAll('1', 'l');
    expect(await decodeRecoveryCode(typed)).toEqual(secret);
  });

  it('never turns a one-character typo back into the original secret, and rejects most', async () => {
    const secret = Uint8Array.from({ length: 16 }, (_, i) => (i * 29 + 3) & 0xff);
    const compact = (await encodeRecoveryCode(secret)).replaceAll('-', '');
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    let tried = 0;
    let rejected = 0;
    for (let i = 0; i < compact.length; i++)
      for (const c of alphabet) {
        if (c === compact[i]) continue;
        tried++;
        const typo = compact.slice(0, i) + c + compact.slice(i + 1);
        try {
          expect(await decodeRecoveryCode(typo)).not.toEqual(secret);
        } catch (error) {
          expect(error).toBeInstanceOf(E2eeError);
          rejected++;
        }
      }
    expect(rejected / tried).toBeGreaterThan(0.9);
  });

  it('rejects codes of the wrong length or with characters outside the alphabet', async () => {
    const text = await encodeRecoveryCode(newRecoverySecret());
    expect(await code(decodeRecoveryCode(text.slice(0, -1)))).toBe('INVALID_CODE');
    expect(await code(decodeRecoveryCode(text + 'A'))).toBe('INVALID_CODE');
    expect(await code(decodeRecoveryCode('U' + text.slice(1)))).toBe('INVALID_CODE');
  });

  it('derives the same key check from the same secret and salt, and a different one otherwise', async () => {
    const secret = newRecoverySecret();
    const salt = newVaultSalt();
    const keys = await deriveVaultKeys(secret, salt);
    const check = await keyCheck(keys, 1);
    expect(await keyCheck(await deriveVaultKeys(secret, salt), 1)).toBe(check);
    expect(await verifyKeyCheck(keys, 1, check)).toBe(true);
    expect(await verifyKeyCheck(keys, 2, check)).toBe(false);
    expect(await verifyKeyCheck(await deriveVaultKeys(newRecoverySecret(), salt), 1, check)).toBe(
      false,
    );
    expect(await verifyKeyCheck(await deriveVaultKeys(secret, newVaultSalt()), 1, check)).toBe(
      false,
    );
  });

  it('matches an independent HKDF and HMAC computation (format pin)', async () => {
    const secret = Uint8Array.from({ length: 16 }, (_, i) => i);
    const salt = Uint8Array.from({ length: 16 }, (_, i) => 255 - i);
    const checkKey = Buffer.from(hkdfSync('sha256', secret, salt, 'ar-e2ee-1|vault-check', 32));
    const expected = createHmac('sha256', checkKey)
      .update('ar-e2ee-1|key-check|3')
      .digest('base64url');
    expect(await keyCheck(await deriveVaultKeys(secret, salt), 3)).toBe(expected);
  });
});

describe('item keys are wrapped with the vault key', () => {
  it('unwraps with the same vault key and refuses another one', async () => {
    const keys = await deriveVaultKeys(newRecoverySecret(), newVaultSalt());
    const dk = await newItemKey();
    const wrapped = await wrapItemKey(keys, dk);
    expect(fromB64url(wrapped)).toHaveLength(40);
    const back = await unwrapItemKey(keys, wrapped);
    const sealed = await sealMeta(back, meta, { ...at, metaRevision: 1 });
    expect(await openMeta(dk, sealed, { ...at, metaRevision: 1 })).toEqual(meta);
    const other = await deriveVaultKeys(newRecoverySecret(), newVaultSalt());
    expect(await code(unwrapItemKey(other, wrapped))).toBe('WRONG_KEY');
  });

  it('wraps with AES-KW under an HKDF-derived key (format pin)', async () => {
    const secret = Uint8Array.from({ length: 16 }, (_, i) => i + 1);
    const salt = Uint8Array.from({ length: 16 }, (_, i) => i * 3);
    const keys = await deriveVaultKeys(secret, salt);
    const dk = await newItemKey();
    const wrapKey = Buffer.from(hkdfSync('sha256', secret, salt, 'ar-e2ee-1|vault-wrap', 32));
    const unwrap = createDecipheriv(
      'id-aes256-wrap',
      wrapKey,
      Buffer.from('A6A6A6A6A6A6A6A6', 'hex'),
    );
    const raw = Buffer.concat([
      unwrap.update(fromB64url(await wrapItemKey(keys, dk))),
      unwrap.final(),
    ]);
    expect(raw).toEqual(await rawKey(dk));
  });
});

describe('E2/E3 originals are sealed in authenticated chunks', () => {
  it('round-trips originals of every chunk shape', async () => {
    const dk = await newItemKey();
    for (const length of [1, 15, 16, 17, 48, 100]) {
      const plain = bytesOf(length);
      const cipher = await sealOriginal(dk, plain, at, { chunkBytes: 16 });
      expect(cipher.length).toBe(sealedOriginalLength(length, 16));
      expect(plainOriginalLength(cipher.length, 16)).toBe(length);
      expect(await openOriginal(dk, cipher, at, { chunkBytes: 16 })).toEqual(plain);
    }
  });

  // Compares 4 MiB with Buffer.equals (toEqual walks every byte) and allows for a busy machine.
  it('uses 4 MiB chunks by default, matching upload chunks and download ranges', async () => {
    expect(ORIGINAL_CHUNK_BYTES).toBe(4 * 1024 * 1024);
    expect(TAG_BYTES).toBe(16);
    const plain = bytesOf(ORIGINAL_CHUNK_BYTES + 5);
    const dk = await newItemKey();
    const cipher = await sealOriginal(dk, plain, at);
    expect(cipher.length).toBe(plain.length + 2 * TAG_BYTES);
    const opened = await openOriginal(dk, cipher, at);
    expect(Buffer.from(opened).equals(Buffer.from(plain))).toBe(true);
  }, 30_000);

  it('opens any single chunk from a ranged download', async () => {
    const dk = await newItemKey();
    const plain = bytesOf(50);
    const cipher = await sealOriginal(dk, plain, at, { chunkBytes: 16 });
    for (let i = 0; i < 4; i++) {
      const range = cipherChunkRange(i, cipher.length, 16)!;
      const part = cipher.slice(range.start, range.end + 1);
      expect(range.isLast).toBe(i === 3);
      expect(await openOriginalChunk(dk, part, at, i, range.isLast)).toEqual(
        plain.slice(i * 16, i * 16 + 16),
      );
    }
    expect(cipherChunkRange(4, cipher.length, 16)).toBeUndefined();
  });

  it('refuses a flipped byte, swapped or reordered chunks, a dropped last chunk and extra bytes', async () => {
    const dk = await newItemKey();
    const plain = bytesOf(48);
    const cipher = await sealOriginal(dk, plain, at, { chunkBytes: 16 });
    const open = (bytes: Uint8Array) => openOriginal(dk, bytes, at, { chunkBytes: 16 });

    const flipped = cipher.slice();
    flipped[20] ^= 1;
    expect(await code(open(flipped))).toBe('TAMPERED');

    const swapped = new Uint8Array(cipher.length);
    swapped.set(cipher.slice(32, 64), 0);
    swapped.set(cipher.slice(0, 32), 32);
    swapped.set(cipher.slice(64), 64);
    expect(await code(open(swapped))).toBe('TAMPERED');

    expect(await code(open(cipher.slice(0, 64)))).toBe('TAMPERED');
    expect(await code(open(Uint8Array.from([...cipher, 1, 2, 3])))).toBe('INVALID_FORMAT');
    expect(await code(open(cipher.slice(0, 10)))).toBe('INVALID_FORMAT');
  });

  it('cannot be opened as another item, another epoch or with another key', async () => {
    const dk = await newItemKey();
    const cipher = await sealOriginal(dk, bytesOf(20), at, { chunkBytes: 16 });
    const opts = { chunkBytes: 16 };
    expect(await code(openOriginal(dk, cipher, { globalId: GLOBAL_B, epoch: 1 }, opts))).toBe(
      'TAMPERED',
    );
    expect(await code(openOriginal(dk, cipher, { globalId: GLOBAL_A, epoch: 2 }, opts))).toBe(
      'TAMPERED',
    );
    expect(await code(openOriginal(await newItemKey(), cipher, at, opts))).toBe('TAMPERED');
  });

  it('uses a counter nonce and the documented AAD (format pin)', async () => {
    const dk = await newItemKey();
    const plain = bytesOf(40);
    const cipher = await sealOriginal(dk, plain, at, { chunkBytes: 16 });
    const key = await rawKey(dk);
    const out: Buffer[] = [];
    for (let i = 0; i < 3; i++) {
      const range = cipherChunkRange(i, cipher.length, 16)!;
      const chunk = Buffer.from(cipher.slice(range.start, range.end + 1));
      const nonce = Buffer.alloc(12);
      nonce.writeBigUInt64BE(BigInt(i), 4);
      const decipher = createDecipheriv('aes-256-gcm', key, nonce);
      decipher.setAAD(Buffer.from(`ar-e2ee-1|original|${GLOBAL_A}|1|${i}|${i === 2 ? 1 : 0}`));
      decipher.setAuthTag(chunk.subarray(chunk.length - 16));
      out.push(decipher.update(chunk.subarray(0, chunk.length - 16)), decipher.final());
    }
    expect(Buffer.concat(out)).toEqual(Buffer.from(plain));
  });
});

describe('E1/E3 metadata and index bundles are sealed and bound to their item', () => {
  it('round-trips sealed metadata and uses a fresh nonce each time', async () => {
    const dk = await newItemKey();
    const ctx = { ...at, metaRevision: 2 };
    const first = await sealMeta(dk, meta, ctx);
    const second = await sealMeta(dk, meta, ctx);
    expect(first).not.toBe(second);
    expect(await openMeta(dk, first, ctx)).toEqual(meta);
    expect(fromB64url(first).includes(Buffer.from('DS201'))).toBe(false);
  });

  it('refuses metadata from another revision, item or epoch', async () => {
    const dk = await newItemKey();
    const sealed = await sealMeta(dk, meta, { ...at, metaRevision: 2 });
    expect(await code(openMeta(dk, sealed, { ...at, metaRevision: 3 }))).toBe('TAMPERED');
    expect(
      await code(openMeta(dk, sealed, { globalId: GLOBAL_B, epoch: 1, metaRevision: 2 })),
    ).toBe('TAMPERED');
    expect(
      await code(openMeta(dk, sealed, { globalId: GLOBAL_A, epoch: 2, metaRevision: 2 })),
    ).toBe('TAMPERED');
  });

  it('refuses sealed metadata that decrypts to an invalid item description', async () => {
    const dk = await newItemKey();
    const bad = { ...meta, mimeType: 'text/html' } as SealedMeta;
    const sealed = await sealMeta(dk, bad, { ...at, metaRevision: 1 });
    expect(await code(openMeta(dk, sealed, { ...at, metaRevision: 1 }))).toBe('INVALID_FORMAT');
  });

  it('matches an independent AES-GCM decryption of the metadata (format pin)', async () => {
    const dk = await newItemKey();
    const sealed = fromB64url(await sealMeta(dk, meta, { ...at, metaRevision: 4 }));
    const decipher = createDecipheriv('aes-256-gcm', await rawKey(dk), sealed.subarray(0, 12));
    decipher.setAAD(Buffer.from(`ar-e2ee-1|meta|${GLOBAL_A}|1|4`));
    decipher.setAuthTag(sealed.subarray(sealed.length - 16));
    const plain = Buffer.concat([
      decipher.update(sealed.subarray(12, sealed.length - 16)),
      decipher.final(),
    ]);
    expect(JSON.parse(plain.toString('utf8'))).toEqual(meta);
  });

  it('round-trips an index bundle without leaving its text readable', async () => {
    const dk = await newItemKey();
    const ctx = { ...at, metaRevision: 1 };
    const sealed = await sealIndexBundle(dk, bundle, ctx);
    expect(Buffer.from(sealed).includes(Buffer.from('Written objections'))).toBe(false);
    expect(await openIndexBundle(dk, sealed, ctx)).toEqual(bundle);
    expect(await code(openIndexBundle(dk, sealed, { ...at, metaRevision: 2 }))).toBe('TAMPERED');
    expect(
      await code(openIndexBundle(dk, sealed, { globalId: GLOBAL_B, epoch: 1, metaRevision: 1 })),
    ).toBe('TAMPERED');
  });

  it('gzips the bundle JSON under the documented AAD (format pin)', async () => {
    const dk = await newItemKey();
    const sealed = Buffer.from(await sealIndexBundle(dk, bundle, { ...at, metaRevision: 5 }));
    const decipher = createDecipheriv('aes-256-gcm', await rawKey(dk), sealed.subarray(0, 12));
    decipher.setAAD(Buffer.from(`ar-e2ee-1|index|${GLOBAL_A}|1|5`));
    decipher.setAuthTag(sealed.subarray(sealed.length - 16));
    const zipped = Buffer.concat([
      decipher.update(sealed.subarray(12, sealed.length - 16)),
      decipher.final(),
    ]);
    expect(JSON.parse(gunzipSync(zipped).toString('utf8'))).toEqual(bundle);
  });
});

describe('the server accepts only well-formed sealed item fields', () => {
  const fields = () => ({
    enc: E2EE_FORMAT,
    wrappedKey: Buffer.alloc(40, 1).toString('base64url'),
    sealedMeta: Buffer.alloc(200, 2).toString('base64url'),
    metaRevision: 1,
    cipherByteLength: sealedOriginalLength(1285),
    cipherSha256: 'c'.repeat(64),
  });

  it('accepts a valid set and keeps only the known fields', () => {
    const result = validateSealedItemFields({
      ...fields(),
      title: 'leak',
      indexObjectKey: 'google:a/1/x/index',
    });
    expect(result).toEqual({ ok: true, value: fields() });
  });

  it.each([
    ['another format', { enc: 'ar-e2ee-0' }],
    ['a short wrapped key', { wrappedKey: Buffer.alloc(32).toString('base64url') }],
    ['a wrapped key that is not base64url', { wrappedKey: '+'.repeat(54) }],
    ['empty sealed metadata', { sealedMeta: '' }],
    [
      'oversized sealed metadata',
      { sealedMeta: Buffer.alloc(16 * 1024 + 1).toString('base64url') },
    ],
    ['a zero metadata revision', { metaRevision: 0 }],
    ['an uppercase hash', { cipherSha256: 'C'.repeat(64) }],
    ['a ciphertext length no plaintext can have', { cipherByteLength: 16 }],
    [
      'a ciphertext over the largest original',
      { cipherByteLength: sealedOriginalLength(100_000_001) },
    ],
  ])('rejects %s', (_, change) => {
    const result = validateSealedItemFields({ ...fields(), ...change });
    expect(result.ok).toBe(false);
  });

  it('reports an oversized original as LIMIT_EXCEEDED', () => {
    const result = validateSealedItemFields({
      ...fields(),
      cipherByteLength: sealedOriginalLength(100_000_001),
    });
    expect(result).toMatchObject({ ok: false, code: 'LIMIT_EXCEEDED' });
  });
});
