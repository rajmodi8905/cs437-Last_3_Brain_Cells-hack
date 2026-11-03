// Lists every test the runners would execute and rejects stale S1-S15 mappings.
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listPlaywright, listVitest, validateMapping } from './spec-evidence.mjs';
const root = process.cwd();
const spec = await readFile('SPEC.md', 'utf8');
const ids = [...spec.matchAll(/^### (S\d+)\b/gm)].map((m) => m[1]);
const coverage = JSON.parse(await readFile('tests/spec/coverage.json', 'utf8'));
const directory = await mkdtemp(join(tmpdir(), 'recall-spec-list-'));
let listed;
try {
  const vitestList = join(directory, 'vitest.json');
  execFileSync(
    process.execPath,
    ['node_modules/vitest/vitest.mjs', 'list', `--json=${vitestList}`],
    {
      stdio: ['ignore', 'ignore', 'inherit'],
    },
  );
  const playwright = execFileSync(
    process.execPath,
    ['node_modules/@playwright/test/cli.js', 'test', '--list', '--reporter=json'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] },
  );
  listed = [
    ...listVitest(JSON.parse(await readFile(vitestList, 'utf8')), root),
    ...listPlaywright(JSON.parse(playwright), root),
  ];
} finally {
  await rm(directory, { recursive: true, force: true });
}
const { errors, unmapped } = validateMapping(coverage, ids, listed);
const counts = Object.groupBy(listed, (test) => test.suite);
console.log(
  `Listed ${listed.length} tests (${Object.entries(counts)
    .map(([suite, tests]) => `${suite} ${tests.length}`)
    .join(', ')}); ${unmapped.length} are not mapped to a statement and still run in their suites.`,
);
if (errors.length) {
  console.error(`Stale or invalid S1-S15 mapping:\n${errors.join('\n')}`);
  process.exitCode = 1;
} else console.log('Every mapped S1-S15 test identity exists in its runner.');
