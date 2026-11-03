---
name: spec-status
description: Report which SPEC.md statements (S1-S15) are green, red, or untested in Campus Recall. Use when someone asks "where are we", "what is left", "is the spec green", or before opening a pull request.
---

# Spec status

1. Read `SPEC.md`. Every statement is a heading `### S<n> — <title>`.
2. Find the tests for each statement. In this repo `tests/spec/coverage.json`
   lists, for every statement ID, the exact tests that prove it, each as
   `{ suite, file, title }` (suite is `fast`, `browser` or `acceptance`).
   Run `npm run spec:mapping` to confirm every listed test still exists.
   Do not guess a test's statement from its file or its title.
3. Run each suite once, from the repo root, even if an earlier one fails
   (`npm test` stops at the first failing suite, so do not use it here):

   ```bash
   npm run test:fast
   npm run build
   npm run test:browser
   npm run test:acceptance
   ```

   Each run writes its evidence to `test-evidence/<suite>/`. The build makes
   `dist/`, which the browser suite's preview server needs. Run the browser
   and acceptance lines in the background: together they take about 25
   minutes.
   - **Models:** acceptance needs the pinned models in `.models/`. If that
     folder is missing, do not download them on your own: skip that line and
     say in step 5 that acceptance was not run (`npm run models:download`,
     about 360 MB, fixes it).
   - **Uncommitted changes:** evidence recorded from a checkout with
     uncommitted changes is reported as stale. If `git status --porcelain`
     prints anything, say so before running; do not commit on the user's
     behalf.
   - **Windows:** if the repo is not on the same drive as `%TEMP%` (for
     example the repo on `D:` and `%TEMP%` on `C:`), run `test:fast` with
     `TMP` and `TEMP` set to a folder on the repo's drive. Otherwise
     `scripts/device-session.mjs` rejects the test's temporary folder and the
     8 device-session tests do not run.
4. Run `npm run spec:summary -- --report-only`. It decides every outcome from
   the evidence and writes `test-evidence/spec-summary.json`. From that file,
   print one table, nothing before it:

   | ID | Statement | Tests | Result |
   |----|-----------|-------|--------|

   Statement is the title from `SPEC.md`. Tests is `<passed>/<required>
   mapped tests`. Result comes from the statement's `outcome`:
   **green** (`passed`), **red** (`failed`; give the first failing test's
   title), **not run** (`not-run`, `missing`, `stale` or `skipped`; say which),
   or **no test** (`unmapped`).
5. Under the table, at most three lines: the count of green / red / not run /
   no test; any suite that failed and its failing tests that belong to no
   statement (the summary's "Problems" list); and the one statement to work
   on next (the first red, else the first untested, else the first not run).

Do not edit any tracked file. Do not fix anything. This skill only reports.
