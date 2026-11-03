// Evaluates S1-S15 from explicitly mapped, actually executed test identities.
// Pure functions only: the CLIs read files, this module decides outcomes.
import { isAbsolute, relative, resolve } from 'node:path';

export const SUITES = ['fast', 'browser', 'acceptance'];
const SEPARATOR = ' > ';
const posix = (path) => path.split('\\').join('/');
export const testKey = ({ suite, file, title }) => `${suite}|${file}|${title}`;

/** The runner that executes a test file: test:browser runs tests/e2e, test:acceptance tests/acceptance. */
export function suiteForFile(file) {
  if (file.startsWith('tests/e2e/')) return 'browser';
  if (file.startsWith('tests/acceptance/')) return 'acceptance';
  return 'fast';
}

function repoRelative(file, root) {
  return posix(relative(root, isAbsolute(file) ? file : resolve(root, file)));
}

const VITEST_STATUS = {
  passed: 'passed',
  failed: 'failed',
  skipped: 'skipped',
  pending: 'skipped',
  todo: 'skipped',
  disabled: 'skipped',
};

/** Normalizes a Vitest JSON report into executed test results and file-level errors. */
export function normalizeVitest(report, root) {
  const results = [];
  const errors = [];
  for (const file of report.testResults ?? []) {
    const path = repoRelative(file.name, root);
    if (file.status === 'failed' && file.message)
      errors.push({ file: path, message: file.message });
    for (const test of file.assertionResults ?? [])
      results.push({
        suite: 'fast',
        file: path,
        title: [...(test.ancestorTitles ?? []), test.title].join(SEPARATOR),
        status: VITEST_STATUS[test.status] ?? 'failed',
        message: test.failureMessages?.[0],
      });
  }
  return { results, errors };
}

/** Lists identities from `vitest list --json`, which joins describe titles with " > ". */
export function listVitest(entries, root) {
  return entries.map((entry) => ({
    suite: 'fast',
    file: repoRelative(entry.file, root),
    title: entry.name,
  }));
}

function playwrightStatus(test) {
  // A test without results never executed: an interrupted or aborted run, not a deliberate skip.
  if (!test.results?.length) return test.expectedStatus === 'skipped' ? 'skipped' : 'not-run';
  if (test.status === 'expected') return test.expectedStatus === 'skipped' ? 'skipped' : 'passed';
  if (test.status === 'flaky') return 'flaky';
  if (test.status === 'skipped') return 'skipped';
  return 'failed';
}
const WORST = ['failed', 'not-run', 'skipped', 'flaky', 'passed'];
const worst = (statuses) => WORST.find((status) => statuses.includes(status)) ?? 'not-run';

function walkPlaywright(report, root, visit) {
  const testDir = report.config?.rootDir ?? root;
  const walk = (suite, path, file) => {
    for (const spec of suite.specs ?? [])
      visit({
        file: repoRelative(resolve(testDir, spec.file ?? file), root),
        title: [...path, spec.title].join(SEPARATOR),
        tests: spec.tests ?? [],
      });
    for (const child of suite.suites ?? []) walk(child, [...path, child.title], file);
  };
  for (const suite of report.suites ?? []) walk(suite, [], suite.file);
}

/** Normalizes a Playwright JSON report; global errors include failed web servers and setup. */
export function normalizePlaywright(report, suite, root) {
  const results = [];
  walkPlaywright(report, root, ({ file, title, tests }) => {
    const statuses = tests.map(playwrightStatus);
    const failed = tests.flatMap((test) => test.results ?? []).find((r) => r.error);
    results.push({ suite, file, title, status: worst(statuses), message: failed?.error?.message });
  });
  const errors = (report.errors ?? []).map((error) => ({
    file: error.location?.file ? repoRelative(error.location.file, root) : null,
    message: error.message ?? String(error.value ?? 'Unknown runner error'),
  }));
  return { results, errors };
}

/** Lists identities from `playwright test --list --reporter=json`. */
export function listPlaywright(report, root) {
  const listed = [];
  walkPlaywright(report, root, ({ file, title }) =>
    listed.push({ suite: suiteForFile(file), file, title }),
  );
  return listed;
}

