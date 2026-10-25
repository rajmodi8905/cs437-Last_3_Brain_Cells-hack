import { mkdir, readFile, writeFile, copyFile, readdir, stat, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const hash = (data) => createHash('sha256').update(data).digest('hex');
const models = [
  [
    'onnx-community/embeddinggemma-2-ONNX',
    'daa72c51243991dfcaf9f9137d2c573d8f7790c0',
    /^(?:[^/]+\.json|onnx\/(?:model|vision_encoder)_q4\.onnx(?:_data)?)$/,
  ],
  [
    'onnx-community/whisper-tiny.en',
    '2575352d61be1bf7225cf8f8b268a4678025fc58',
    /^(?:[^/]+\.json|onnx\/(?:encoder_model|decoder_model_merged)_quantized\.onnx)$/,
  ],
];
await rm('public/runtime', { recursive: true, force: true });
await mkdir('public/runtime', { recursive: true });
let modelAssets;
try {
  modelAssets = JSON.parse(await readFile('scripts/model-assets.json', 'utf8'));
} catch {
  modelAssets = [];
  for (const [repo, revision, include] of models) {
    const response = await fetch(
      `https://huggingface.co/api/models/${repo}/revision/${revision}?blobs=true`,
    );
    if (!response.ok) throw Error(`Model metadata: ${response.status}`);
    const info = await response.json();
    for (const file of info.siblings.filter((x) => include.test(x.rfilename))) {
      const url = `https://huggingface.co/${repo}/resolve/${revision}/${file.rfilename}`;
      let sha256 = file.lfs?.sha256;
      if (!sha256) {
        const r = await fetch(url);
        if (!r.ok) throw Error(url);
        sha256 = hash(Buffer.from(await r.arrayBuffer()));
      }
      modelAssets.push({
        url,
        bytes: file.size,
        sha256,
        group: repo.includes('whisper') ? 'speech' : 'embeddings',
        name: `${repo.split('/')[1]}/${file.rfilename}`,
      });
    }
  }
  // English data is explicitly downloaded only when the user sets up offline search.
  const url =
    'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int/eng.traineddata.gz';
  const r = await fetch(url);
  if (!r.ok) throw Error('OCR data unavailable');
  const data = Buffer.from(await r.arrayBuffer());
  modelAssets.push({
    url,
    bytes: data.length,
    sha256: hash(data),
    group: 'ocr',
    name: 'English OCR data',
  });
  await writeFile('scripts/model-assets.json', JSON.stringify(modelAssets, null, 2) + '\n');
}
const runtimeAssets = [];
async function copy(source, target) {
  await mkdir(path.dirname(`public/runtime/${target}`), { recursive: true });
  await copyFile(source, `public/runtime/${target}`);
  const data = await readFile(source);
  runtimeAssets.push({
    url: `./runtime/${target}`,
    bytes: data.length,
    sha256: hash(data),
    group: 'runtime',
    name: target,
  });
}
for (const file of [
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.asyncify.mjs',
  'ort-wasm-simd-threaded.asyncify.wasm',
])
  await copy(`node_modules/onnxruntime-web/dist/${file}`, `ort/${file}`);
for (const file of ['ffmpeg-core.js', 'ffmpeg-core.wasm'])
  await copy(`node_modules/@ffmpeg/core/dist/esm/${file}`, `ffmpeg/${file}`);
for (const file of await readdir('node_modules/@ffmpeg/ffmpeg/dist/esm'))
  if (file.endsWith('.js'))
    await copy(`node_modules/@ffmpeg/ffmpeg/dist/esm/${file}`, `ffmpeg/bridge/${file}`);
await copy('node_modules/tesseract.js/dist/worker.min.js', 'ocr/worker.min.js');
for (const file of ['tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm'])
  await copy(`node_modules/tesseract.js-core/${file}`, `ocr/${file}`);
await copy('node_modules/pdfjs-dist/build/pdf.worker.min.mjs', 'pdf.worker.min.mjs');
for (const pkg of [
  'react',
  'react-dom',
  'dexie',
  'fflate',
  'lucide-react',
  '@huggingface/transformers',
  'onnxruntime-web',
  'tesseract.js',
  'tesseract.js-core',
  'pdfjs-dist',
  '@ffmpeg/core',
  '@ffmpeg/ffmpeg',
]) {
  for (const file of await readdir(`node_modules/${pkg}`))
    if (/^(LICENSE|NOTICE|COPYING)(\.|$)/i.test(file)) {
      const info = await stat(`node_modules/${pkg}/${file}`);
      if (info.isFile())
        await copy(
          `node_modules/${pkg}/${file}`,
          `licenses/${pkg.replaceAll('/', '-')}-${file}.txt`,
        );
    }
}
const assets = [...modelAssets, ...runtimeAssets];
await writeFile(
  'public/asset-manifest.json',
  JSON.stringify({ version: hash(JSON.stringify(assets)).slice(0, 16), assets }, null, 2) + '\n',
);
console.log(
  `Prepared ${assets.length} pinned offline assets (${(assets.reduce((n, x) => n + x.bytes, 0) / 1e6).toFixed(1)} MB).`,
);
