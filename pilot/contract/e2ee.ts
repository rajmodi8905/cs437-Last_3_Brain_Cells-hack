// End-to-end encryption envelope for Auto-sync, format ar-e2ee-1. The design, threat model and
// wire format are in docs/pilot/e2ee-design.md; change both together. Everything here runs on
// the device with Web Crypto (browsers and Node); the server only validates the public fields.
import { LIMITS } from '../../src/shared';
import {
  pickItemDescription,
  validateCloudItem,
  type CloudItem,
  type IndexBundle,
  type PilotErrorCode,
  type Result,
} from './index';

export const E2EE_FORMAT = 'ar-e2ee-1';
/** Plaintext bytes per original chunk: the same as upload chunks and download ranges. */
export const ORIGINAL_CHUNK_BYTES = 4 * 1024 * 1024;
export const TAG_BYTES = 16;
const NONCE_BYTES = 12;
const RECOVERY_SECRET_BYTES = 16;
const VAULT_SALT_BYTES = 16;
/** AES-KW output for a 256-bit key: the key plus an 8-byte integrity block. */
const WRAPPED_KEY_BYTES = 40;
export const MAX_SEALED_META_BYTES = 16 * 1024;
/** The largest original any item kind allows (video). */
export const MAX_ORIGINAL_BYTES = Math.max(
  LIMITS.maxImageBytes,
  LIMITS.maxPdfBytes,
  LIMITS.maxAudioBytes,
  LIMITS.maxVideoBytes,
);

/** The item description that is sealed instead of stored in plaintext. */
export type SealedMeta = Omit<CloudItem, 'globalId' | 'revision' | 'deleted' | 'index'>;

/** Where a sealed unit belongs; bound into its authenticated data so it cannot be moved. */
export interface SealContext {
  globalId: string;
  epoch: number;
}
export interface MetaContext extends SealContext {
  metaRevision: number;
}

/** Keys derived from the recovery secret; neither can be exported. */
export interface VaultKeys {
  /** AES-KW key that wraps each item's data key. */
  wrapKey: CryptoKey;
  /** HMAC key for the public key check. */
  checkKey: CryptoKey;
}

/** The public fields the server stores for a sealed item instead of the plaintext ones. */
export interface SealedItemFields {
  enc: typeof E2EE_FORMAT;
  wrappedKey: string;
  sealedMeta: string;
  metaRevision: number;
  cipherByteLength: number;
  cipherSha256: string;
}

export type E2eeErrorCode = 'WRONG_KEY' | 'TAMPERED' | 'INVALID_FORMAT' | 'INVALID_CODE';

export class E2eeError extends Error {
  constructor(
    readonly code: E2eeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'E2eeError';
  }
}

const subtle = () => globalThis.crypto.subtle;
const utf8 = (text: string) => new TextEncoder().encode(text);
const buffer = (bytes: Uint8Array) => bytes as Uint8Array<ArrayBuffer>;
const random = (length: number) => globalThis.crypto.getRandomValues(new Uint8Array(length));

// ---- base64url ----

const B64URL = /^[A-Za-z0-9_-]*$/;

export function toBase64url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
  if (typeof text !== 'string' || !B64URL.test(text) || text.length % 4 === 1)
    throw new E2eeError('INVALID_FORMAT', 'Not base64url.');
  const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/'));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** Decoded byte length of a base64url string, without decoding it. */
const base64urlBytes = (text: string) => Math.floor((text.length * 3) / 4);

// ---- recovery code ----

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const DATA_CHARS = Math.ceil((RECOVERY_SECRET_BYTES * 8) / 5);

export const newRecoverySecret = () => random(RECOVERY_SECRET_BYTES);
export const newVaultSalt = () => random(VAULT_SALT_BYTES);

/** First five bits of SHA-256(secret), so most typos are caught before any key is derived. */
async function checkValue(secret: Uint8Array) {
  const digest = new Uint8Array(await subtle().digest('SHA-256', buffer(secret)));
  return digest[0] >> 3;
}

