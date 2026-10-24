import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
await mkdir('.models', { recursive: true });
const { assets } = JSON.parse(await readFile('public/asset-manifest.json', 'utf8'));
for (const asset of assets.filter((x) => x.url.startsWith('https:'))) {
  const path = `.models/${asset.sha256}`;
  let data;
  try {
    data = await readFile(path);
  } catch {}
  if (data && createHash('sha256').update(data).digest('hex') === asset.sha256) continue;
  console.log(`Downloading ${asset.name} (${(asset.bytes / 1e6).toFixed(1)} MB)`);
  const response = await fetch(asset.url);
  if (!response.ok) throw Error(`${response.status} ${asset.name}`);
  data = Buffer.from(await response.arrayBuffer());
  if (
    data.length !== asset.bytes ||
    createHash('sha256').update(data).digest('hex') !== asset.sha256
  )
    throw Error(`Integrity check failed: ${asset.name}`);
  await writeFile(`${path}.tmp`, data);
  await rename(`${path}.tmp`, path);
}
console.log('Pinned test assets verified in .models/. No library data downloaded.');
