import { afterAll, beforeAll, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { verifyRelease } from '../../scripts/check-release.mjs';
let root: string;
let manifestPath: string;
const runtime = Buffer.from('synthetic runtime bytes');
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'recall-release-'));
  manifestPath = join(root, 'expected.json');
  await writeFile(
    manifestPath,
    JSON.stringify({
      version: 'test',
      assets: [
        {
          url: './runtime/test.wasm',
          bytes: runtime.length,
          sha256: createHash('sha256').update(runtime).digest('hex'),
          group: 'test',
          name: 'Test runtime',
        },
      ],
    }),
  );
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});
async function candidate(name: string, base = '/') {
  const directory = join(root, name);
  await mkdir(join(directory, 'assets'), { recursive: true });
  await mkdir(join(directory, 'runtime'));
  await writeFile(join(directory, 'runtime/test.wasm'), runtime);
  await writeFile(join(directory, 'asset-manifest.json'), await readFile(manifestPath));
  await writeFile(
    join(directory, 'index.html'),
    `<title>Campus Recall</title><script src="${base}assets/main-abcdefgh.js"></script><link rel="manifest" href="${base}manifest.webmanifest">`,
  );
  await writeFile(join(directory, 'assets/main-abcdefgh.js'), '/* synthetic bundle */');
  await writeFile(
    join(directory, 'sw.js'),
    `/* precache */ ${JSON.stringify([{ url: 'index.html' }])}`,
  );
  await writeFile(
    join(directory, 'manifest.webmanifest'),
    JSON.stringify({
      name: 'Campus Recall',
      scope: './',
      start_url: './#/library',
      display: 'standalone',
      icons: [{ src: 'icon.svg' }, { src: 'icon-192.png' }, { src: 'icon-512.png' }],
    }),
  );
  for (const file of ['icon.svg', 'icon-192.png', 'icon-512.png'])
    await writeFile(join(directory, file), 'synthetic icon');
  return directory;
}
it('validates root and project-subdirectory packages with a deterministic content identity', async () => {
  for (const base of ['/', '/campus-recall/']) {
    const directory = await candidate(base === '/' ? 'root' : 'project', base);
    const a = await verifyRelease(directory, base, manifestPath);
    const b = await verifyRelease(directory, base, manifestPath);
    expect(a.artifactSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(a).toEqual(b);
    expect(a.files).toBe(9);
  }
});
it('rejects the wrong base before a project-path deployment', async () => {
  await expect(
    verifyRelease(await candidate('base'), '/campus-recall/', manifestPath),
  ).rejects.toThrow(/base/i);
});
it('rejects a missing or altered required runtime', async () => {
  const directory = await candidate('runtime');
  await writeFile(join(directory, 'runtime/test.wasm'), 'changed');
  await expect(verifyRelease(directory, '/', manifestPath)).rejects.toThrow(/integrity/i);
});
it('rejects QA downloads, private keys and model binaries from the public artifact', async () => {
  for (const file of ['__qa/session.json', 'private/server-key.pem', 'assets/model.onnx']) {
    const directory = await candidate(file.replaceAll('/', '-'));
    await mkdir(join(directory, file, '..'), { recursive: true });
    await writeFile(join(directory, file), 'never publish');
    await expect(verifyRelease(directory, '/', manifestPath)).rejects.toThrow(/unexpected/i);
  }
});
it('rejects symlinks and a manifest that escapes the intended install scope', async () => {
  const directory = await candidate('symlink');
  await symlink(manifestPath, join(directory, 'outside.json'));
  await expect(verifyRelease(directory, '/', manifestPath)).rejects.toThrow(/symlink/i);
  const other = await candidate('scope');
  const manifest = JSON.parse(await readFile(join(other, 'manifest.webmanifest'), 'utf8'));
  manifest.scope = '/';
  await writeFile(join(other, 'manifest.webmanifest'), JSON.stringify(manifest));
  await expect(verifyRelease(other, '/', manifestPath)).rejects.toThrow(/scope/i);
});
