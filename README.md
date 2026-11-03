# Campus Recall

A free, local personal library for screenshots, PDFs, notes, webpages and short recordings. Save an original, describe what you remember, and open the matching file, PDF page or media interval. There are no accounts, cloud inference calls, generated answers or API keys.



https://github.com/user-attachments/assets/2947f113-1e72-4074-8d47-2b43daa21dfe



Built by Raj Modi, Chaitanya and Nakshatra for CS437 at IIT Gandhinagar. A student project, not an official IITGN service. Interview evidence and testable requirements are in [SPEC.md](SPEC.md).

For reviewers: [run locally](#run-locally) with `npm run dev` after installation; [run the full suite](#test) with `npm test` after its one-time browser/model/build setup. See [completed S1–S15 verification](docs/verification/README.md), [dependency validation](docs/verification/2026-11-02-dependency-remediation.md) and [AI-use notes](docs/ai-use.md).

## Implementation and verification: complete

All fifteen specification statements, S1–S15, are implemented and their acceptance checks pass. The required `npm test` suite passes without failures or skips. Policy/source fact review, dependency remediation, root/subdirectory builds and local offline verification are complete. **Deployment is the remaining release phase.**

| Verification | Recorded result |
| --- | --- |
| Specification acceptance | S1–S15 passed; [statement-by-statement evidence](docs/verification/README.md#specification-results) |
| Fast tests | 90 passed across 20 files |
| Production Chromium tests | 27 passed |
| Actual-model acceptance | 11 passed |
| TypeScript, ESLint, product checks and formatting | Passed |
| Full and production-only dependency audits | Zero findings |
| Root and repository-subdirectory artifacts | Passed; output unchanged by dependency remediation |
| Offline processing, retrieval, saved originals and policy routes | Passed |
| Policy/source fact review | Complete under Raj's delegated technical review |

[PR #26 CI run 41529035494](https://github.com/rajmodi8905/cs437-Last_3_Brain_Cells-hack/actions/runs/41529035494) passed at `5420b374785b3cf7418372dbd2495178db5fce4e`. Its application baseline includes merged PRs [#24](https://github.com/rajmodi8905/cs437-Last_3_Brain_Cells-hack/pull/24) and [#25](https://github.com/rajmodi8905/cs437-Last_3_Brain_Cells-hack/pull/25). The [dependency summary](docs/verification/2026-11-02-dependency-summary.json) records the tested input fingerprint and artifact hashes. Dated reports retain their execution dates and source identities.

### Device and transfer evidence

| Device or flow | Recorded evidence |
| --- | --- |
| iPhone 17, iOS 27.0.1 | Measured Safari processing/original/offline checks and owner-confirmed installed-app playback, seeking, keyboard, rotation and zoom. [Measured session](docs/verification/2026-10-28-device-preparation.md); [installed-app follow-up](docs/verification/2026-10-29-release-preparation.md#physical-installed-iphone-app-owner-confirmed-checks). |
| iQOO Neo9 Pro / I2304, Android 16, Chrome 156.0.8078.49 | Owner-confirmed setup, note/PDF retrieval and page mapping, negative rejection, images/media, playback/seeking, installed controls and offline fresh processing. Each agreed small image/PDF fixture was reported under 120 seconds. |
| Library transfer, S6 | Automated byte/hash/metadata round trips and export/restore into an independent browser profile passed. |

Device reports preserve measured versus owner-confirmed evidence and their original build identities. The Android offline round followed removal of the USB network route and owner-controlled disabling of Wi-Fi/mobile data. Retrieval tests use a consumed synthetic regression corpus; their results are not a general accuracy estimate. The local deepmerge security fork is documented and regression-tested; its source review supplies evidence beyond the package audit.

## Deployment: remaining release phase

No hosted deployment is published. Select and authorize the host, review its actual policy/logging facts, publish the verified artifact and validate the hosted HTTPS, MIME/cache, installation and update behavior. The rollout also records actual outside-group users and their feedback; no user count or hosted result is claimed in advance. The [deployment runbook](docs/implementation/deployment.md) describes this phase.

## Course check-in: 3 November 2026

References: [hackathon rules and dates](https://anup.github.io/courses/cs437-2026-27-sem1/hackathon/), [Class 15 user/specification instructions](https://anup.github.io/courses/cs437-2026-27-sem1/classes/class-15/) and [Class 19 deployment/usability instructions](https://anup.github.io/courses/cs437-2026-27-sem1/classes/class-19/).

- **Specification:** S1–S15 implementation and acceptance verification are complete. The current release phase is deployment, as described above.
- **Member work merged since 26 October:** Raj's [PR #25](https://github.com/rajmodi8905/cs437-Last_3_Brain_Cells-hack/pull/25) (1 November), Chaitanya's [PR #19](https://github.com/rajmodi8905/cs437-Last_3_Brain_Cells-hack/pull/19) (29 October) and Nakshatra's [PR #24](https://github.com/rajmodi8905/cs437-Last_3_Brain_Cells-hack/pull/24) (31 October).
- **Repository process:** both instructors are collaborators. The active `main` ruleset requires a PR and two approving reviews and blocks deletion/force pushes. These settings were checked on 3 November. Review/merge follows that process.
- **AI records:** each member records tool use and their work in `lab-notes/class-NN.md` in their own course repository. This project's [AI-use summary](docs/ai-use.md) provides the project-level record.

| Course calendar | Activity |
| --- | --- |
| 3 November | Completed S1–S15 acceptance baseline and specification checkpoint |
| 2–10 November | Cross-group PR reviews and improvements, with actual review links and regression evidence |
| 16 November | External unseen feature request: extend `SPEC.md`, write tests, implement, then run acceptance |
| 17 November | Demonstrate the real user workflow and accepted change |

Later course exercises describe future requests and review activity, not unfinished v1 specification items. The [October milestone audit](docs/verification/milestones-2026-10.md) preserves the original checkpoint history.

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
```

The required browser suite uses Playwright Chromium. Additional engine diagnostics and shipping-Safari comparisons are retained in the [dated engineering report](docs/verification/2026-10-29-release-preparation.md). Physical-device evidence is listed above. Reports and screenshots are written to ignored `test-results/` and `playwright-report/`; synthetic fixtures and calibration methodology are documented in [acceptance design](docs/implementation/acceptance.md).

Fixture regeneration needs macOS `say`, local ffmpeg and npm dependencies:

```bash
node scripts/create-fixtures.mjs
```

## Statement coverage and milestone evidence

All fifteen statements map to actual test suites in [the coverage registry](tests/spec/coverage.json). `npm run check` validates that mapping; `npm test` executes the behavior. Registry completeness alone is not a test pass. The current local, CI and device results are above; [the verification index](docs/verification/README.md) is the current S1–S15 status reference. See [the October milestone audit](docs/verification/milestones-2026-10.md) for historical checkpoint evidence and late earlier milestones. Older reports retain their original dates and builds rather than representing current status.

## Reusable regression tools

Follow [Nakshatra's quickstart](docs/implementation/nakshatra-quickstart.md) to prepare a production preview, an importable synthetic 30-item library, exact-source expectations, malformed inputs and an empty run ledger. `npm run qa:prepare` writes only to a new ignored `.cache/qa-kit/` directory and never overwrites an earlier run. No model download is needed to prepare the kit. Optional `npm run qa:https` uses user-supplied local certificate files for a phone session; it does not deploy a site or configure device trust. The quickstart links both testers' prompts and the GitHub bug-report form.

[Chaitanya's quickstart](docs/implementation/chaitanya-quickstart.md) adds UI boundary/source-content fixtures, a C1–C15 run ledger and `npm run qa:webpages` for deterministic desktop capture/truncation/blocked-fetch tests. The helper is loopback-only, synthetic and separate from the deployed application.

For the physical-phone session, follow [device preparation](docs/implementation/device-session.md). `qa:device:prepare` builds an isolated identified snapshot and public synthetic downloads under ignored `.cache/`; `qa:device:serve` verifies it before serving local HTTPS. Temporary certificate trust and physical tests require device-owner action and are never performed automatically.

The [Android validation runbook](docs/implementation/android-validation.md) covers Chrome and installed-app setup, fixture timings, exact originals, offline operation and manual transfer. The completed 2 November owner-reported round is summarized above. This runbook documents how to reproduce a device session. When a USB development route is used, remove it as well as disabling phone networking before testing offline behavior.

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

The [release implementation plan](docs/implementation/release-plan.md) records the earlier responsibility split and release gates. Later authorized teammate fix PRs, including Chaitanya's PR #19 and Nakshatra's PR #24, supersede its historical tester-only assignment for that work. The 2 November local readiness plan is complete within its documented scope. Deployment is the release phase described above. Course peer reviews and future enhancement work continue through independently reviewed PRs. Tester prompts and the repository bug-report form remain in [team instructions](docs/implementation/README.md).

The original integration reached `main` through reviewed [PR #6](https://github.com/rajmodi8905/cs437-Last_3_Brain_Cells-hack/pull/6); the current merged fixes are summarized above. Readiness documentation and dependency remediation use `raj_all_fixes`; preserve historical `Raj_setup` and `raj_final` branches. Every main change requires a reviewed PR and the configured two human approvals. Ask before staging/committing unless the current request explicitly authorizes that particular checkpoint; pushes, PRs and merges require the applicable authorization. Keep private handovers, device certificates, generated sessions and unrelated drafts out of public changes. See [implementation instructions](docs/implementation/README.md) and [AI-assisted development notes](docs/ai-use.md).