/** Shows a 128-bit secret as 26 Crockford base32 characters and a check character. */
export async function encodeRecoveryCode(secret: Uint8Array): Promise<string> {
  if (secret.length !== RECOVERY_SECRET_BYTES)
    throw new E2eeError('INVALID_FORMAT', 'A recovery secret is 16 bytes.');
  let chars = '';
  let bits = 0;
  let value = 0;
  for (const byte of secret) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      chars += ALPHABET[(value >> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) chars += ALPHABET[(value << (5 - bits)) & 31];
  chars += ALPHABET[await checkValue(secret)];
  return chars.match(/.{1,4}/g)!.join('-');
}

/** Reads a typed recovery code; refuses wrong lengths, unknown characters and failed checks. */
export async function decodeRecoveryCode(text: string): Promise<Uint8Array<ArrayBuffer>> {
  const invalid = () => new E2eeError('INVALID_CODE', 'That is not a valid recovery code.');
  const compact = String(text)
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replaceAll('O', '0')
    .replace(/[IL]/g, '1');
  if (compact.length !== DATA_CHARS + 1) throw invalid();
  const values = [...compact].map((c) => ALPHABET.indexOf(c));
  if (values.some((v) => v < 0)) throw invalid();
  const secret = new Uint8Array(RECOVERY_SECRET_BYTES);
  let bits = 0;
  let value = 0;
  let at = 0;
  for (const v of values.slice(0, DATA_CHARS)) {
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      if (at < RECOVERY_SECRET_BYTES) secret[at++] = (value >> (bits - 8)) & 0xff;
      bits -= 8;
      value &= (1 << bits) - 1;
    }
  }
  // The bits past the secret are padding and must be zero.
  if (value !== 0) throw invalid();
  if (values[DATA_CHARS] !== (await checkValue(secret))) throw invalid();
  return secret;
}

// ---- vault keys ----

/** Derives the vault's wrapping and check keys from the recovery secret and the vault salt. */
export async function deriveVaultKeys(
  secret: Uint8Array,
  vaultSalt: Uint8Array,
): Promise<VaultKeys> {
  if (secret.length !== RECOVERY_SECRET_BYTES || vaultSalt.length !== VAULT_SALT_BYTES)
    throw new E2eeError('INVALID_FORMAT', 'Recovery secret and vault salt are 16 bytes each.');
  const ikm = await subtle().importKey('raw', buffer(secret), 'HKDF', false, ['deriveKey']);
  const hkdf = (info: string) => ({
    name: 'HKDF',
    hash: 'SHA-256',
    salt: buffer(vaultSalt),
    info: utf8(`${E2EE_FORMAT}|${info}`),
  });
  const [wrapKey, checkKey] = await Promise.all([
    subtle().deriveKey(hkdf('vault-wrap'), ikm, { name: 'AES-KW', length: 256 }, false, [
      'wrapKey',
      'unwrapKey',
    ]),
    subtle().deriveKey(
      hkdf('vault-check'),
      ikm,
      { name: 'HMAC', hash: 'SHA-256', length: 256 },
      false,
      ['sign', 'verify'],
    ),
  ]);
  return { wrapKey, checkKey };
}

const keyCheckData = (epoch: number) => utf8(`${E2EE_FORMAT}|key-check|${epoch}`);

/** Public value that tells a device whether its recovery secret belongs to this vault epoch. */
export async function keyCheck(keys: VaultKeys, epoch: number): Promise<string> {
  const mac = await subtle().sign('HMAC', keys.checkKey, keyCheckData(epoch));
  return toBase64url(new Uint8Array(mac));
}

/** Compares in constant time, through HMAC verification. */
export async function verifyKeyCheck(
  keys: VaultKeys,
  epoch: number,
  expected: string,
): Promise<boolean> {
  let mac: Uint8Array<ArrayBuffer>;
  try {
    mac = fromBase64url(expected);
  } catch {
    return false;
  }
  return subtle().verify('HMAC', keys.checkKey, mac, keyCheckData(epoch));
}

// ---- item keys ----

/** A fresh data key for one item version. Extractable only so that it can be wrapped. */
export const newItemKey = () =>
  subtle().generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);

