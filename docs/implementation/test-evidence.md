# Test evidence and the S1–S15 gate

CI already runs every suite. This page describes how the results are kept and how S1–S15 outcomes are decided from them.

## Suites and CI jobs

| Suite | npm script | CI job (check name) | Needs models |
| --- | --- | --- | --- |
| fast | `npm run test:fast` | Static and fast checks (also audit, `check`, `format:check`, `spec:mapping`) | No |
| browser | `npm run test:browser` | Production browser tests (also `build`, `release:check`) | No |
| acceptance | `npm run test:acceptance` | Actual-model acceptance (cached pinned models) | Yes |

The `checks` job keeps the previous check name. It runs after the three suite jobs, even when one of them failed, and passes only when all three succeeded and the S1–S15 gate passes. The repository ruleset does not currently require named status checks; the name is kept for compatibility.

## Evidence layout

`scripts/run-suite.mjs` runs each suite into `test-evidence/<suite>/` (or `$CR_EVIDENCE_DIR/<suite>/`):

| File | Content |
| --- | --- |
| `run.json` | Suite, tested commit, whether the checkout had uncommitted changes, command, CI run and attempt, start/finish time, exit code and signal |
| `results.json` | The runner's own JSON report (Vitest or Playwright) |
| `html/` | Playwright HTML report (browser and acceptance only) |
| `artifacts/` | Playwright failure screenshots and traces |
| `test-results/` | Files the suite wrote to `test-results/` during this run, such as axe findings, route screenshots and retrieval/calibration reports |

If `test-evidence/<suite>/` already exists, it is moved to `test-evidence/history/<suite>-<start time>/` first. In CI every suite job uploads its evidence with `if: always()` as `evidence-<suite>-attempt-<n>` (14 days), so a failed or re-run job never replaces earlier evidence. Running Playwright directly, without the npm scripts, keeps the old default `test-results/` and `playwright-report/` locations.

## Mapping contract

`tests/spec/coverage.json` (schema 2) lists, for each statement, the required tests as `{ suite, file, title }`. The title is the runner's full title, with describe blocks joined by ` > `. Tests may support several statements. Tests not mapped to any statement still run and still decide their suite's result.

- `npm run check` validates the structure: every SPEC statement in order, at least one test each, a suite matching the file location, no duplicates and existing files.
- `npm run spec:mapping` lists the tests both runners would execute and fails on any mapped identity that no longer exists. It also reports how many tests are unmapped.

When a test is renamed or moved, update its entry in the registry; `spec:mapping` and the summary will otherwise report it.

## Outcomes

`npm run spec:summary` reads the evidence and writes `spec-summary.json` and `spec-summary.md` (and the GitHub job summary). Counts come from the reports; nothing is hard-coded.

For each mapped test:

| Status | Meaning |
| --- | --- |
| passed | Executed and passed (a flaky pass on retry is shown as flaky and counts as passed) |
| failed | Executed and failed |
| skipped | Deliberately skipped |
| not-run | Its suite has no results, or Playwright recorded the test without executing it (for example an interrupted run) |
| missing | Its suite ran, but this test has no result: a renamed or removed test, or a filtered run |
| stale | The suite evidence is for another commit, or was recorded with uncommitted changes |

A statement passes only when every required mapped test passed. Any other status fails the statement and the gate. A suite fails when its runner exited non-zero, when it reported a load/setup error (for example a web server that never started) or when any test failed, including unmapped tests. Every failing test is listed.

`--only <suite>` evaluates one suite's mapped tests and marks statements without tests in that suite as `not-required`; the suite jobs use it with `--report-only` for their own job summaries. Without `--only`, all three suites are required.

Manual and physical-device evidence recorded in the registry (`manualEvidence`, `evidenceNotes`) is listed separately and is not part of the automated gate.

## Local use

```bash
npm test                 # fast, browser and acceptance, each into test-evidence/<suite>/
npm run spec:summary     # S1-S15 table; exits non-zero unless the gate passes
```

Commit before relying on a local summary: evidence recorded with uncommitted changes is reported as stale. On Windows, use a temporary directory with a long path (`TMP`/`TEMP`) for the device-session tooling tests; `tests/tooling/dependencies.test.ts` currently has a known Windows-only path-separator failure that does not occur on Linux CI.
