# Nakshatra: foundation, persistence, and transfer

**Historical implementation handoff.** For the current release phase, use [the release plan](release-plan.md) and [Nakshatra's bug-finding prompt](bug-hunt-nakshatra.md). Nakshatra now finds/reports defects and retests fixes; Raj implements all further changes. Do not restart this old package.

Branch: `Nakshatra_setup`. Start after the planning PR merges into `main`. Follow [the team read order and Git rules](README.md). Do not stage or commit before asking.

## Goal and ownership

Deliver the runnable foundation and real local persistence that Raj can consume without redesigning its interfaces. Own `src/shared/`, `src/storage/`, initial tooling, test scaffolding, and a minimal entry point/unavailable-engine adapter. Preserve the existing interview evidence. Product UI/UX, routing, viewers, styling, PWA integration, and all AI belong to Raj.

Read [the plan](../../IMPLEMENTATION_PLAN.md), [SPEC](../../SPEC.md), [contracts](contracts.md), and [acceptance design](acceptance.md) first. Implement the contract types and exact method signatures; propose incompatibilities before changing them.

## Checkpoint 1: scaffold and tests before features

1. Inspect status and fetch current `main`; preserve all unrelated files. Create/update your branch normally, without reset/clean/force push.
2. Scaffold React, Vite, TypeScript, and Node 24. Install exact dependency versions, create one lockfile, and provide `dev`, `test`, `test:fast`, `build`, and `check` scripts.
3. Use Transformers.js `4.3.1` for the agreed model interface; Raj owns its implementation. Include the agreed PDF/OCR/media/archive dependencies so later packages do not independently replace the lockfile.
4. Create `src/shared/` exports corresponding to contracts.md, shared limits, and small deterministic fixtures. Avoid independent copies of these types in storage/UI/engine.
5. Set up Vitest, React Testing Library, and Playwright plus the shared acceptance harness/coverage registry for the fifteen SPEC IDs. Author the storage/repository cases before their implementations. Raj authors UI/engine scenario bodies before implementing those features. Missing cases/implementations must be reported incomplete and keep full acceptance non-green; do not use `skip`, `todo`, `expect.fail`, or mocks to make acceptance appear green.
6. Keep fast package checks separate from the full acceptance suite, which remains incomplete until later packages merge. CI reports that distinction. Do not change branch protection to hide failures.
7. Build only a minimal bootable entry point using the production unavailable-engine adapter. It must reject with `ENGINE_UNAVAILABLE`, never return fake search matches. Do not create product navigation, visual tokens, styled screens, source viewers, or PWA behavior; Raj owns them.

Document one clean dependency install and the test/browser/model setup prerequisites. App commands listed here are future deliverables, not claims that the current checkout can run them.

## Checkpoint 2: local persistence

1. Implement one Dexie database with versioned stores for items, original Blobs, segments, jobs, previews, and settings. Public consumers use the repository/processing ports rather than opening another database.
2. Implement atomic save of original, item, and job; return success only after commit. Models are not required to save.
3. Compute content hashes, keep original bytes unchanged, derive optional titles, and preserve original filenames/URLs.
4. Implement recent-first list/filter, item/original retrieval, rename, and idempotent deletion exactly as contracted.
5. Implement processing transactions: enqueue/retry, claim, stale-job recovery, guarded segment publication, guarded failure, cancellation, and current-version segment reads.
6. The storage layer performs atomic checks; Raj owns queue scheduling, the origin-wide processing lock, extraction, and inference.
7. Handle quota, serialization, and transaction failures explicitly without false confirmation or loss of existing items.

## Checkpoint 3: archive transfer

Implement the version-1 ZIP manifest and paths in contracts.md with fflate. Export only selected originals and user metadata. Restore fresh IDs and queued state, never embeddings/readiness. Validate all contents and hashes before a transaction; malformed or quota-failing imports must not partially modify existing data.

Deduplicate restored items by hash, kind, and source URL. Identical titles do not imply identical items. Report imported IDs and skipped duplicate IDs for the interface.

## Required tests

Write meaningful failing tests first, then implement and verify:

- Originals and records survive actual IndexedDB reopen, including in a browser test.
- Save resolves after commit; injected write/quota failure yields no successful item.
- Saving before models exist produces a queued item.
- Duplicate titles preserve separate UUIDs and original bytes.
- Rename preserves original/hash/capture time and invalidates old processing claims as required.
- Delete removes all related records; a delayed publication cannot resurrect it.
- Two concurrent claims cannot claim the same job; stale generations/claim IDs cannot publish.
- Valid publication replaces segments and marks Ready atomically.
- Archive round-trip preserves original hashes, metadata, and queued state.
- Existing hashed duplicates are skipped; distinct content sharing a title is retained.
- Invalid version, path, missing original, tampering, and transaction failure leave the previous library unchanged.

Use `fake-indexeddb` only for isolated storage unit tests. Browser persistence and archive acceptance tests must use the real database. Controlled vectors can exercise transaction guards but do not count as retrieval proof.

## Handoff and PR

Provide Raj with the implementation handoff and Chaitanya with factual notes needed for documentation:

- Public repository and processing-port exports, database name/version, and usage examples.
- Repository change-observation hook; progress remains the engine's responsibility.
- Production unavailable-engine adapter plus a test-only fixture adapter.
- Test fixtures, exact commands, actual red/green results, and known limitations.
- README installation instructions and clean-laptop verification evidence available at this stage.

Run package tests, build, and check. Report the full acceptance suite's remaining failures honestly. Prepare a focused PR into `main` after approval; obtain required reviews and merge authorization. Do not include private context files or unrelated research drafts.

Do not implement product UI/UX, routes, viewers, PWA behavior, OCR, model loading, transcription, vector ranking, styles, or policy pages. Do not mark downstream acceptance requirements complete from an adapter fixture.