export async function wrapItemKey(keys: VaultKeys, itemKey: CryptoKey): Promise<string> {
  return toBase64url(
    new Uint8Array(await subtle().wrapKey('raw', itemKey, keys.wrapKey, 'AES-KW')),
  );
}

/** Unwraps an item's data key; a key wrapped under another vault fails AES-KW's own check. */
export async function unwrapItemKey(keys: VaultKeys, wrapped: string): Promise<CryptoKey> {
  const bytes = fromBase64url(wrapped);
  if (bytes.length !== WRAPPED_KEY_BYTES)
    throw new E2eeError('INVALID_FORMAT', 'A wrapped item key is 40 bytes.');
  try {
    return await subtle().unwrapKey(
      'raw',
      bytes,
      keys.wrapKey,
      'AES-KW',
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  } catch {
    throw new E2eeError('WRONG_KEY', 'This item was sealed with another vault key.');
  }
}

// ---- originals ----

/** Ciphertext length of an original of `plainLength` bytes. */
export const sealedOriginalLength = (plainLength: number, chunkBytes = ORIGINAL_CHUNK_BYTES) =>
  plainLength + TAG_BYTES * Math.ceil(plainLength / chunkBytes);

/** Plaintext length behind a ciphertext length, or null when no original has that length. */
export function plainOriginalLength(
  cipherLength: number,
  chunkBytes = ORIGINAL_CHUNK_BYTES,
): number | null {
  if (!Number.isSafeInteger(cipherLength) || cipherLength <= TAG_BYTES) return null;
  const stride = chunkBytes + TAG_BYTES;
  const count = Math.ceil(cipherLength / stride);
  if (cipherLength - (count - 1) * stride <= TAG_BYTES) return null;
  return cipherLength - TAG_BYTES * count;
}

/** Byte range (inclusive) of ciphertext chunk `index`, for a ranged download. */
export function cipherChunkRange(
  index: number,
  cipherLength: number,
  chunkBytes = ORIGINAL_CHUNK_BYTES,
): { start: number; end: number; isLast: boolean } | undefined {
  const stride = chunkBytes + TAG_BYTES;
  const count = Math.ceil(cipherLength / stride);
  if (!Number.isSafeInteger(index) || index < 0 || index >= count) return undefined;
  const start = index * stride;
  return { start, end: Math.min(start + stride, cipherLength) - 1, isLast: index === count - 1 };
}

/** Nonce of chunk `index`: four zero bytes, then the index as a 64-bit big-endian number. */
function chunkNonce(index: number) {
  const nonce = new Uint8Array(NONCE_BYTES);
  new DataView(nonce.buffer).setBigUint64(4, BigInt(index));
  return nonce;
}

const originalAad = (ctx: SealContext, index: number, isLast: boolean) =>
  utf8(`${E2EE_FORMAT}|original|${ctx.globalId}|${ctx.epoch}|${index}|${isLast ? 1 : 0}`);

/**
 * Seals an original in chunks. Counter nonces are safe because every item version has its own
 * data key; the chunk index and the last-chunk flag in the AAD stop reordering and truncation.
 */
export async function sealOriginal(
  itemKey: CryptoKey,
  plain: Uint8Array,
  ctx: SealContext,
  options: { chunkBytes?: number } = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const size = options.chunkBytes ?? ORIGINAL_CHUNK_BYTES;
  if (plain.length < 1) throw new E2eeError('INVALID_FORMAT', 'An original has at least one byte.');
  const count = Math.ceil(plain.length / size);
  const out = new Uint8Array(sealedOriginalLength(plain.length, size));
  for (let i = 0; i < count; i++) {
    const part = buffer(plain.subarray(i * size, Math.min((i + 1) * size, plain.length)));
    const sealed = await subtle().encrypt(
      { name: 'AES-GCM', iv: chunkNonce(i), additionalData: originalAad(ctx, i, i === count - 1) },
      itemKey,
      part,
    );
    out.set(new Uint8Array(sealed), i * (size + TAG_BYTES));
  }
  return out;
}

/** Opens one ciphertext chunk, as returned by a ranged download. */
export async function openOriginalChunk(
  itemKey: CryptoKey,
  chunk: Uint8Array,
  ctx: SealContext,
  index: number,
  isLast: boolean,
): Promise<Uint8Array<ArrayBuffer>> {
  if (chunk.length <= TAG_BYTES) throw new E2eeError('INVALID_FORMAT', 'Chunk is too short.');
  try {
    const plain = await subtle().decrypt(
      { name: 'AES-GCM', iv: chunkNonce(index), additionalData: originalAad(ctx, index, isLast) },
      itemKey,
      buffer(chunk),
    );
    return new Uint8Array(plain);
  } catch {
    throw new E2eeError('TAMPERED', `Chunk ${index} failed authentication.`);
  }
}

/** Opens a whole sealed original; any changed, missing, extra or moved chunk is refused. */
export async function openOriginal(
  itemKey: CryptoKey,
  cipher: Uint8Array,
  ctx: SealContext,
  options: { chunkBytes?: number } = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const size = options.chunkBytes ?? ORIGINAL_CHUNK_BYTES;
  const plainLength = plainOriginalLength(cipher.length, size);
  if (plainLength === null)
    throw new E2eeError('INVALID_FORMAT', 'Ciphertext length is impossible.');
  const out = new Uint8Array(plainLength);
  for (let i = 0; ; i++) {
    const range = cipherChunkRange(i, cipher.length, size);
    if (!range) break;
    const part = cipher.subarray(range.start, range.end + 1);
    out.set(await openOriginalChunk(itemKey, part, ctx, i, range.isLast), i * size);
  }
  return out;
}

// ---- sealed metadata and index bundles ----

const blobAad = (what: 'meta' | 'index', ctx: MetaContext) =>
  utf8(`${E2EE_FORMAT}|${what}|${ctx.globalId}|${ctx.epoch}|${ctx.metaRevision}`);

/** AES-GCM with a random nonce, returned as nonce || ciphertext || tag. */
async function sealBlob(itemKey: CryptoKey, plain: Uint8Array, aad: Uint8Array) {
  const nonce = random(NONCE_BYTES);
  const sealed = await subtle().encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: buffer(aad) },
    itemKey,
    buffer(plain),
  );
  const out = new Uint8Array(NONCE_BYTES + sealed.byteLength);
  out.set(nonce);
  out.set(new Uint8Array(sealed), NONCE_BYTES);
  return out;
}

