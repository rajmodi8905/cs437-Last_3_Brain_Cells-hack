// One Docker command runs the existing suites, with real local PostgreSQL/Azurite.
// No Docker socket, Azure account, Google credential or host Node installation is needed.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const evidence = '/evidence';
await mkdir(evidence, { recursive: true });
// Each invocation retains the complete previous report before producing new evidence.
const previous = (await readdir(evidence)).filter((name) => name !== 'history');
if (previous.length) {
  const history = join(evidence, 'history', new Date().toISOString().replace(/[:.]/g, '-'));
  await mkdir(history, { recursive: true });
  for (const name of previous) await rename(join(evidence, name), join(history, name));
}
const inputRoots = [
  'package.json',
  'package-lock.json',
  'SPEC.md',
  'eslint.config.js',
  '.prettierrc.json',
  '.gitignore',
  'tsconfig.json',
  'vite.config.ts',
  'playwright.config.ts',
  'index.html',
  'public',
  'docs/verification/retrieval-freeze.json',
  'src',
  'tests',
  'scripts',
  'pilot',
  'vendor',
  'docs/product',
  'docs/pilot',
];
const files = [];
async function fingerprint(path) {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name)))
      if (entry.isDirectory() || entry.isFile()) await fingerprint(join(path, entry.name));
  } catch (cause) {
    if (cause.code !== 'ENOTDIR') throw cause;
    const bytes = await readFile(path);
    files.push({
      path,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  }
}
for (const path of inputRoots) await fingerprint(path);
await writeFile(
  join(evidence, 'source-snapshot.json'),
  JSON.stringify(
    {
      recordedAt: new Date().toISOString(),
      note: 'Docker input snapshot. Sanitized shallow HEAD metadata identifies the base; run.json records actual dirty state. No Git config, hooks, credentials or earlier history are included.',
      sha256: createHash('sha256').update(JSON.stringify(files)).digest('hex'),
      files,
    },
    null,
    2,
  ) + '\n',
);

async function run(command, args, env = {}) {
  console.log(`\nRunning ${command} ${args.join(' ')}`);
  const child = spawn(command, args, { stdio: 'inherit', env: { ...process.env, ...env } });
  const forward = (signal) => child.kill(signal);
  process.on('SIGTERM', forward);
  process.on('SIGINT', forward);
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (status) => resolve(status ?? 1));
  });
  process.off('SIGTERM', forward);
  process.off('SIGINT', forward);
  if (code !== 0) process.exit(code);
}

await run('npm', ['run', 'models:download']);
await run('npm', ['run', 'check']);
await run('npm', ['run', 'format:check']);
await run('npm', ['run', 'spec:mapping']);
await run('npm', ['test']);
await run('npm', [
  'run',
  'test:pilot',
  '--',
  '--reporter=default',
  '--reporter=json',
  '--outputFile.json=/evidence/pilot-storage.json',
]);
await run(
  'npm',
  [
    'run',
    'test:pilot:e2e',
    '--',
    '--reporter=list,json',
    '--output=/evidence/pilot-browser/artifacts',
  ],
  { PLAYWRIGHT_JSON_OUTPUT_NAME: '/evidence/pilot-browser/results.json' },
);
await run('npm', ['run', 'test:pilot:models']);
await run('npm', ['run', 'release:check']);

const fast = JSON.parse(await readFile('/evidence/root/fast/results.json', 'utf8'));
const storage = JSON.parse(await readFile('/evidence/pilot-storage.json', 'utf8'));
for (const [name, result] of [
  ['fast', fast],
  ['pilot-storage', storage],
])
  if (!result.success || result.numPendingTests || result.numTodoTests || !result.numTotalTests)
    throw new Error(`${name} must execute all its tests without skips.`);
for (const path of ['root/browser', 'root/acceptance', 'pilot-browser', 'pilot-model']) {
  const result = JSON.parse(await readFile(join(evidence, path, 'results.json'), 'utf8'));
  if (
    result.stats.skipped ||
    result.stats.unexpected ||
    result.stats.flaky ||
    !result.stats.expected
  )
    throw new Error(`${path} must pass without skips or flaky retries.`);
}
console.log('\nAll checker suites passed. Reports: test-evidence/docker/ on the host.');
