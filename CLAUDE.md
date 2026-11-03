# Campus Recall (Last 3 Brain Cells)

Local-first PWA: save files and notes, search by meaning on the device, open the exact original. React + Vite + TypeScript, Node 24.

- Run: `npm ci`, then `npm run dev`
- Test: `npm test` (fast: `npm run test:fast`; checks: `npm run check`, `npm run format:check`)
- Run `npm run build` before `npm run test:browser`: the browser tests serve `dist/` as it is.
- Spec: `SPEC.md`, statements S1 to S15. `tests/spec/coverage.json` lists each statement's test files.
- Code: `src/storage` (library), `src/engine` (extraction, models, ranking), `src/app` (services), `src/ui` (screens, styles).
- Tests: `tests/spec`, `tests/storage`, `tests/engine`, `tests/app` (Vitest); `tests/e2e`, `tests/acceptance` (Playwright).
- Never edit an existing test, fixture, model pin or threshold to make the suite pass.
- Commits and PRs are authored by the team member only; no AI co-author lines.
