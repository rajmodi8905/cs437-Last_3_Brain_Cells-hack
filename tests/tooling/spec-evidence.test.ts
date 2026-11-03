import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  evaluate,
  listPlaywright,
  normalizePlaywright,
  normalizeVitest,
  renderMarkdown,
  validateMapping,
  type Coverage,
  type SuiteEvidence,
} from '../../scripts/spec-evidence.mjs';

const root = resolve('/repo');
const SHA = 'a'.repeat(40);
const ids = ['S1', 'S2'];
const coverage: Coverage = {
  statements: [
    {
      id: 'S1',
      scope: 'save',
      remaining: [],
      tests: [
        { suite: 'fast', file: 'tests/spec/save.test.ts', title: 'saves > keeps bytes' },
        { suite: 'browser', file: 'tests/e2e/save.spec.ts', title: 'reopens the original' },
      ],
    },
    {
      id: 'S2',
      scope: 'search',
      remaining: [],
      tests: [{ suite: 'acceptance', file: 'tests/acceptance/search.spec.ts', title: 'finds R1' }],
    },
  ],
};

const vitestReport = (status = 'passed') => ({
  testResults: [
    {
      name: join(root, 'tests/spec/save.test.ts'),
      status: status === 'passed' ? 'passed' : 'failed',
      message: '',
      assertionResults: [
        { ancestorTitles: ['saves'], title: 'keeps bytes', status, failureMessages: ['boom'] },
        { ancestorTitles: [], title: 'unmapped helper', status: 'passed', failureMessages: [] },
      ],
    },
  ],
});
const pwTest = (status: string, results = [{ status: 'passed' }], expectedStatus = 'passed') => ({
  status,
  expectedStatus,
  results,
});
const playwrightReport = (file: string, title: string, test = pwTest('expected'), errors = []) => ({
  config: { rootDir: join(root, 'tests') },
  errors,
  suites: [{ title: file, file, specs: [{ title, file, tests: [test] }] }],
});
const run = (exitCode = 0, sha = SHA) => ({ exitCode, sha });
const passing = (): Record<string, SuiteEvidence> => ({
  fast: { run: run(), report: normalizeVitest(vitestReport(), root) },
  browser: {
    run: run(),
    report: normalizePlaywright(
      playwrightReport('e2e/save.spec.ts', 'reopens the original'),
      'browser',
      root,
    ),
  },
  acceptance: {
    run: run(),
    report: normalizePlaywright(
      playwrightReport('acceptance/search.spec.ts', 'finds R1'),
      'acceptance',
      root,
    ),
  },
});
const summarize = (suites: Record<string, SuiteEvidence>, required?: any) =>
  evaluate({ coverage, specIds: ids, suites, sourceSha: SHA, required });

describe('runner report normalization', () => {
  it('keeps Vitest describe paths, repository-relative files and file load errors', () => {
    const report = normalizeVitest(
      {
        testResults: [
          ...vitestReport('skipped').testResults,
          {
            name: join(root, 'tests/broken.test.ts'),
            status: 'failed',
            message: 'SyntaxError: x',
            assertionResults: [],
          },
        ],
      },
      root,
    );
    expect(report.results[0]).toMatchObject({
      file: 'tests/spec/save.test.ts',
      title: 'saves > keeps bytes',
      status: 'skipped',
    });
    expect(report.errors).toEqual([{ file: 'tests/broken.test.ts', message: 'SyntaxError: x' }]);
  });
  it('separates Playwright passes, failures, deliberate skips, flaky retries and unexecuted tests', () => {
    const status = (test: any) =>
      normalizePlaywright(playwrightReport('e2e/a.spec.ts', 't', test), 'browser', root).results[0]
        .status;
    expect(status(pwTest('expected'))).toBe('passed');
    expect(status(pwTest('unexpected', [{ status: 'failed' }]))).toBe('failed');
    expect(status(pwTest('skipped', [{ status: 'skipped' }], 'skipped'))).toBe('skipped');
    expect(status(pwTest('flaky', [{ status: 'failed' }, { status: 'passed' }]))).toBe('flaky');
    expect(status(pwTest('skipped', []))).toBe('not-run');
  });
  it('joins nested describe titles and lists identities with their executing suite', () => {
    const report = {
      config: { rootDir: join(root, 'tests') },
      suites: [
        {
          title: 'acceptance/x.spec.ts',
          file: 'acceptance/x.spec.ts',
          specs: [],
          suites: [
            { title: 'group', specs: [{ title: 'case', file: 'acceptance/x.spec.ts', tests: [] }] },
          ],
        },
      ],
    };
    expect(listPlaywright(report, root)).toEqual([
      { suite: 'acceptance', file: 'tests/acceptance/x.spec.ts', title: 'group > case' },
    ]);
  });
});