/** Structural mapping errors. With `listed`, also reports stale identities and unmapped tests. */
export function validateMapping(coverage, specIds, listed) {
  const errors = [];
  const ids = coverage.statements?.map((statement) => statement.id) ?? [];
  if (JSON.stringify(ids) !== JSON.stringify(specIds))
    errors.push(
      `Statements must list every SPEC ID once, in order: expected ${specIds.join(', ')}.`,
    );
  const mapped = new Set();
  for (const statement of coverage.statements ?? []) {
    if (!statement.scope || !Array.isArray(statement.remaining))
      errors.push(`${statement.id}: scope and remaining are required.`);
    if (!Array.isArray(statement.tests) || !statement.tests.length) {
      errors.push(`${statement.id}: map at least one required test.`);
      continue;
    }
    const own = new Set();
    for (const test of statement.tests) {
      const label = `${statement.id}: ${test.file ?? '?'} :: ${test.title ?? '?'}`;
      if (!SUITES.includes(test.suite) || !test.file || !test.title) {
        errors.push(`${label} needs suite (${SUITES.join('/')}), file and title.`);
        continue;
      }
      if (suiteForFile(test.file) !== test.suite)
        errors.push(`${label} is executed by ${suiteForFile(test.file)}, not ${test.suite}.`);
      if (own.has(testKey(test))) errors.push(`${label} is listed twice.`);
      own.add(testKey(test));
      mapped.add(testKey(test));
    }
  }
  if (!listed) return { errors, stale: [], unmapped: [] };
  const available = new Set(listed.map(testKey));
  const stale = (coverage.statements ?? []).flatMap((statement) =>
    (statement.tests ?? [])
      .filter((test) => !available.has(testKey(test)))
      .map((test) => ({ statement: statement.id, ...test })),
  );
  for (const test of stale)
    errors.push(`${test.statement}: no such test ${test.suite} ${test.file} :: ${test.title}`);
  const unmapped = listed.filter((test) => !mapped.has(testKey(test)));
  return { errors, stale, unmapped };
}

const count = (results, status) => results.filter((result) => result.status === status).length;

/**
 * Decides suite and statement outcomes. `suites[name]` is `{ run, report, problems }` for evidence
 * that exists; an absent suite was not run. A statement passes only when every mapped test of a
 * required suite has an executed passing result from evidence for `sourceSha`.
 */
export function evaluate({ coverage, specIds, suites, sourceSha, required = SUITES }) {
  const mappingErrors = validateMapping(coverage, specIds).errors;
  const suiteRows = SUITES.map((name) => {
    const evidence = suites[name];
    const isRequired = required.includes(name);
    if (!evidence)
      return { suite: name, required: isRequired, outcome: 'not-run', problems: [], results: [] };
    const problems = [...(evidence.problems ?? [])];
    const results = evidence.report?.results ?? [];
    const errors = evidence.report?.errors ?? [];
    const run = evidence.run ?? {};
    if (!evidence.report) problems.push('No results file was produced.');
    for (const error of errors)
      problems.push(`${error.file ? `${error.file}: ` : ''}${error.message.split('\n')[0]}`);
    if (run.exitCode !== 0)
      problems.push(
        `Runner exited with ${run.exitCode ?? 'no exit code'}${run.signal ? ` (${run.signal})` : ''}.`,
      );
    const otherCommit = sourceSha && run.sha && run.sha !== sourceSha;
    if (otherCommit) problems.push(`Evidence is for ${run.sha}, not ${sourceSha}.`);
    if (run.dirty)
      problems.push(`Recorded from a checkout with uncommitted changes to ${run.sha}.`);
    const stale = otherCommit || run.dirty === true;
    const counts = {
      recorded: results.length,
      executed: count(results, 'passed') + count(results, 'flaky') + count(results, 'failed'),
      passed: count(results, 'passed') + count(results, 'flaky'),
      failed: count(results, 'failed'),
      skipped: count(results, 'skipped'),
      notRun: count(results, 'not-run'),
      flaky: count(results, 'flaky'),
    };
    // Every failure is listed, including tests that are not mapped to a statement.
    for (const result of results.filter((r) => r.status === 'failed'))
      problems.push(`Failed: ${result.file} :: ${result.title}`);
    const outcome = stale
      ? 'stale'
      : !evidence.report
        ? 'not-run'
        : counts.failed || errors.length || run.exitCode !== 0
          ? 'failed'
          : counts.executed === 0
            ? 'not-run'
            : 'passed';
    return { suite: name, required: isRequired, outcome, counts, problems, run, results };
  });
  // Results from evidence for another commit can never satisfy a statement.
  const usable = new Map(
    suiteRows
      .filter((row) => row.outcome !== 'stale')
      .flatMap((row) => row.results.map((result) => [testKey(result), result])),
  );
  const rowFor = Object.fromEntries(suiteRows.map((row) => [row.suite, row]));
  const statements = (coverage.statements ?? []).map((statement) => {
    const tests = (statement.tests ?? []).map((test) => {
      const suiteRow = rowFor[test.suite];
      const result = usable.get(testKey(test));
      let status;
      if (!suiteRow?.required) status = 'not-required';
      else if (suiteRow.outcome === 'stale') status = 'stale';
      // No results at all: the suite never ran or failed before executing tests.
      else if (!suiteRow.results.length) status = 'not-run';
      // The suite ran but has no such test: a renamed/removed test or a filtered run.
      else status = result?.status ?? 'missing';
      return { ...test, status, message: result?.message };
    });
    const considered = tests.filter((test) => test.status !== 'not-required');
    const statuses = considered.map((test) => test.status);
    const outcome = !considered.length
      ? required.length === SUITES.length
        ? 'unmapped'
        : 'not-required'
      : (['failed', 'stale', 'missing', 'not-run', 'skipped'].find((s) => statuses.includes(s)) ??
        'passed');
    return {
      id: statement.id,
      scope: statement.scope,
      outcome,
      passed: considered.filter((t) => t.status === 'passed' || t.status === 'flaky').length,
      required: considered.length,
      tests,
      manualEvidence: statement.manualEvidence ?? [],
      remaining: statement.remaining ?? [],
    };
  });
  const gatePassed =
    !mappingErrors.length &&
    suiteRows.every((row) => !row.required || row.outcome === 'passed') &&
    statements.every((s) => s.outcome === 'passed' || s.outcome === 'not-required');
  return {
    sourceSha: sourceSha ?? null,
    required,
    gate: gatePassed ? 'passed' : 'failed',
    mappingErrors,
    suites: suiteRows.map(({ results, ...row }) => row),
    statements,
  };
}

