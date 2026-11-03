---
name: new-feature
description: Turn a plain-English feature request into a new SPEC.md statement, a failing test, and the code that makes it pass. Use when a user or the acceptance run asks for a new feature.
---

# New feature, spec first

Work in this order. Do not skip ahead.

0. **Branch.** Create and switch to a new branch
   `feature/S<n>-<short-name>` (S<n> = the next free statement ID: one more
   than the highest `### S<n>` heading in `SPEC.md`) before touching any file.
1. **Restate.** Write the request back as one checkable sentence, in the
   style of the existing statements in `SPEC.md`. If it is ambiguous, ask
   one question and stop.
2. **Spec.** Add it to `SPEC.md` as a `### S<n> — <title>` section, placed
   after the last statement and before `## Executable test coverage`, with
   **Statement:**, **Test:** (how it will be checked) and **Trace:** (where
   the request came from) lines. Add a matching entry for S<n> to
   `tests/spec/coverage.json`, in ID order, listing the test file(s), a
   one-line `scope` and `"remaining": []`.
3. **Failing test.** Add a test whose name starts with `[S<n>]` in the
   `tests/` file for the area you change (for example
   `tests/spec/storage-contracts.test.ts`, `tests/engine/<module>.test.ts`),
   or a new `tests/spec/<short-name>.test.ts`. Run
   `npx vitest run <that file>` (or `npx playwright test <that file>` for a
   test under `tests/e2e/` or `tests/acceptance/`) and show that this new test
   fails on its own assertion, not on a timeout or a setup error. Then run
   `npm run test:fast` and show every old test still passes. If the new test
   passes already, the test is wrong: fix the test, not the code.
4. **Code.** Change the smallest amount of code in `src/` that makes it pass.
5. **Check.** Run `npm run check`, then each part of the full suite on its
   own: `npm run test:fast`, `npm run build` then `npm run test:browser`, and
   `npm run test:acceptance` (`npm test` stops at the first failing part). Any
   failure that also happens on `main` without your change is not yours: name
   it as pre-existing, do not fix it here. Then run the `spec-status` skill, if
   it is in the repo yet.
6. **Commit** on that branch, one commit, message `S<n>: <statement>`. Do not push and do not merge: a
   teammate reviews the pull request.

Never edit or delete an existing test to make the suite pass.
