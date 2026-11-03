---
name: spec-status
description: Report which SPEC.md statements (S1-S15) are green, red, or untested in Campus Recall. Use when someone asks "where are we", "what is left", "is the spec green", or before opening a pull request.
---

# Spec status

1. Read `SPEC.md`. Every statement is a heading `### S<n> — <title>`.
2. Find the tests for each statement. In this repo `tests/spec/coverage.json`
   lists the test files for every statement ID. Inside those files a test whose
   title starts with `[S<n>]` or `S<n>:` (for example `[S6] exported originals
   restore ...` or `S9: fresh 30-item corpus ...`) belongs to that statement
   only; an untagged test counts for every statement that lists its file.
3. Run every suite once, from the repo root, even if an earlier one fails
   (`npm test` stops at the first failing suite, so do not use it here):

   ```bash
   mkdir -p .cache/spec-status
   npm run build
   npx vitest run --reporter=json --outputFile=.cache/spec-status/vitest.json
   PLAYWRIGHT_JSON_OUTPUT_NAME=.cache/spec-status/playwright.json npx playwright test --reporter=json
   ```

   The build makes `dist/`, which the Playwright preview server needs (CI
   builds first too). The acceptance suite (`tests/acceptance/`) needs the pinned models in
   `.models/`. If that folder is missing, do not download them on your own: run
   `npx playwright test tests/e2e` instead of the full Playwright line, and say
   in step 5 that acceptance was not run (`npm run models:download`, about
   360 MB, fixes it). Run the Playwright line in the background: it takes
   about 15 minutes with acceptance.
4. Build the table with `node .claude/skills/spec-status/report.mjs` and print
   it exactly, nothing before it:

   | ID | Statement | Tests | Result |
   |----|-----------|-------|--------|

   Result is **green** (all its tests pass and every listed file ran),
   **red** (any test fails; shows the first failure), **not run** (a listed
   file did not run, e.g. acceptance without models), or **no test**.
5. Under the table, at most three lines: the count of green / red / not run /
   no test, any failing test that belongs to no statement (the script prints
   it), and the one statement to work on next (the first red, else the first
   untested, else the first not run).

Do not edit any file except the reports in `.cache/spec-status/`. Do not fix
anything. This skill only reports.
