// Builds the spec-status table from SPEC.md, tests/spec/coverage.json and the
// JSON reports written by the commands in SKILL.md. Run from the repo root.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const OUT = '.cache/spec-status';
const rel = (file) => path.relative(process.cwd(), file).split(path.sep).join('/');
const readJson = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null);
const firstLine = (text) => (text ?? '').replace(/\x1b\[[0-9;]*m/g, '').trim().split('\n')[0];

const statements = [...readFileSync('SPEC.md', 'utf8').matchAll(/^### (S\d+)\s*[—-]\s*(.+)$/gm)].map(
  ([, id, title]) => ({ id, title: title.trim() }),
);
const registry = new Map(readJson('tests/spec/coverage.json').statements.map((s) => [s.id, s.files]));

// One entry per test: { file, titles (describe path + test title), status, error }.
const results = [];
const vitest = readJson(`${OUT}/vitest.json`);
for (const file of vitest?.testResults ?? [])
  for (const t of file.assertionResults)
    results.push({
      file: rel(file.name),
      titles: [...t.ancestorTitles, t.title],
      status: t.status === 'passed' ? 'passed' : t.status === 'failed' ? 'failed' : 'skipped',
      error: firstLine(t.failureMessages?.[0]),
    });
const playwright = readJson(`${OUT}/playwright.json`);
const walk = (suite, titles) => {
  for (const spec of suite.specs ?? [])
    for (const t of spec.tests) {
      const last = t.results.at(-1);
      results.push({
        file: rel(path.resolve(playwright.config.rootDir, spec.file)),
        titles: [...titles, spec.title],
        status: { expected: 'passed', flaky: 'passed', unexpected: 'failed' }[t.status] ?? 'skipped',
        error: firstLine(last?.error?.message ?? last?.errors?.[0]?.message),
      });
    }
  for (const child of suite.suites ?? []) walk(child, [...titles, child.title]);
};
for (const suite of playwright?.suites ?? []) walk(suite, []);
// A server that fails to start leaves no tests in the report, only this error.
for (const error of playwright?.errors ?? [])
  console.log(`Playwright did not run: ${firstLine(error.message)}\n`);
const ranFiles = new Set(results.map((r) => r.file));

// A test belongs to the statements named in its title ("[S6] ..." or "S9: ...");
// an untagged test belongs to every statement whose registry lists its file.
const tagsOf = (r) => [...r.titles.join(' ').matchAll(/(?:\[|^|\s)(S\d+)(?=[\]:])/g)].map((m) => m[1]);
const rows = statements.map(({ id, title }) => {
  const files = registry.get(id) ?? [];
  const mine = results.filter((r) => {
    const tags = tagsOf(r);
    return tags.length ? tags.includes(id) : files.includes(r.file);
  });
  const passed = mine.filter((r) => r.status === 'passed').length;
  const failed = mine.filter((r) => r.status === 'failed');
  // helpers.ts holds shared acceptance checks; it runs inside the spec files.
  const notRun = files.filter((f) => /\.(test|spec)\.tsx?$/.test(f) && !ranFiles.has(f));
  let result;
  if (!files.length && !mine.length) result = 'no test';
  else if (failed.length) result = `**red**: ${failed[0].titles.at(-1)} :: ${failed[0].error}`;
  else if (notRun.length || !passed) result = `not run: ${notRun.join(', ') || 'all skipped'}`;
  else result = 'green';
  const tests = `${passed} passed, ${failed.length} failed (${files.length} files)`;
  return { id, title, tests, result };
});

const esc = (s) => s.replaceAll('|', '\\|');
console.log('| ID | Statement | Tests | Result |');
console.log('|----|-----------|-------|--------|');
for (const r of rows) console.log(`| ${r.id} | ${esc(r.title)} | ${r.tests} | ${esc(r.result)} |`);
const count = (p) => rows.filter((r) => p(r.result)).length;
const green = count((x) => x === 'green');
const red = count((x) => x.startsWith('**red'));
const none = count((x) => x === 'no test');
const notRun = rows.length - green - red - none;
const all = results.filter((r) => r.status !== 'skipped');
console.log(
  `\n${green} green, ${red} red, ${none} with no test, ${notRun} not run. ` +
    `${all.filter((r) => r.status === 'passed').length} of ${all.length} tests passed.`,
);
const listed = new Set([...registry.values()].flat());
const stray = results.filter(
  (r) => r.status === 'failed' && !tagsOf(r).length && !listed.has(r.file),
);
if (stray.length)
  console.log(
    `Also failing, outside every statement: ${stray.map((r) => `${r.file} :: ${r.titles.at(-1)}`).join('; ')}.`,
  );
const next =
  rows.find((r) => r.result.startsWith('**red')) ??
  rows.find((r) => r.result === 'no test') ??
  rows.find((r) => r.result.startsWith('not run'));
console.log(next ? `Next: ${next.id} (${next.title}).` : 'Next: nothing; every statement is green.');
