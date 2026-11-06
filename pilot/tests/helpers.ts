/// <reference types="node" />
// Shared test fixtures: a real local pilot API, signed test tokens and per-device fetch.
import { createHash, createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createPilotHandler, type GoogleLoginOptions } from '../server/app';
import { MemoryObjectStore, MemoryPilotStore } from '../server/memory';
import type { ObjectStore, PilotStore } from '../server/store';
import { staticKeySource } from '../server/tokens';

export const clientId = '1234-pilot.apps.googleusercontent.com';
export const origin = 'https://recall.example.test';
const signing = generateKeyPairSync('rsa', { modulusLength: 2048 });
export const clock = { now: 1_762_300_000 };

export function idToken(over: Record<string, unknown> = {}, key: KeyObject = signing.privateKey) {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = part({ alg: 'RS256', kid: 'test-key', typ: 'JWT' });
  const payload = part({
    iss: 'https://accounts.google.com',
    aud: clientId,
    sub: 'subject-a',
    iat: clock.now - 10,
    exp: clock.now + 3000,
    email: 'student.a@iitgn.ac.in',
    email_verified: true,
    hd: 'iitgn.ac.in',
    ...over,
  });
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${signer.sign(key).toString('base64url')}`;
}

/** Signs a development token for `email` with the test key, as the dev token endpoint does. */
export const devSigner = (email: string) =>
  idToken({
    sub: `dev-${email.toLowerCase()}`,
    email,
    email_verified: true,
  });

export async function startPilotServer(
  quotaBytes = 5_000_000,
  extra: {
    devSigner?: (email: string) => string;
    chunkBytes?: number;
    google?: GoogleLoginOptions;
    /** Durable stores for restart tests; in-memory ones by default. */
    store?: PilotStore;
    objects?: ObjectStore;
  } = {},
) {
  const store: PilotStore = extra.store ?? new MemoryPilotStore();
  const server: Server = createServer(
    createPilotHandler({
      clientId,
      allowedEmailDomain: 'iitgn.ac.in',
      origin,
      keys: staticKeySource({ 'test-key': signing.publicKey }),
      store,
      objects: extra.objects ?? new MemoryObjectStore(),
      nowSeconds: () => clock.now,
      quotaBytes,
      chunkBytes: extra.chunkBytes ?? 32 * 1024,
      devSigner: extra.devSigner,
      google: extra.google,
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  const close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  return { base, store, close };
}

/**
 * A browser-like fetch for one device: keeps its own session cookie and sends the site origin.
 * `log` records each request; `down` simulates no network; `loseResponse` drops the reply to
 * the first matching request after the server has processed it.
 */
export function deviceFetch() {
  let cookie = '';
  const controls = {
    log: [] as string[],
    down: false,
    loseResponse: undefined as RegExp | undefined,
  };
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    const line = `${method} ${url.pathname.replace(/^\/api\/v1/, '')}`;
    controls.log.push(line);
    if (controls.down) throw new TypeError('fetch failed: network is down');
    const headers = new Headers(init.headers);
    headers.set('origin', origin);
    if (cookie) headers.set('cookie', cookie);
    const res = await fetch(url, { ...init, headers });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    if (controls.loseResponse?.test(line)) {
      controls.loseResponse = undefined;
      await res.arrayBuffer();
      throw new TypeError('fetch failed: response lost');
    }
    return res;
  };
  return { fetchImpl, controls };
}

export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
