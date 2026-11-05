/// <reference types="node" />
// Serves the built PWA and hands /api to the API on one origin, as the hosted pilot will.
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import type { RequestListener } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

export function createStaticHandler(root: string, api: RequestListener): RequestListener {
  const rootPath = realpath(resolve(root));
  const notFound = (res: Parameters<RequestListener>[1]) =>
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');

  return async (req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://pilot.local').pathname;
    if (pathname === '/api' || pathname.startsWith('/api/')) return api(req, res);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' }).end();
      return;
    }
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return notFound(res);
    }
    if (decoded.includes('\0')) return notFound(res);
    const base = await rootPath;
    const relative = decoded === '/' ? 'index.html' : decoded.slice(1);
    let file: string;
    try {
      file = await realpath(join(base, relative));
      if (!file.startsWith(base + sep) || !(await stat(file)).isFile()) return notFound(res);
    } catch {
      return notFound(res);
    }
    res.writeHead(200, {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      'cache-control': relative.startsWith('assets/')
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
      'x-content-type-options': 'nosniff',
    });
    if (req.method === 'HEAD') return res.end();
    createReadStream(file).pipe(res);
  };
}
