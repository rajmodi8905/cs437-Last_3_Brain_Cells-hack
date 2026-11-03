// Runs one test suite into its own evidence directory and records how the run ended.
// Earlier evidence for the same suite is moved to history/, never overwritten.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

const COMMANDS = {
  fast: (dir) => [
    'node_modules/vitest/vitest.mjs',
    'run',
    '--reporter=default',
    '--reporter=json',
    `--outputFile.json=${join(dir, 'results.json')}`,
  ],
  browser: () => ['node_modules/@playwright/test/cli.js', 'test', 'tests/e2e'],
  acceptance: () => ['node_modules/@playwright/test/cli.js', 'test', 'tests/acceptance'],
};
const [suite, ...extra] = process.argv.slice(2);
if (!COMMANDS[suite]) {
  console.error(
    `Usage: node scripts/run-suite.mjs <${Object.keys(COMMANDS).join('|')}> [runner args]`,
  );
  process.exit(2);
}
const root = resolve(process.env.CR_EVIDENCE_DIR || 'test-evidence');
const dir = join(root, suite);
if (existsSync(dir)) {
  const previous = await readFile(join(dir, 'run.json'), 'utf8')
    .then((text) => JSON.parse(text).startedAt)
    .catch(() => undefined);
  const stamp = (previous ?? new Date().toISOString()).replace(/[:.]/g, '-');
  await mkdir(join(root, 'history'), { recursive: true });
  let target = join(root, 'history', `${suite}-${stamp}`);
  for (let n = 2; existsSync(target); n++) target = join(root, 'history', `${suite}-${stamp}-${n}`);
  await rename(dir, target);
  console.log(`Kept earlier ${suite} evidence in ${target}`);
}
await mkdir(dir, { recursive: true });
const git = (...gitArgs) => {
  try {
    return execFileSync('git', gitArgs, { encoding: 'utf8' }).trim();
  } catch {
    return undefined;
  }
};
const sha = git('rev-parse', 'HEAD') ?? 'unknown';
// With local changes the commit does not identify the tested code.
const dirty = git('status', '--porcelain') !== '';
const args = [...COMMANDS[suite](dir), ...extra];
const record = {
  suite,
  sha,
  dirty,
  command: ['node', ...args].join(' '),
  runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
  runId: process.env.GITHUB_RUN_ID ?? null,
  startedAt: new Date().toISOString(),
};
const save = (fields) =>
  writeFile(join(dir, 'run.json'), JSON.stringify({ ...record, ...fields }, null, 2) + '\n');
await save({ exitCode: null, status: 'running' });
const started = Date.now();
const child = spawn(process.execPath, args, {
  stdio: 'inherit',
  env: { ...process.env, CR_SUITE_DIR: dir },
});
const forward = (signal) => child.kill(signal);
process.on('SIGINT', forward);
process.on('SIGTERM', forward);
const [exitCode, signal] = await new Promise((done) => {
  child.on('error', (error) => {
    console.error(error);
    done([null, null]);
  });
  child.on('exit', (code, sig) => done([code, sig]));
});
// Some tests write reports straight to test-results/ (axe findings, route screenshots,
// retrieval and calibration reports). Keep this run's copies with its evidence.
if (existsSync('test-results'))
  for (const entry of await readdir('test-results', { recursive: true, withFileTypes: true })) {
    const source = join(entry.parentPath, entry.name);
    if (!entry.isFile() || statSync(source).mtimeMs < started - 2000) continue;
    const target = join(dir, 'test-results', relative('test-results', source));
    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target);
  }
await save({
  exitCode,
  signal,
  status: exitCode === 0 ? 'passed' : 'failed',
  finishedAt: new Date().toISOString(),
  results: existsSync(join(dir, 'results.json')),
});
console.log(`${suite} evidence: ${dir}`);
process.exit(exitCode ?? 1);
