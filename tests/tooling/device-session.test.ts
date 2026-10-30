import { beforeAll, afterAll, expect, it } from 'vitest';
import {
  execFileSync,
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { get } from 'node:https';
import { connect } from 'node:tls';
import { X509Certificate } from 'node:crypto';
import { unzipSync } from 'fflate';

let parent: string;
let directory: string;
let child: ChildProcessWithoutNullStreams;
let base: string;
let ca: Buffer;
beforeAll(async () => {
  parent = await mkdtemp(join(tmpdir(), 'recall-device-session-'));
  directory = join(parent, 'session');
  execFileSync(
    process.execPath,
    ['scripts/device-session.mjs', 'prepare', '--address', '127.0.0.1', '--directory', directory],
    { timeout: 90_000, stdio: 'pipe' },
  );
  ca = await readFile(join(directory, 'app/__qa/root-ca.crt'));
  child = spawn(
    process.execPath,
    ['scripts/device-session.mjs', 'serve', '--directory', directory, '--port', '0'],
    { stdio: 'pipe' },
  );
  base = await new Promise<string>((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(Error('Device HTTPS session did not start.')), 15_000);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', () => {
      clearTimeout(timer);
      if (!base) reject(Error('Device server exited before readiness.'));
    });
    child.stdout.on('data', (data) => {
      output += data.toString();
      const match = output.match(/QA_DEVICE_URL=(https:\/\/127\.0\.0\.1:\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
  });
}, 120_000);
afterAll(async () => {
  if (child && child.exitCode === null)
    await new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
      child.kill();
    });
  if (parent) await rm(parent, { recursive: true, force: true });
});
const request = (path: string, method = 'GET') =>
  new Promise<{ status: number; type: string; body: Buffer }>((resolve, reject) => {
    get(`${base}${path}`, { ca, method }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () =>
        resolve({
          status: response.statusCode!,
          type: String(response.headers['content-type']),
          body: Buffer.concat(chunks),
        }),
      );
    }).on('error', reject);
  });

