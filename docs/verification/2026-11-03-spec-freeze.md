# Readiness evidence for the 3 November specification freeze

> Historical execution record. [Current S1–S15 verification](README.md) is complete. Earlier counts, diagnostic failures and checks not performed in this dated round are preserved as evidence, not a current acceptance backlog.

**Execution date:** 2 November 2026, Asia/Kolkata. The filename identifies the planned checkpoint, not a claim that these checks ran on 3 November.

**Status:** This report preserves the initial completed local round. The later [dependency follow-up](2026-11-02-dependency-remediation.md) resolves the findings and completes technical sign-off under Raj's explicit delegation. The original 85-test baseline and initial audit below remain historical evidence. No deployment or human GitHub PR approval is claimed.

## Candidate and provenance

The tested application candidate is reviewed, merged main **`deaf00929b7b7bd0e81a727ec200350995abf69e`**, containing PRs [#24](https://github.com/rajmodi8905/cs437-Last_3_Brain_Cells-hack/pull/24) and [#25](https://github.com/rajmodi8905/cs437-Last_3_Brain_Cells-hack/pull/25). Main and its completed [CI run 41279019226](https://github.com/rajmodi8905/cs437-Last_3_Brain_Cells-hack/actions/runs/41279019226) were reconfirmed on 2 November. The GitHub open-issue list was empty at that check; it is a snapshot, not an assurance that no defects exist.

Raj authorized execution of the [dated plan](../implementation/2026-11-02-spec-freeze-plan.md), excluding deployment. A new detached worktree at the exact candidate SHA began without `node_modules`, `.models`, `.cache` or `dist`. It used a new task-specific npm cache and a newly installed Playwright Chromium. Dependencies, models and runtime files were not copied from the existing project. The repository Git objects and the physical Mac were reused; this is not a new laptop or clean operating system.

Environment: available Apple M4 Mac, macOS 27.0.1 arm64, Node 24.22.1, npm 11.20.0, Playwright 1.64.1 and Chromium 156.0.8078.4. Browser plugin not available; repository Playwright was used. No iOS/WebKit investigation or physical-phone round was repeated.

## Command and startup results

Fresh install, Chromium installation and direct-after-install `npm run models:download` completed successfully. Setup downloaded and verified the pinned public assets without an API key. The generated manifest contains 50 assets totaling approximately 445.2 MB.

The README startup flow was exercised using `npm run dev`: root landing page, Open library, onboarding dismissal, Note, Save locally, reload and exact saved original. It worked before model setup. Desktop 1440×900 and phone-sized 390×900 screenshots were inspected: meaningful content, correct title, no overlay or horizontal overflow. No page/console errors were recorded in the successful smoke run.

The first supplementary smoke attempt timed out taking a screenshot; a later attempt used an over-specific temporary Title locator and timed out. Both failures are preserved in the external evidence. Disabling screenshot animations and using the existing Title accessible-name match allowed the same flow to complete. Neither attempt changed application source or its acceptance expectations.

The root production smoke also passed note saving/reopening before models, then direct Privacy/Terms reload and saved-original reopening with the browser offline. Its temporary server was stopped. The repository-subdirectory production smoke repeated the same flow successfully, including offline policy/original reopening. All verification servers started by this round were stopped.

## Completed local checks and artifacts

| Check | Actual result on 2 November |
| --- | --- |
| Fresh `npm ci`, Chromium install, model download | Passed; new caches, pinned external hashes verified |
| `npm run check` | Passed; TypeScript, ESLint, product restrictions and registry structure |
| `npm run format:check` | Passed |
| `npm run build` and `npm run release:check` | Passed for root output |
| `npm test`: fast | 85 passed across 19 files; 10.20 seconds |
| `npm test`: production Chromium | 27 passed; 43.8 seconds, no failures/skips |
| `npm test`: actual models | 11 passed; 6.7 minutes, no failures/skips |
| Repository-subdirectory build and artifact check | Passed under `/cs437-Last_3_Brain_Cells-hack/` |
| Desktop/phone-sized startup and production smoke | Passed at 1440×900 and 390×900; correct identity, meaningful content, no framework overlay, no horizontal overflow or page/console errors |
| Offline production smoke | Root and subdirectory: direct Privacy/Terms reload and saved original reopening before model setup passed |
| Frozen retrieval inputs | All nine expected hashes match |
| Candidate source integrity | All 142 recorded source/test/tooling inputs unchanged; detached checkout tracked tree clean |

Each S9/S10/S11 run independently processed all 30 originals without processing failures using the real WASM backend. All twelve targets ranked first across those three runs; each run's three negatives returned zero matches. This is consumed-corpus regression evidence. The original [R4 failure](retrieval-first-evaluation.json) and its later correction remain documented in [retrieval notes](retrieval.md).

The artifact checker verifies manifest/runtime integrity, install metadata and HTML/service-worker paths, and rejects unexpected files, QA harnesses, certificates, downloaded model weights and symlinks. Both preserved artifacts contain 43 files; the largest file is `runtime/ffmpeg/ffmpeg-core.wasm` at 32,232,419 bytes.

| Artifact base | Total bytes | Inventory SHA-256 |
| --- | --- | --- |
| `/` | 110,125,013 | `d604a57dab335b8812f8c023245b55f40b1804b56eb34b6113f8629caceb1f62` |
| `/cs437-Last_3_Brain_Cells-hack/` | 110,125,493 | `317059d0e4daf2233ea41ce605f31193b55f8e4c12774f8f30012059bc30b0e7` |

Both asset-manifest SHA-256 values are `b1105d0d38961eefda12c2310c141c026eda01f092c325bf73bdfa313c9c27e9`. These identities hash sorted file inventories, not a ZIP container. Raw command logs, screenshots, full inventories, artifacts and source fingerprints are retained outside public source in the local readiness evidence folder. The sanitized [machine-readable summary](2026-11-02-readiness-summary.json) records candidate, results, bounds and unresolved gates without private phone identifiers or local paths.

## S1–S15 evidence map

Every row refers to candidate `deaf00929b7b7bd0e81a727ec200350995abf69e`. The [coverage registry](../../tests/spec/coverage.json) supplies the complete test-file mapping. Registry validation checks structure, not behavior. All mapped automated suites passed in this completed round. Physical reports and remaining review gates remain separate from those automated outcomes.

| Requirement | Automated outcome | Executable tests and assertion scope | Manual evidence, limitations and gates |
| --- | --- | --- | --- |
| S1 — Durable local save | Passed | [Storage contracts](../../tests/spec/storage-contracts.test.ts), [integration](../../tests/storage/integration.test.ts), [browser library](../../tests/e2e/library.spec.ts): original retention, rollback and real reload | Fresh README note flow passed before models. Android owner confirmed note and PDF saves/reopen before setup. Browser eviction/crash durability is not guaranteed. |
| S2 — Browse/filter/rename | Passed | Storage contracts and browser library: combined filters, ordering, metadata/byte identity, rename and duplicate titles | Desktop automation supplies behavioral evidence. No blanket physical-device usability conclusion. |
| S3 — Delete without resurrection | Passed | Storage contracts/integration and browser deletion: related records, stale claims and late publication | Deletion applies to this library, not earlier exports, other devices or OS backups. |
| S4 — Capture/fallback | Passed | [Capture tests](../../tests/engine/capture.test.ts), browser library and [reported-defect regressions](../../tests/e2e/chaitanya-fixes.spec.ts): omitted credentials, inert content, truncation, PDF fallback and errors | Public sites may block direct capture. Fallback remains required; no proxy or account integration. |
| S5 — Exact original/location | Passed | Browser library, [offline acceptance](../../tests/acceptance/offline.spec.ts), [retrieval](../../tests/acceptance/retrieval.spec.ts): item identity, missing source, PDF page, media interval | Android owner confirmed PDF page 2 and media Play/two seeks/reopen near the match; earlier iPhone checks retain their own build identity. |
| S6 — Manual transfer | Passed | Storage contracts, [repository](../../tests/storage/repository.test.ts), independent-profile browser export/restore: original hashes/metadata, queued state, invalid archives and duplicate matching | Automated profiles are distinct from a physical transfer. The owner-reported phone ZIP could not be located by scoped ADB checks; phone-to-Mac restore remains unverified. |
| S7 — Model setup/offline readiness | Passed | [Assets](../../tests/engine/assets.test.ts), offline acceptance and retrieval: integrity/progress, verified cache, missing-model repair | Clean checkout downloaded and verified assets; Android owner confirmed Assets verified. Physical setup interruption was not independently timed/captured in this round. |
| S8 — Local OCR/PDF | Passed | [Extraction](../../tests/acceptance/extraction.spec.ts), retrieval: actual OCR/text and scanned PDFs, correct pages, original retained on failures | Android owner explicitly observed all five agreed small fixtures under 120 seconds each. No individual times or independent stopwatch capture. Earlier measured iPhone results remain dated evidence. |
| S9 — Semantic retrieval/rejection | Passed | [Ranking](../../tests/engine/ranking.test.ts), retrieval, [note regression](../../tests/acceptance/note-regression.spec.ts): frozen corpus/negatives, grouping, thresholds and provenance | Android owner confirmed paraphrased note and PDF retrieval plus a negative query. Corpus is consumed regression data; preserve the original R4 miss. No general accuracy estimate. |
| S10 — Visual image/video | Passed | Retrieval: fresh 30-item S10 library, text-free images and sampled silent-video scene | Android owner confirmed visual queries and exact originals. Only sampled scenes are covered. |
| S11 — Speech/timestamps | Passed | Extraction and retrieval: actual supported media decoding/English transcription, silence and annotated intervals | Android owner confirmed audio/video matches and playback/seek/reopen. English baseline and short synthetic fixtures limit the claim. |
| S12 — Recovery/retry | Passed | Integration, [worker client](../../tests/engine/model-client.test.ts), [recovery acceptance](../../tests/acceptance/recovery.spec.ts): actual interrupted indexing, retry, generation/worker failures | Desktop automated interruption is not every physical suspension or memory-pressure event. No new physical test claimed. |
| S13 — Responsive/offline PWA | Passed | [Accessibility](../../tests/e2e/accessibility.spec.ts), library, offline acceptance, reported-defect and [update](../../tests/e2e/release-update.spec.ts) tests: responsive routes, focus, reduced motion, cache/update/original retention | Installed iPhone owner checks are earlier-build evidence. Android owner confirmed standalone installation, Files picker, keyboard, rotation, zoom, essential controls and offline fresh processing. No final-main iOS rerun or universal compatibility. |
| S14 — Local core processing | Passed | Offline acceptance and [network guard](../../tests/acceptance/helpers.ts): actual modalities, cache-only inference and unexpected-external-request rejection | Android USB route removed before owner disabled Wi-Fi/mobile data and reported offline passes. Phone toggles were owner-controlled, not independently captured. Not a security certification. |
| S15 — Truthful accessible policy | Passed | Accessibility, [axe](../../tests/e2e/axe.spec.ts), library and first-use tests: direct/pre-setup/offline routes and readable headings | [Source fact review and named checklist](2026-11-02-policy-review.md) prepared. Owner-delegated Codex factual sign-off is now complete; named teammate approvals are not claimed. Hosting undecided; host-specific review is deferred, not silently passed. |

## Physical evidence and assumptions

The iQOO Neo9 Pro / I2304 session used Android 16 and Chrome 156.0.8078.49 on the `deaf009`-based local QA snapshot. Phone setup, retrieval, media, installed controls and offline outcomes are owner reports. The USB route was independently removed before the offline round. No private phone library was examined; synthetic fixtures were used. The owner reported an exported ZIP in Downloads, but a scoped file check did not find it, so no archive was pulled or restored.

The iPhone 17 / iOS 27.0.1 evidence remains in the [28 October measured report](2026-10-28-device-preparation.md) and [29 October installed-app follow-up](2026-10-29-release-preparation.md#physical-installed-iphone-app-owner-confirmed-checks). It is not relabeled as a fresh test of the final main/UI. Raj's instruction to assume phone tests passed allows planning to continue; it does not create missing measurements or a ZIP-restore result. No phone retest is requested by this plan.

## Dependency audit

The fresh install's full `npm audit` reports **20 affected dependency entries: 18 moderate, 2 low, no high/critical**. A separate `npm audit --omit=dev` reports **zero**. The affected entries are in development/build dependency chains; this does not prove every build-time use is harmless.

The underlying advisory entries concern [deepmerge prototype poisoning](https://github.com/advisories/GHSA-gcqx-w48m-w2h4), [glob cancellation](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4), and [minimatch pattern amplification](https://github.com/advisories/GHSA-g3hv-75wg-m249). Full and production-only audit JSON are retained with the local evidence. The older zero-finding audit remains a historical snapshot. No force-fix, cross-major tooling replacement or lockfile change was applied to this pinned candidate. These initial findings were subsequently remediated in the [dependency follow-up](2026-11-02-dependency-remediation.md), with zero audit findings and explicit reviewed local-fork provenance. This initial audit result is retained as the before state.

## Review and freeze decision

The application candidate passes the planned fresh-checkout automated and local artifact checks. No application fix, dependency change, model change or acceptance change was needed. The documentation and coverage metadata now point to current evidence; dated historical outcomes remain intact.

**Recommendation:** the baseline was technically verified for review; the later dependency candidate is now signed off for local technical readiness after remediation, independent subagent review and Raj-delegated policy fact review. Required human GitHub PR reviews remain separate. The physical ZIP restore remains unverified and is not inferred from automated transfer coverage. Do not claim all fifteen statements are fully signed off from passing automation alone. Hosting and hosted checks are separately deferred by instruction.

**Reproduction/rollback reference:** `deaf00929b7b7bd0e81a727ec200350995abf69e`, its pinned lockfile and the two preserved artifact inventories/hashes below. No earlier hosted release exists in this evidence, so this is a reproducible local reference, not a tested production rollback. Any later rollback uses a reviewed revert/build and separately authorized publication; do not clear user storage or force-push main.

Hosting selection, deployment, release-workflow dispatch and hosted validation remain outside this task. Required human PR reviews and merge authorization remain in force. No files from this execution have been staged, committed or pushed.
