import { afterAll, beforeAll, expect, it } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

let child: ChildProcessWithoutNullStreams;
let base: string;
beforeAll(async () => {
  child = spawn(process.execPath, ['scripts/qa-webpages.mjs'], {
    env: { ...process.env, QA_WEB_PORT: '0' },
    stdio: 'pipe',
  });
  base = await new Promise<string>((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(Error('QA fixture server did not start.')), 5000);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (!base) reject(Error(`Fixture server exited ${code}`));
    });
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    });
  });
});
afterAll(async () => {
  if (child && child.exitCode === null) {
    await new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
      child.kill();
    });
  }
});

it('serves synthetic allowed/large HTML with CORS and no-cache headers', async () => {
  const allowed = await fetch(`${base}/allowed`);
  expect(allowed.headers.get('access-control-allow-origin')).toBe('*');
  expect(allowed.headers.get('cache-control')).toBe('no-store');
  expect(await allowed.text()).toContain(
    'Robotics induction is on Saturday at the north workshop.',
  );
  const large = await fetch(`${base}/large`);
  expect((await large.text()).length).toBeGreaterThan(20_000);
});

it('deliberately withholds CORS on blocked and distinguishes HTTP/type failures', async () => {
  const blocked = await fetch(`${base}/blocked`);
  expect(blocked.status).toBe(200);
  expect(blocked.headers.get('access-control-allow-origin')).toBeNull();
  expect((await fetch(`${base}/error`)).status).toBe(503);
  expect((await fetch(`${base}/unsupported`)).headers.get('content-type')).toBe(
    'application/octet-stream',
  );
});

it('has no upload endpoint or arbitrary file route and counts only explicit probe requests', async () => {
  expect((await fetch(`${base}/allowed`, { method: 'POST', body: 'synthetic input' })).status).toBe(
    405,
  );
  expect((await fetch(`${base}/package.json`)).status).toBe(404);
  expect((await fetch(`${base}/probe-count`).then((r) => r.json())).requests).toBe(0);
  await fetch(`${base}/probe`);
  expect((await fetch(`${base}/probe-count`).then((r) => r.json())).requests).toBe(1);
});
