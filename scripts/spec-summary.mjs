// Summarizes S1-S15 from executed test evidence and gates on it.
// Usage: node scripts/spec-summary.mjs [--evidence dir] [--require fast,browser,acceptance]
//        [--only suite] [--sha commit] [--out dir] [--report-only]
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  SUITES,
  evaluate,
  normalizePlaywright,
  normalizeVitest,
  renderMarkdown,
} from './spec-evidence.mjs';

const { values } = parseArgs({
  options: {
    evidence: { type: 'string' },
    require: { type: 'string' },
    only: { type: 'string' },
    sha: { type: 'string' },
    out: { type: 'string' },
    'report-only': { type: 'boolean', default: false },
  },
});
const root = resolve(values.evidence ?? process.env.CR_EVIDENCE_DIR ?? 'test-evidence');
const required = values.only ? [values.only] : (values.require?.split(',') ?? SUITES);
for (const suite of required)
  if (!SUITES.includes(suite)) throw Error(`Unknown suite ${suite}; use ${SUITES.join(', ')}.`);
const sourceSha =
  values.sha ??
  process.env.CR_SOURCE_SHA ??
  (() => {
    try {
      return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    } catch {
      return undefined;
    }
  })();

// Local runs write <root>/<suite>; CI downloads each artifact into <root>/<artifact>/<suite>.
async function candidates(suite) {
  const found = [join(root, suite)];
  if (existsSync(root))
    for (const entry of await readdir(root, { withFileTypes: true }))
      if (entry.isDirectory() && entry.name !== 'history' && !SUITES.includes(entry.name))
        found.push(join(root, entry.name, suite));
  return found.filter((dir) => existsSync(join(dir, 'run.json')));
}
async function load(suite, dir) {
  const problems = [];
  const read = async (name) => {
    const path = join(dir, name);
    if (!existsSync(path)) return undefined;
    try {
      return JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
      problems.push(`${name} is unreadable: ${error.message}`);
      return undefined;
    }
  };
  const run = await read('run.json');
  const raw = await read('results.json');
  const report = raw
    ? suite === 'fast'
      ? normalizeVitest(raw, process.cwd())
      : normalizePlaywright(raw, suite, process.cwd())
    : undefined;
  return { dir, run, report, problems };
}
const suites = {};
const superseded = [];
for (const suite of SUITES) {
  const loaded = await Promise.all((await candidates(suite)).map((dir) => load(suite, dir)));
  loaded.sort(
    (a, b) =>
      Number(b.run?.runAttempt ?? 0) - Number(a.run?.runAttempt ?? 0) ||
      String(b.run?.startedAt ?? '').localeCompare(String(a.run?.startedAt ?? '')),
  );
  if (loaded[0]) suites[suite] = loaded[0];
  for (const older of loaded.slice(1)) superseded.push(`${suite}: ${relative(root, older.dir)}`);
}
const coverage = JSON.parse(await readFile('tests/spec/coverage.json', 'utf8'));
const spec = await readFile('SPEC.md', 'utf8');
const specIds = [...spec.matchAll(/^### (S\d+)\b/gm)].map((m) => m[1]);
const summary = evaluate({ coverage, specIds, suites, sourceSha, required });
let markdown = renderMarkdown(summary, { headSha: process.env.CR_PR_HEAD_SHA });
if (superseded.length)
  markdown += `\nEarlier evidence kept but superseded by a later attempt: ${superseded.join('; ')}.\n`;
const out = resolve(values.out ?? root);
await mkdir(out, { recursive: true });
const name = values.only ? `spec-summary-${values.only}` : 'spec-summary';
await writeFile(
  join(out, `${name}.json`),
  JSON.stringify({ ...summary, generatedAt: new Date().toISOString(), superseded }, null, 2) + '\n',
);
await writeFile(join(out, `${name}.md`), markdown);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown);
console.log(markdown);
if (summary.gate !== 'passed' && !values['report-only']) process.exitCode = 1;