async function openBlob(itemKey: CryptoKey, sealed: Uint8Array, aad: Uint8Array) {
  if (sealed.length < NONCE_BYTES + TAG_BYTES)
    throw new E2eeError('INVALID_FORMAT', 'Sealed data is too short.');
  try {
    const plain = await subtle().decrypt(
      { name: 'AES-GCM', iv: buffer(sealed.subarray(0, NONCE_BYTES)), additionalData: buffer(aad) },
      itemKey,
      buffer(sealed.subarray(NONCE_BYTES)),
    );
    return new Uint8Array(plain);
  } catch {
    throw new E2eeError('TAMPERED', 'Sealed data failed authentication.');
  }
}

const pipe = async (bytes: Uint8Array, stream: CompressionStream | DecompressionStream) =>
  new Uint8Array(
    await new Response(new Blob([buffer(bytes)]).stream().pipeThrough(stream)).arrayBuffer(),
  );

const parseJson = (bytes: Uint8Array): unknown => {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new E2eeError('INVALID_FORMAT', 'Sealed data is not JSON.');
  }
};

/** Seals an item's description; a rename seals it again under the next metaRevision. */
export async function sealMeta(itemKey: CryptoKey, meta: SealedMeta, ctx: MetaContext) {
  const sealed = await sealBlob(itemKey, utf8(JSON.stringify(meta)), blobAad('meta', ctx));
  if (sealed.length > MAX_SEALED_META_BYTES)
    throw new E2eeError('INVALID_FORMAT', 'Sealed metadata is too large.');
  return toBase64url(sealed);
}

