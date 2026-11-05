/// <reference types="node" />
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStaticHandler } from '../server/static';

let server: Server;
let base = '';
let apiHits = 0;
beforeAll(async () => {
  const root = await mkdtemp(join(tmpdir(), 'pilot-static-'));
  await mkdir(join(root, 'assets'));
  await mkdir(join(root, 'runtime'));
  await writeFile(join(root, 'index.html'), '<!doctype html><title>Campus Recall</title>');
  await writeFile(join(root, 'sw.js'), 'self.addEventListener("fetch", () => {});');
  await writeFile(join(root, 'assets', 'app-123.js'), 'console.log(1)');
  await writeFile(join(root, 'runtime', 'ort.wasm'), new Uint8Array([0, 97, 115, 109]));
  await writeFile(join(tmpdir(), 'pilot-secret.txt'), 'outside the web root');
  const handler = createStaticHandler(root, (_req, res) => {
    apiHits++;
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"api":true}');
  });
  server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe('Pilot origin serves the built app and the API together', () => {
  it('serves the app shell at the root', async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/html/);
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(await res.text()).toContain('Campus Recall');
  });

  it('serves hashed assets as immutable and WASM with its MIME type', async () => {
    const js = await fetch(`${base}/assets/app-123.js`);
    expect(js.headers.get('content-type')).toMatch(/^text\/javascript/);
    expect(js.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    const wasm = await fetch(`${base}/runtime/ort.wasm`);
    expect(wasm.headers.get('content-type')).toBe('application/wasm');
    expect(new Uint8Array(await wasm.arrayBuffer())).toEqual(new Uint8Array([0, 97, 115, 109]));
  });

  it('never lets the service worker be cached long', async () => {
    expect((await fetch(`${base}/sw.js`)).headers.get('cache-control')).toBe('no-cache');
  });

  it('sends /api requests to the API handler', async () => {
    const before = apiHits;
    const res = await fetch(`${base}/api/v1/changes`);
    expect(await res.json()).toEqual({ api: true });
    expect(apiHits).toBe(before + 1);
  });

  it.each([
    '/../pilot-secret.txt',
    '/%2e%2e/pilot-secret.txt',
    '/assets/..%2f..%2fpilot-secret.txt',
  ])('refuses a path outside the web root: %s', async (path) => {
    const res = await fetch(`${base}${path}`);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('outside the web root');
  });

  it('answers unknown paths with 404 rather than the app shell', async () => {
    expect((await fetch(`${base}/missing.js`)).status).toBe(404);
  });
});
