// Read-only validation of a static release artifact. This never deploys or changes site data.
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const sha = (value) => createHash('sha256').update(value).digest('hex');
export async function verifyRelease(
  directory,
  basePath,
  expectedManifestPath = 'public/asset-manifest.json',
) {
  if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(basePath))
    throw Error('Supply a base path such as / or /campus-recall/.');
  directory = resolve(directory);
  const files = [];
  async function walk(prefix = '') {
    for (const entry of await readdir(join(directory, prefix), { withFileTypes: true })) {
      const file = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw Error(`Unexpected symlink: ${file}`);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) files.push(file);
      else throw Error(`Unexpected non-file: ${file}`);
    }
  }
  await walk();
  files.sort();
  const manifestBytes = await readFile(join(directory, 'asset-manifest.json'));
  const expectedBytes = await readFile(expectedManifestPath);
  if (!manifestBytes.equals(expectedBytes))
    throw Error('Asset manifest differs from this checkout. Rebuild before release.');
  const manifest = JSON.parse(manifestBytes);
  const required = new Set([
    'index.html',
    'sw.js',
    'manifest.webmanifest',
    'asset-manifest.json',
    'icon.svg',
    'icon-192.png',
    'icon-512.png',
  ]);
  const origin = 'https://release.invalid';
  const appUrl = new URL(basePath, origin);
  for (const asset of manifest.assets) {
    if (!asset.url.startsWith('./')) continue;
    const url = new URL(asset.url, appUrl);
    if (url.origin !== origin || !url.pathname.startsWith(basePath) || url.search || url.hash)
      throw Error('Asset path escapes the release base.');
    const file = decodeURIComponent(url.pathname.slice(basePath.length));
    if (
      file.split('/').some((part) => !part || part === '.' || part === '..') ||
      file.includes('\\')
    )
      throw Error('Invalid runtime path.');
    required.add(file);
    const data = await readFile(join(directory, file));
    if (data.length !== asset.bytes || sha(data) !== asset.sha256)
      throw Error(`Runtime integrity failed: ${file}`);
  }
  for (const file of files) {
    if (required.has(file)) continue;
    if (
      !/^assets\/[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{6,}\.(?:js|css|wasm|svg|png|jpe?g|webp|woff2)$/.test(
        file,
      )
    )
      throw Error(`Unexpected public file: ${file}. Publish only the production build.`);
  }
  for (const file of required)
    if (!files.includes(file)) throw Error(`Missing release file: ${file}`);
  const html = await readFile(join(directory, 'index.html'), 'utf8');
  const references = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map((match) => match[1]);
  if (!references.some((value) => /\/assets\/.*\.js$/.test(value)))
    throw Error('Release entry module is missing.');
  for (const value of references) {
    const url = new URL(value, appUrl);
    if (url.origin !== origin || !url.pathname.startsWith(basePath))
      throw Error(`HTML reference uses the wrong base: ${value}`);
    const file = decodeURIComponent(url.pathname.slice(basePath.length));
    if (!files.includes(file)) throw Error(`HTML references a missing file: ${file}`);
  }
  const pwa = JSON.parse(await readFile(join(directory, 'manifest.webmanifest'), 'utf8'));
  if (pwa.scope !== './' || pwa.start_url !== './#/library' || pwa.display !== 'standalone')
    throw Error('PWA scope/start URL/display differs from the supported install contract.');
  for (const icon of pwa.icons || [])
    if (!files.includes(icon.src)) throw Error(`Missing install icon: ${icon.src}`);
  const sw = await readFile(join(directory, 'sw.js'), 'utf8');
  // Workbox precache URLs are normally relative to sw.js, including under APP_BASE.
  const precache = [...sw.matchAll(/"url":("(?:\\.|[^"\\])*")/g)].map((match) =>
    JSON.parse(match[1]),
  );
  if (!precache.includes('index.html') && !precache.includes(basePath + 'index.html'))
    throw Error('Service worker is missing its offline entry page.');
  for (const value of precache) {
    const url = new URL(value, appUrl);
    if (
      url.origin !== origin ||
      !url.pathname.startsWith(basePath) ||
      !files.includes(decodeURIComponent(url.pathname.slice(basePath.length)))
    )
      throw Error(`Service worker uses the wrong base or a missing file: ${value}`);
  }
  const entries = [];
  for (const file of files) {
    const data = await readFile(join(directory, file));
    entries.push({ file, bytes: data.length, sha256: sha(data) });
  }
  const totalBytes = entries.reduce((sum, item) => sum + item.bytes, 0);
  if (totalBytes > 1_000_000_000) throw Error('Static artifact exceeds the 1 GB Pages site limit.');
  const largest = entries.reduce((a, b) => (a.bytes > b.bytes ? a : b));
  return {
    basePath,
    files: files.length,
    totalBytes,
    largestFile: largest.file,
    largestBytes: largest.bytes,
    assetManifestSha256: sha(manifestBytes),
    artifactSha256: sha(JSON.stringify(entries)),
    note: 'Local artifact validation only. No publication, hosted MIME/offline test or final release approval is established.',
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [directory = 'dist', base = process.env.APP_BASE || '/'] = process.argv.slice(2);
  console.log(JSON.stringify(await verifyRelease(directory, base), null, 2));
}