/** Opens sealed metadata and applies the same checks the server applies to plaintext items. */
export async function openMeta(
  itemKey: CryptoKey,
  sealed: string,
  ctx: MetaContext,
): Promise<SealedMeta> {
  const plain = await openBlob(itemKey, fromBase64url(sealed), blobAad('meta', ctx));
  const meta = pickItemDescription(parseJson(plain));
  if (!validateCloudItem({ globalId: ctx.globalId, ...meta }).ok)
    throw new E2eeError('INVALID_FORMAT', 'Sealed metadata is not a valid item description.');
  return meta;
}

/** Seals an index bundle as gzipped JSON. */
export async function sealIndexBundle(itemKey: CryptoKey, bundle: IndexBundle, ctx: MetaContext) {
  const zipped = await pipe(utf8(JSON.stringify(bundle)), new CompressionStream('gzip'));
  return sealBlob(itemKey, zipped, blobAad('index', ctx));
}

/**
 * Opens a sealed index bundle. The caller still checks it with `validateIndexBundle`, as the
 * server does for plaintext bundles today.
 */
export async function openIndexBundle(
  itemKey: CryptoKey,
  sealed: Uint8Array,
  ctx: MetaContext,
): Promise<IndexBundle> {
  const zipped = await openBlob(itemKey, sealed, blobAad('index', ctx));
  let plain: Uint8Array;
  try {
    plain = await pipe(zipped, new DecompressionStream('gzip'));
  } catch {
    throw new E2eeError('INVALID_FORMAT', 'Sealed index is not gzip.');
  }
  const bundle = parseJson(plain) as IndexBundle;
  if (!bundle || typeof bundle !== 'object' || bundle.globalId !== ctx.globalId)
    throw new E2eeError('INVALID_FORMAT', 'Sealed index belongs to another item.');
  return bundle;
}

// ---- what the server checks ----

const SHA256_HEX = /^[0-9a-f]{64}$/;
const fail = <T>(code: PilotErrorCode, reason: string): Result<T> => ({ ok: false, code, reason });

/**
 * Validates the public fields of a sealed item and keeps only those fields, so no client
 * field can reach storage unchecked (see #37).
 */
export function validateSealedItemFields(raw: unknown): Result<SealedItemFields> {
  const item = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const { enc, wrappedKey, sealedMeta, metaRevision, cipherByteLength, cipherSha256 } = item;
  if (enc !== E2EE_FORMAT) return fail('INVALID_INPUT', 'Unsupported encryption format.');
  if (
    typeof wrappedKey !== 'string' ||
    !B64URL.test(wrappedKey) ||
    base64urlBytes(wrappedKey) !== WRAPPED_KEY_BYTES
  )
    return fail('INVALID_INPUT', 'wrappedKey must be 40 bytes of base64url.');
  if (
    typeof sealedMeta !== 'string' ||
    !B64URL.test(sealedMeta) ||
    base64urlBytes(sealedMeta) < NONCE_BYTES + TAG_BYTES + 1 ||
    base64urlBytes(sealedMeta) > MAX_SEALED_META_BYTES
  )
    return fail(
      'INVALID_INPUT',
      `sealedMeta must be base64url, at most ${MAX_SEALED_META_BYTES} bytes.`,
    );
  if (typeof metaRevision !== 'number' || !Number.isSafeInteger(metaRevision) || metaRevision < 1)
    return fail('INVALID_INPUT', 'metaRevision must be a positive integer.');
  if (typeof cipherSha256 !== 'string' || !SHA256_HEX.test(cipherSha256))
    return fail('INVALID_INPUT', 'cipherSha256 must be 64 lowercase hex characters.');
  const plainLength =
    typeof cipherByteLength === 'number' ? plainOriginalLength(cipherByteLength) : null;
  if (plainLength === null)
    return fail('INVALID_INPUT', 'cipherByteLength is not the length of a sealed original.');
  if (plainLength > MAX_ORIGINAL_BYTES)
    return fail('LIMIT_EXCEEDED', 'This original is larger than the largest allowed item.');
  return {
    ok: true,
    value: {
      enc: E2EE_FORMAT,
      wrappedKey,
      sealedMeta,
      metaRevision,
      cipherByteLength: cipherByteLength as number,
      cipherSha256,
    },
  };
}
