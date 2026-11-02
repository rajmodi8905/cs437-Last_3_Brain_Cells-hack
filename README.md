# Campus Recall

A free, local personal library for screenshots, PDFs, notes, webpages and short recordings. Save an original, describe what you remember, and open the matching file, PDF page or media interval. There are no accounts, cloud inference calls, generated answers or API keys.

Built by Raj Modi, Chaitanya and Nakshatra for CS437 at IIT Gandhinagar. A student project, not an official IITGN service. Interview evidence and testable requirements are in [SPEC.md](SPEC.md).

For reviewers: [run locally](#run-locally) with `npm run dev` after installation; [run the full suite](#test) with `npm test` after its one-time browser/model/build setup. See [the specification](SPEC.md), [S1–S15 evidence](docs/verification/2026-11-03-spec-freeze.md), [latest dependency validation](docs/verification/2026-11-02-dependency-remediation.md) and [AI-use notes](docs/ai-use.md).

## Course check-in: 3 November 2026

Checked against the current [hackathon rules and dates](https://anup.github.io/courses/cs437-2026-27-sem1/hackathon/), [Class 15 user/specification instructions](https://anup.github.io/courses/cs437-2026-27-sem1/classes/class-15/) and [Class 19 deployment/usability instructions](https://anup.github.io/courses/cs437-2026-27-sem1/classes/class-19/).

- **Deployed link:** none yet. Hosting is undecided and deployment remains excluded from the current work. Host selection, authorization and hosted verification are pending; local previews are not deployed services.
- **Outside-group usage:** no verified user count is recorded. The Suhani/Bhavya interviews establish the problem; they are not evidence that those people used the finished app. Record actual users, count, date and observed feedback when a real usage round occurs. Class 19 prioritizes deployed usability, so passing local tests does not complete that requirement.
- **Member work merged since 26 October:** Raj's [PR #25](https://github.com/rajmodi8905/cs437-Last_3_Brain_Cells-hack/pull/25) (1 November), Chaitanya's [PR #19](https://github.com/rajmodi8905/cs437-Last_3_Brain_Cells-hack/pull/19) (29 October) and Nakshatra's [PR #24](https://github.com/rajmodi8905/cs437-Last_3_Brain_Cells-hack/pull/24) (31 October). Authored, merged PRs count for participation; merging another member's PR does not replace that requirement.
- **Repository process:** both instructors, Anup and Arjun, are collaborators. The active `main` ruleset requires a PR and two approving reviews, and blocks deletion/force pushes. These settings were checked on 3 November; no protection was bypassed. New features require a checkable specification and automated tests before implementation, followed by trying the real user flow.
- **AI records:** each member must record the tool, work performed and part they built in `lab-notes/class-NN.md` in their own course repository. This project's [AI-use summary](docs/ai-use.md) supplies context and does not replace those personal records; their completion is not asserted here.

| Course checkpoint | Current evidence or next action |
| --- | --- |
| 3 November: every statement green, specification frozen | All S1–S15 mapped automated checks pass on the documented local candidate; physical evidence and limits are recorded separately. This follow-up still needs its reviewed PR merged. No new frozen `main` reference or course approval is claimed. |
| 2–10 November: review another group's PRs and fix findings | Keep actual cross-group review links and follow-up tests. No completed cross-group review is recorded here; internal teammate reviews are separate. |
| 16 November: unseen acceptance feature | Add the external request to `SPEC.md`, write its tests, implement it and use the suite to decide acceptance. No unseen request or result is invented in advance. |
| 17 November: demo | Demonstrate the real user workflow and the accepted change. Deployment and outside-user evidence remain separate open course work. |

The [October milestone audit](docs/verification/milestones-2026-10.md) retains the earlier missed/on-time distinctions. Later completion does not change those dates.

## Current status: 3 November 2026

The UI revamp, Chaitanya's reported-defect fixes, Nakshatra's restore/OCR fixes, and Raj's landing accessibility and device/release tooling are merged into `main`. The verified code baseline is `deaf00929b7b7bd0e81a727ec200350995abf69e`, the merge of [PR #25](https://github.com/rajmodi8905/cs437-Last_3_Brain_Cells-hack/pull/25), following [PR #24](https://github.com/rajmodi8905/cs437-Last_3_Brain_Cells-hack/pull/24).

The latest local [dependency follow-up](docs/verification/2026-11-02-dependency-remediation.md) fixes the three underlying advisories and passes **90 fast tests, 27 browser tests and 11 actual-model tests**, with zero findings in both full and production-only audits. Its tested input fingerprint is recorded in the [dependency summary](docs/verification/2026-11-02-dependency-summary.json); both application artifacts are identical to the earlier builds. Independent subagent review and owner-delegated technical/policy sign-off are complete. These local results are separate from main CI and the earlier baseline below.

[Main CI run 41279019226](https://github.com/rajmodi8905/cs437-Last_3_Brain_Cells-hack/actions/runs/41279019226) completed successfully on **1 November** at that exact commit. A separate **2 November fresh-checkout round** used Node 24, a new npm cache, a new Chromium installation and freshly downloaded pinned model assets. Its results are in the [3 November checkpoint report](docs/verification/2026-11-03-spec-freeze.md), with the actual execution date recorded as 2 November:

| Automated check | Fresh-checkout result, 2 November |
| --- | --- |
| TypeScript, ESLint, product restrictions and coverage-registry structure | Passed |
| Formatting | Passed |
| Fast tests | 85 passed across 19 files |
| Production Chromium browser tests | 27 passed |
| Actual-model acceptance tests | 11 passed |
| Root and repository-subdirectory builds/artifact validation | Passed; both artifacts preserved with hashes |
| README startup and root/subdirectory offline smoke | Passed; note save/reload/original and direct policy routes before models |

This round completed all three suites without failures/skips. Actual-model tests use pinned real models and synthetic fixtures; all twelve retrieval targets ranked first across separate S9/S10/S11 libraries, with no negative-query matches. The fixed retrieval corpus is consumed regression data, not a general accuracy estimate. Structural coverage of all fifteen statements alone does not establish final release readiness. The [sanitized summary](docs/verification/2026-11-02-readiness-summary.json) records the candidate and artifact identities.

### Physical-device evidence

| Device | Evidence and scope |
| --- | --- |
| iPhone 17, iOS 27.0.1 | Earlier measured Safari processing/original/offline checks and owner-confirmed installation, playback, seeking, keyboard, rotation and zoom. See the [measured session](docs/verification/2026-10-28-device-preparation.md) and [installed-app follow-up](docs/verification/2026-10-29-release-preparation.md#physical-installed-iphone-app-owner-confirmed-checks). These retain their earlier build identities; no final-main iOS rerun is claimed. |
| iQOO Neo9 Pro / I2304, Android 16, Chrome 156.0.8078.49 | Owner-confirmed saving before setup, verified-asset setup, note/PDF retrieval, matching PDF page, negative-query rejection, image/media retrieval, playback/seeking, installed-app controls and offline reopening/fresh processing on the 2 November main-based snapshot. All five agreed small image/PDF fixtures were reported under 120 seconds each; individual times were not recorded. |

The Android offline round followed removal of the USB network route; the owner disabled Wi-Fi/mobile data and reported the installed-app and ordinary-Chrome checks successful. These physical interaction results are owner reports, not automated DOM captures or a blanket compatibility claim. The physical phone-to-Mac ZIP restore remains **unverified**, distinct from passing automated independent-profile transfer tests.

Raj authorized the dated [readiness plan](docs/implementation/2026-11-02-spec-freeze-plan.md), excluding deployment, then delegated technical sign-off. Local verification, dependency remediation and [delegated policy fact review](docs/verification/2026-11-02-policy-review.md) are complete. The local deepmerge fork is explicitly documented; audit has no published advisory for that private package, so its source review and exploit regressions supply the patch evidence. No named teammate approval or human GitHub review is invented. Hosting remains undecided; publication and hosted checks remain separate.

## Run locally

Use Node 24 and npm. The lockfile pins dependencies. Start from a fresh clone:

```bash
git clone https://github.com/rajmodi8905/cs437-Last_3_Brain_Cells-hack.git
cd cs437-Last_3_Brain_Cells-hack
node --version  # v24.x
```

If using nvm, `nvm install` followed by `nvm use` reads the pinned `.nvmrc`. Then install and run:

```bash
npm ci
npm run dev
```

Open the localhost URL printed by Vite. Save files immediately, even before model setup. In Settings, choose **Download offline search**. The app displays the manifest's actual size and progress, verifies SHA-256 hashes, and then processes queued items. Keep the app open while processing. Completed downloads are reused after interruption; an incomplete current asset downloads again.

Initial setup needs about 445 MB plus application files. Allow additional browser storage for originals, extracted data and inference memory. No model weights are checked into Git. `predev` and `prebuild` copy local runtimes from installed packages and generate the asset manifest. Pinned public model metadata is in `scripts/model-assets.json`.

## Build and preview the PWA

```bash
npm run build
npm run preview
```

For artifact validation, the prepared manual release workflow, hosting facts and rollback steps, see [deployment preparation](docs/implementation/deployment.md). No publication is performed automatically.

The static output is `dist/`. Serve it over HTTPS for installation and secure browser capabilities. Localhost works for desktop development; an ordinary HTTP LAN address is insufficient for phone PWA/WebGPU testing. No deployment is performed by these commands.

For a subdirectory deployment, set the complete base path at build time:

```bash
APP_BASE=/campus-recall/ npm run build
```

Routes use hashes, such as `#/library`, `#/settings`, `#/privacy` and `#/terms`. Install using Chrome's app menu, or Safari's Share menu and Add to Home Screen. Cache the production app by opening it online once, finish model setup, then test an offline reopen. Updates show a reload notification; finish processing and back up first.

## Supported inputs

| Type | Limit | Indexed content |
| --- | --- | --- |
| JPEG / PNG / WebP | 20 MB | OCR text and visual embedding |
| Unencrypted PDF | 20 MB, 50 pages | Page text or scanned-page OCR |
| Note | 20,000 Unicode characters | Saved text |
| Public webpage | 20,000 extracted characters | Captured or pasted plain text |
| MP3 / WAV / M4A | 50 MB, five minutes | English speech with timestamps |
| H.264 MP4, optional AAC | 100 MB, two minutes | English speech and a visual frame every five seconds |

Convert HEIC, HEVC and MOV before importing. A failed extraction preserves the original and exposes Retry. A blocked webpage capture offers pasted text or inert HTML/PDF import; there is no proxy. No-result search does not mean the item was never saved. Video search cannot cover every brief frame. Results are sources and extracted excerpts, not generated factual answers or confidence percentages.

## Storage and privacy

Each browser/device has its own IndexedDB library and model cache. Core inference and search use cached assets and local similarity calculations. Explicit setup, webpage capture and opening external links require ordinary network requests. There is no analytics or advertising.

Browser persistence is best-effort. Clearing site data, browser eviction or device failure can remove the library. Export a manual ZIP in Settings, or export an individual source from its viewer. ZIPs contain originals, metadata and hashes, without embeddings or models; they are **unencrypted**. Restore validates before writing, identifies content duplicates and queues fresh items. Import is limited to a 250 MB ZIP, 500 MB unpacked and 500 items; export smaller selections for larger libraries.

The app does not claim encryption at rest or control over browser/OS backups. Read the rendered [Privacy Policy](docs/product/privacy-policy.md) and [Terms](docs/product/terms-and-conditions.md), and review [third-party licenses](THIRD_PARTY_NOTICES.md).

## Test

Fast tests use actual storage logic, controlled vector arithmetic and inert HTML extraction. Full acceptance tests use the real pinned models, OCR, PDF and media runtimes. Missing model assets fail setup explicitly.

```bash
npm audit --audit-level=low
npm run check
npm run format:check
npx playwright install chromium
npm run models:download
npm run build
npm test
npm run release:check
```

On Linux, install browser system dependencies with `npx playwright install --with-deps chromium` instead of the browser-only install command.

`npm run models:download` first generates its manifest/runtime files, so it also works directly after a fresh `npm ci` without a previous dev server or build. It then verifies public assets into ignored `.models/` for reproducible testing. A localhost test-only server streams those checksum-addressed public files; it is not part of the app and receives no library data. Full tests redirect only setup downloads to this mirror, then reject unexpected external requests.

```bash
npm run test:browser       # production UI, responsive layouts and offline shell
npm run test:acceptance    # actual extraction and retrieval
npx playwright install webkit
npm run test:webkit        # additional WebKit UI and real local-model checks
```

Playwright WebKit provides additional desktop engine coverage. Its version is reported by the installed browser package; it does not establish compatibility with a particular physical iOS/Safari version.

The optional WebKit suite has a documented native GPU/worker teardown crash in the pinned development engine. See the [failure and shipping-Safari comparison](docs/verification/2026-10-29-release-preparation.md). It is separate from the default Chromium suite above; no new WebKit investigation was included in this readiness round.

The Browser plugin is unavailable in the current environment, so browser verification uses Playwright. Reports and screenshots go to ignored `test-results/` and `playwright-report/`. All campus announcements in fixtures are synthetic. See [acceptance design](docs/implementation/acceptance.md) and [verification evidence](docs/verification/README.md) for measured outcomes and remaining physical-device checks. A successful build is not evidence that every requirement or phone has passed.

Fixture regeneration needs macOS `say`, local ffmpeg and npm dependencies:

```bash
node scripts/create-fixtures.mjs
```

## Statement coverage and milestone evidence

All fifteen statements map to actual test suites in [the coverage registry](tests/spec/coverage.json). `npm run check` validates that mapping; `npm test` executes the behavior. Registry completeness alone is not a test pass. The current local, CI and device summaries are above; [the checkpoint report](docs/verification/2026-11-03-spec-freeze.md) records the scope of completed technical review. See [the October milestone audit](docs/verification/milestones-2026-10.md) for historical checkpoint evidence and late earlier milestones. Older reports retain their original dates and builds rather than representing current status.

## Bug-finding handoff

Follow [Nakshatra's quickstart](docs/implementation/nakshatra-quickstart.md) to prepare a production preview, an importable synthetic 30-item library, exact-source expectations, malformed inputs and an empty run ledger. `npm run qa:prepare` writes only to a new ignored `.cache/qa-kit/` directory and never overwrites an earlier run. No model download is needed to prepare the kit. Optional `npm run qa:https` uses user-supplied local certificate files for a phone session; it does not deploy a site or configure device trust. The quickstart links both testers' prompts and the GitHub bug-report form.

[Chaitanya's quickstart](docs/implementation/chaitanya-quickstart.md) adds UI boundary/source-content fixtures, a C1–C15 run ledger and `npm run qa:webpages` for deterministic desktop capture/truncation/blocked-fetch tests. The helper is loopback-only, synthetic and separate from the deployed application.

For the physical-phone session, follow [device preparation](docs/implementation/device-session.md). `qa:device:prepare` builds an isolated identified snapshot and public synthetic downloads under ignored `.cache/`; `qa:device:serve` verifies it before serving local HTTPS. Temporary certificate trust and physical tests require device-owner action and are never performed automatically.

The [Android validation runbook](docs/implementation/android-validation.md) covers Chrome and installed-app setup, fixture timings, exact originals, offline operation and manual transfer. The 2 November owner-reported results are summarized above; preparation commands alone establish no phone pass. When a USB development route is used, remove it as well as disabling phone networking before testing offline behavior.

## Architecture

- `src/shared/`: published contracts and limits from Nakshatra.
- `src/storage/`: Dexie originals, metadata, atomic queue claims and ZIP transfer.
- `src/engine/`: extraction, asset integrity, local worker inference and ranking.
- `src/app/`: injected application services, headless React controller, worker bridge and fallback lifecycle.
- `src/ui/`: replaceable shell, screens, rows, dialogs, exact-source viewers and policy pages; theme and feature styles are separate.
- `src/sw.ts`: app-shell precache and explicit-setup runtime cache.

The views receive service contracts instead of accessing database tables or model implementations. See [architecture and frontend replacement](docs/architecture.md) for module boundaries, local APIs, network requests and the redesign checklist.

EmbeddingGemma 2 q4 text and vision share normalized 768-dimensional vectors. Whisper tiny.en transcribes speech separately. WASM uses a standard-operator lowering of the model's packed q4 embedding lookup because the distributed ORT WASM runtime lacks that kernel. The pinned weights and precision remain unchanged. See [retrieval notes](docs/verification/retrieval.md) for equivalence checks, prefixes, calibration and frozen versions.

## Team workflow

The [release implementation plan](docs/implementation/release-plan.md) records the earlier responsibility split and release gates. Later authorized teammate fix PRs, including Chaitanya's PR #19 and Nakshatra's PR #24, supersede its historical tester-only assignment for that work. The 2 November local readiness plan is complete within its documented scope. Next are review/merge of this follow-up and the deployment, real-user and cross-group work identified in the course check-in above. Tester prompts and the repository bug-report form remain in [team instructions](docs/implementation/README.md).

The original integration reached `main` through reviewed [PR #6](https://github.com/rajmodi8905/cs437-Last_3_Brain_Cells-hack/pull/6); the current merged fixes are summarized above. Readiness documentation and dependency remediation use `raj_all_fixes`; preserve historical `Raj_setup` and `raj_final` branches. Every main change requires a reviewed PR and the configured two human approvals. Ask before staging/committing unless the current request explicitly authorizes that particular checkpoint; pushes, PRs and merges require the applicable authorization. Keep private handovers, device certificates, generated sessions and unrelated drafts out of public changes. See [implementation instructions](docs/implementation/README.md) and [AI-assisted development notes](docs/ai-use.md).
