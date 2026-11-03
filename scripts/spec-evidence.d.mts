export type Suite = 'fast' | 'browser' | 'acceptance';
export type TestStatus = 'passed' | 'failed' | 'skipped' | 'flaky' | 'not-run';
export interface TestIdentity {
  suite: Suite;
  file: string;
  title: string;
}
export interface TestResult extends TestIdentity {
  status: TestStatus;
  message?: string;
}
export interface NormalizedReport {
  results: TestResult[];
  errors: { file: string | null; message: string }[];
}
export interface Statement {
  id: string;
  scope: string;
  tests: TestIdentity[];
  remaining: string[];
  manualEvidence?: string[];
}
export interface Coverage {
  statements: Statement[];
  [key: string]: unknown;
}
export interface RunRecord {
  suite?: Suite;
  sha?: string;
  exitCode?: number | null;
  signal?: string | null;
  runAttempt?: string;
  startedAt?: string;
  finishedAt?: string;
}
export interface SuiteEvidence {
  run?: RunRecord;
  report?: NormalizedReport;
  problems?: string[];
}
export type StatementTestStatus = TestStatus | 'missing' | 'stale' | 'not-required';
export interface Summary {
  sourceSha: string | null;
  required: Suite[];
  gate: 'passed' | 'failed';
  mappingErrors: string[];
  suites: {
    suite: Suite;
    required: boolean;
    outcome: 'passed' | 'failed' | 'not-run' | 'stale';
    counts?: {
      executed: number;
      passed: number;
      failed: number;
      skipped: number;
      notRun: number;
      flaky: number;
    };
    problems: string[];
    run?: RunRecord;
  }[];
  statements: {
    id: string;
    scope: string;
    outcome:
      | 'passed'
      | 'failed'
      | 'stale'
      | 'missing'
      | 'not-run'
      | 'skipped'
      | 'unmapped'
      | 'not-required';
    passed: number;
    required: number;
    tests: (TestIdentity & { status: StatementTestStatus; message?: string })[];
    manualEvidence: string[];
    remaining: string[];
  }[];
}
export const SUITES: Suite[];
export function testKey(test: TestIdentity): string;
export function suiteForFile(file: string): Suite;
export function normalizeVitest(report: unknown, root: string): NormalizedReport;
export function listVitest(entries: { name: string; file: string }[], root: string): TestIdentity[];
export function normalizePlaywright(report: unknown, suite: Suite, root: string): NormalizedReport;
export function listPlaywright(report: unknown, root: string): TestIdentity[];
export function validateMapping(
  coverage: Coverage,
  specIds: string[],
  listed?: TestIdentity[],
): { errors: string[]; stale: (TestIdentity & { statement: string })[]; unmapped: TestIdentity[] };
export function evaluate(input: {
  coverage: Coverage;
  specIds: string[];
  suites: Partial<Record<Suite, SuiteEvidence>>;
  sourceSha?: string;
  required?: Suite[];
}): Summary;
export function renderMarkdown(summary: Summary, context?: { headSha?: string }): string;