it('binds source/build/fixture identities to an actual HTTPS production snapshot without claiming device passes', async () => {
  const response = await request('/__qa/session.json');
  expect(response.status).toBe(200);
  const metadata = JSON.parse(response.body.toString());
  expect(metadata.source.commit).toMatch(/^[a-f0-9]{40}$/);
  expect(metadata.source.inputHash).toMatch(/^[a-f0-9]{64}$/);
  expect(metadata.assetManifestSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(metadata.deviceResults).toBe('Not run; requires actual reference devices.');
  expect(metadata.certificate.rootFingerprint256).toBe(new X509Certificate(ca).fingerprint256);
});

it('negotiates HTTP/1.1 over verified TLS when a mobile client offers HTTP/2 first', async () => {
  const url = new URL(base);
  const protocol = await new Promise<string | false | null>((resolve, reject) => {
    const socket = connect(
      { host: url.hostname, port: Number(url.port), ca, ALPNProtocols: ['h2', 'http/1.1'] },
      () => {
        resolve(socket.alpnProtocol);
        socket.end();
      },
    );
    socket.on('error', reject);
  });
  expect(protocol).toBe('http/1.1');
});

it('provides real phone-downloadable synthetic fixtures and no private key/library artifacts', async () => {
  const response = await request('/__qa/fixtures.zip');
  expect(response.status).toBe(200);
  const files = unzipSync(response.body);
  expect(files['library-30.zip']).toBeDefined();
  expect(files['expected.json']).toBeDefined();
  expect(files['chaitanya-ledger.md']).toBeDefined();
  expect(
    Object.keys(files).some((file) => /\.pem$|private\/|context\.md$|\.models\//.test(file)),
  ).toBe(false);
  const leaked = await request('/private/ca-key.pem');
  expect(leaked.body.toString()).not.toContain('PRIVATE KEY');
});

it('serves app, manifest, service worker and media runtime with usable MIME types over verified TLS', async () => {
  expect((await request('/')).body.toString()).toContain('Campus Recall');
  expect((await request('/manifest.webmanifest')).status).toBe(200);
  expect((await request('/sw.js')).status).toBe(200);
  expect((await request('/runtime/ffmpeg/ffmpeg-core.wasm', 'HEAD')).type).toContain(
    'application/wasm',
  );
  expect((await request('/__qa/root-ca.crt')).body).toEqual(ca);
});

it('serves the certificate-supplied QA command over HTTP/1.1 too', async () => {
  const helper = spawn(process.execPath, ['scripts/qa-https.mjs'], {
    env: {
      ...process.env,
      QA_TLS_KEY: join(directory, 'private/server-key.pem'),
      QA_TLS_CERT: join(directory, 'private/server-cert.pem'),
      QA_PORT: '0',
      QA_OUT_DIR: join(directory, 'app'),
      QA_HOST: '127.0.0.1',
    },
    stdio: 'pipe',
  });
  try {
    const url = await new Promise<string>((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(Error('QA helper did not start')), 15_000);
      helper.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      helper.once('exit', (code) => {
        clearTimeout(timer);
        reject(Error(`QA helper exited ${code}`));
      });
      helper.stdout.on('data', (data) => {
        output += data.toString();
        const match = output.match(/QA_HTTPS_URL=(https:\/\/127\.0\.0\.1:\d+)/);
        if (match) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      });
    });
    const text = await new Promise<string>((resolve, reject) =>
      get(url, { ca }, (response) => {
        let body = '';
        response.on('data', (data) => {
          body += data.toString();
        });
        response.on('end', () => resolve(body));
      }).on('error', reject),
    );
    expect(text).toContain('Campus Recall');
    const endpoint = new URL(url);
    const protocol = await new Promise<string | false | null>((resolve, reject) => {
      const socket = connect(
        {
          host: endpoint.hostname,
          port: Number(endpoint.port),
          ca,
          ALPNProtocols: ['h2', 'http/1.1'],
        },
        () => {
          resolve(socket.alpnProtocol);
          socket.end();
        },
      );
      socket.on('error', reject);
    });
    expect(protocol).toBe('http/1.1');
  } finally {
    if (helper.exitCode === null)
      await new Promise<void>((resolve) => {
        helper.once('exit', () => resolve());
        helper.kill();
      });
  }
});

it('keeps the existing session and its notes when preparation is requested again', async () => {
  const result = spawnSync(
    process.execPath,
    ['scripts/device-session.mjs', 'prepare', '--address', '127.0.0.1', '--directory', directory],
    { encoding: 'utf8', timeout: 10_000 },
  );
  expect(result.status).not.toBe(0);
  expect(await readFile(join(directory, 'DEVICE_STEPS.md'), 'utf8')).toContain('Not run');
});

it('can prepare a new identified build with the existing trusted public root and leaf, without copying the CA key', async () => {
  const next = join(parent, 'next-session');
  execFileSync(
    process.execPath,
    [
      'scripts/device-session.mjs',
      'prepare',
      '--address',
      '127.0.0.1',
      '--directory',
      next,
      '--certificate-from',
      directory,
    ],
    { timeout: 90_000, stdio: 'pipe' },
  );
  expect(await readFile(join(next, 'app/__qa/root-ca.crt'))).toEqual(ca);
  expect(await readFile(join(next, 'private/server-key.pem'))).toEqual(
    await readFile(join(directory, 'private/server-key.pem')),
  );
  const { readdir } = await import('node:fs/promises');
  expect(await readdir(join(next, 'private'))).not.toContain('ca-key.pem');
  const record = JSON.parse(await readFile(join(next, 'record.json'), 'utf8'));
  expect(record.metadata.certificate.rootFingerprint256).toBe(
    new X509Certificate(ca).fingerprint256,
  );
}, 120_000);

it('rejects a changed build before serving a misidentified snapshot', async () => {
  const file = join(directory, 'app/index.html');
  const original = await readFile(file);
  try {
    await writeFile(file, Buffer.concat([original, Buffer.from('<!-- changed -->')]));
    const result = spawnSync(
      process.execPath,
      ['scripts/device-session.mjs', 'serve', '--directory', directory, '--port', '0'],
      { encoding: 'utf8', timeout: 10_000 },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Snapshot changed');
  } finally {
    await writeFile(file, original);
  }
});
