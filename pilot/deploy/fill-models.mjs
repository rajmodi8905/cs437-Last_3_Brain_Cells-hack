// Release step for the WhatsApp engine host: puts the pinned model files its build lists into the
// models folder, with the checks of `npm run models:download` (size and SHA-256 of every file,
// written under a temporary name and renamed only when it matches). Files already present and
// matching are kept. Run from the release image:
//   node /app/fill-models.mjs [/app/engine-host/asset-manifest.json] [/app/models]
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const [manifestPath = '/app/engine-host/asset-manifest.json', target = '/app/models'] =
  process.argv.slice(2);
const { assets } = JSON.parse(await readFile(manifestPath, 'utf8'));
await mkdir(target, { recursive: true });
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
let kept = 0;
let fetched = 0;
for (const asset of assets.filter((entry) => entry.url.startsWith('https:'))) {
  if (!/^[0-9a-f]{64}$/.test(asset.sha256)) throw Error(`Invalid pin: ${asset.name}`);
  const path = join(target, asset.sha256);
  const existing = await readFile(path).catch(() => undefined);
  if (existing && sha256(existing) === asset.sha256) {
    kept++;
    continue;
  }
  console.log(`Downloading ${asset.name} (${(asset.bytes / 1e6).toFixed(1)} MB)`);
  const response = await fetch(asset.url);
  if (!response.ok) throw Error(`${response.status} ${asset.name}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (data.length !== asset.bytes || sha256(data) !== asset.sha256)
    throw Error(`Integrity check failed: ${asset.name}`);
  await writeFile(`${path}.tmp`, data);
  await rename(`${path}.tmp`, path);
  fetched++;
}
console.log(`Engine host models verified: ${kept} kept, ${fetched} downloaded.`);