describe('S1-S15 gate', () => {
  it('passes only when every mapped test ran and passed, with counts taken from the reports', () => {
    const summary = summarize(passing());
    expect(summary.gate).toBe('passed');
    expect(summary.statements.map((s) => s.outcome)).toEqual(['passed', 'passed']);
    expect(summary.suites.find((s) => s.suite === 'fast')?.counts).toMatchObject({
      executed: 2,
      passed: 2,
      failed: 0,
    });
  });
  it('fails a statement and the gate when a mapped test fails', () => {
    const suites = passing();
    suites.fast = { run: run(1), report: normalizeVitest(vitestReport('failed'), root) };
    const summary = summarize(suites);
    expect(summary.gate).toBe('failed');
    expect(summary.statements[0]).toMatchObject({ outcome: 'failed', passed: 1, required: 2 });
    expect(summary.statements[1].outcome).toBe('passed');
    expect(renderMarkdown(summary)).toContain(
      'failed: tests/spec/save.test.ts :: saves > keeps bytes',
    );
  });
  it('reports a missing result when the suite ran without the mapped test', () => {
    const suites = passing();
    suites.acceptance.report = normalizePlaywright(
      playwrightReport('acceptance/search.spec.ts', 'finds R1 renamed'),
      'acceptance',
      root,
    );
    const summary = summarize(suites);
    expect(summary.statements[1]).toMatchObject({ outcome: 'missing', passed: 0, required: 1 });
    expect(summary.gate).toBe('failed');
  });
  it('keeps a suite that never ran visible as not run', () => {
    const suites = passing();
    delete suites.browser;
    const summary = summarize(suites);
    expect(summary.suites.find((s) => s.suite === 'browser')?.outcome).toBe('not-run');
    expect(summary.statements[0].tests[1].status).toBe('not-run');
    expect(summary.gate).toBe('failed');
  });
  it('never treats a skipped required test as a pass', () => {
    const suites = passing();
    suites.fast.report = normalizeVitest(vitestReport('skipped'), root);
    const summary = summarize(suites);
    expect(summary.statements[0].outcome).toBe('skipped');
    expect(summary.gate).toBe('failed');
  });
  it('surfaces failed setup that produced no test results', () => {
    const suites = passing();
    suites.acceptance = {
      run: run(1),
      report: normalizePlaywright(
        {
          config: { rootDir: join(root, 'tests') },
          suites: [],
          errors: [{ message: 'Error: Timed out waiting for config.webServer' }],
        },
        'acceptance',
        root,
      ),
    };
    const summary = summarize(suites);
    const acceptance = summary.suites.find((s) => s.suite === 'acceptance');
    expect(acceptance?.outcome).toBe('failed');
    expect(acceptance?.problems.join(' ')).toContain('webServer');
    expect(summary.statements[1].tests[0].status).toBe('not-run');
    expect(summary.gate).toBe('failed');
  });
  it('rejects passing results recorded for another commit', () => {
    const suites = passing();
    suites.browser.run = run(0, 'b'.repeat(40));
    const summary = summarize(suites);
    expect(summary.suites.find((s) => s.suite === 'browser')?.outcome).toBe('stale');
    expect(summary.statements[0].outcome).toBe('stale');
    expect(summary.gate).toBe('failed');
  });
  it('fails a suite whose runner exited non-zero even if every recorded test passed', () => {
    const suites = passing();
    suites.fast.run = run(1);
    expect(summarize(suites).suites.find((s) => s.suite === 'fast')?.outcome).toBe('failed');
    expect(summarize(suites).gate).toBe('failed');
  });
  it('evaluates one suite at a time without claiming statements it cannot prove', () => {
    const suites = passing();
    delete suites.browser;
    delete suites.acceptance;
    const summary = summarize(suites, ['fast']);
    expect(summary.gate).toBe('passed');
    expect(summary.statements.map((s) => s.outcome)).toEqual(['passed', 'not-required']);
    expect(summary.statements[0]).toMatchObject({ passed: 1, required: 1 });
  });
});

describe('mapping contract', () => {
  it('reports stale identities, suite mismatches, duplicates and unmapped tests', () => {
    const broken: Coverage = JSON.parse(JSON.stringify(coverage));
    broken.statements[0].tests.push({ ...broken.statements[0].tests[0] });
    broken.statements[1].tests.push({
      suite: 'fast',
      file: 'tests/e2e/wrong.spec.ts',
      title: 'misfiled',
    });
    const listed = [
      ...coverage.statements[0].tests,
      { suite: 'fast' as const, file: 'tests/spec/save.test.ts', title: 'unmapped helper' },
    ];
    const { errors, stale, unmapped } = validateMapping(broken, ids, listed);
    expect(errors.join('\n')).toMatch(/listed twice/);
    expect(errors.join('\n')).toMatch(/executed by browser, not fast/);
    expect(stale.map((t) => t.title)).toEqual(['finds R1', 'misfiled']);
    expect(unmapped.map((t) => t.title)).toEqual(['unmapped helper']);
  });
  it('requires every SPEC statement in order with at least one test', () => {
    expect(validateMapping(coverage, ['S1', 'S2', 'S3']).errors[0]).toMatch(/every SPEC ID/);
    const empty: Coverage = {
      statements: [{ ...coverage.statements[0], tests: [] }, coverage.statements[1]],
    };
    expect(validateMapping(empty, ids).errors).toContain('S1: map at least one required test.');
  });
  it('accepts the committed registry for the current SPEC', () => {
    const spec = readFileSync('SPEC.md', 'utf8');
    const specIds = [...spec.matchAll(/^### (S\d+)\b/gm)].map((m) => m[1]);
    const registry = JSON.parse(readFileSync('tests/spec/coverage.json', 'utf8'));
    expect(validateMapping(registry, specIds).errors).toEqual([]);
  });
});
