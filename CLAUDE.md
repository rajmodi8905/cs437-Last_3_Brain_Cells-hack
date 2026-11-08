# Campus Recall (Last 3 Brain Cells)

Local-first PWA: save files and notes, search by meaning on the device, open the exact original. React + Vite + TypeScript, Node 24.

- Fresh-laptop run (Docker): `docker compose up --build --wait`, then http://localhost:4600. Local PostgreSQL/Azurite and development sign-in; no production credentials. Full setup is in README.
- Fresh-laptop test (Docker): `./test.sh`. Runs existing root and pilot suites with real pinned models; reports in `test-evidence/docker/`.
- Frontend development: Node 24, `npm ci`, then `npm run dev` (frontend only).
- Native root tests: `npm test` (fast: `npm run test:fast`; checks: `npm run check`, `npm run format:check`). Additional pilot commands are in README; do not replace root acceptance with a smoke check.
- Run `npm run build` before `npm run test:browser`: the browser tests serve `dist/` as it is.
- Spec: `SPEC.md`, statements S1 to S15. `tests/spec/coverage.json` maps each statement to exact test identities (suite, file, title); add new tests there and run `npm run spec:mapping`. Suite evidence goes to `test-evidence/`; `npm run spec:summary` gives the S1 to S15 result.
- Code: `src/storage` (library), `src/engine` (extraction, models, ranking), `src/app` (services), `src/ui` (screens, styles).
- Tests: `tests/spec`, `tests/storage`, `tests/engine`, `tests/app` (Vitest); `tests/e2e`, `tests/acceptance` (Playwright).
- Never edit an existing test, fixture, model pin or threshold to make the suite pass.
- Commits and PRs are authored by the team member only; no AI co-author lines.