const ICON = { passed: 'PASS', failed: 'FAIL', stale: 'STALE', missing: 'MISSING' };
const label = (outcome) => ICON[outcome] ?? outcome.toUpperCase();

/** Markdown for job summaries and the uploaded report. */
export function renderMarkdown(summary, context = {}) {
  const lines = [
    `## S1-S15 test evidence: ${label(summary.gate)}`,
    '',
    `Tested commit: \`${summary.sourceSha ?? 'unknown'}\`${context.headSha && context.headSha !== summary.sourceSha ? ` (pull request head \`${context.headSha}\`)` : ''}`,
    `Required suites: ${summary.required.join(', ')}`,
    '',
    '| Suite | Required | Outcome | Recorded | Executed | Passed | Failed | Skipped | Not run |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const row of summary.suites) {
    const c = row.counts;
    const cells = c
      ? [c.recorded, c.executed, c.passed, c.failed, c.skipped, c.notRun]
      : ['-', '-', '-', '-', '-', '-'];
    lines.push(
      `| ${row.suite} | ${row.required ? 'yes' : 'no'} | ${label(row.outcome)} | ${cells.join(' | ')} |`,
    );
  }
  lines.push(
    '',
    '| Statement | Outcome | Mapped tests passed | Not passing |',
    '| --- | --- | --- | --- |',
  );
  for (const statement of summary.statements) {
    const failing = statement.tests
      .filter((t) => !['passed', 'flaky', 'not-required'].includes(t.status))
      .map((t) => `${t.status}: ${t.file} :: ${t.title}`.replaceAll('|', '\\|'));
    lines.push(
      `| ${statement.id} | ${label(statement.outcome)} | ${statement.passed}/${statement.required} | ${failing.join('<br>') || '-'} |`,
    );
  }
  const problems = [
    ...summary.mappingErrors.map((error) => `Mapping: ${error}`),
    ...summary.suites.flatMap((row) => row.problems.map((p) => `${row.suite}: ${p}`)),
  ];
  if (problems.length)
    lines.push('', '### Problems', '', ...problems.map((p) => `- ${p.replaceAll('\n', ' ')}`));
  const manual = summary.statements.filter((s) => s.manualEvidence.length || s.remaining.length);
  if (manual.length)
    lines.push(
      '',
      'Manual or physical evidence is recorded separately and is not part of this automated gate: ' +
        manual.map((s) => s.id).join(', ') +
        '.',
    );
  return lines.join('\n') + '\n';
}
