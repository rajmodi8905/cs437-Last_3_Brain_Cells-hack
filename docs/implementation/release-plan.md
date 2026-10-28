# Campus Recall: completion and release implementation plan

Prepared 28 October 2026. This is the current work assignment for completing the existing product. It supersedes the original member implementation assignments for this release phase. Product requirements remain in [SPEC.md](../../SPEC.md); the [original plan](../../IMPLEMENTATION_PLAN.md) and earlier handoffs remain historical context.

## 1. Ownership and scope

| Person | Current responsibility | Deliverable |
| --- | --- | --- |
| Raj | All further implementation: bug fixes, automated regression tests, phone compatibility fixes, UI revamp, models, integration, policy corrections, deployment preparation and release | Focused implementation PRs, actual validation and a reviewable release candidate |
| Nakshatra | Find bugs in saving, storage, processing lifecycle, extraction/retrieval correctness, deletion and transfer; retest fixes | Reproducible GitHub issues and dated test results |
| Chaitanya | Find bugs in onboarding, model setup, navigation, viewers, mobile/PWA behavior, accessibility, webpage capture, policy accuracy and usability; retest fixes | Reproducible GitHub issues and dated test results |

All exploratory bug finding and issue discovery belong to Nakshatra and Chaitanya. Raj is not assigned an exploratory bug-hunting package. Raj uses reported reproductions to implement fixes and run the validation needed to establish that those changes work. The two testers may investigate any area beyond their primary focus; ownership must not prevent a useful report.

Nakshatra and Chaitanya do not implement fixes, redesign screens, change models, edit acceptance expectations or open implementation PRs during this phase. They may use an AI to inspect code, run the product and prepare reproductions. A disposable local reproduction script is allowed; it must not alter production code or be published without approval.

Use the existing product scope. Do not add accounts, sync, reminders, chat answers, server inference, paid APIs or new modalities. Suggestions are separate from defects. No evidence is inferred from a screenshot, old assistant report or passing mock.

## 2. Verified starting point and remaining statements

The last verified main commit is `b58ee3508e7871602606cbc414d3a6c08c569da7`, the reviewed PR #7 merge. Main CI [40331024239](https://github.com/rajmodi8905/cs437-Last_3_Brain_Cells-hack/actions/runs/40331024239) passed 50 fast, 8 browser and 10 actual-model tests. Fetch current main and record its actual SHA before each new test round; these counts are historical baseline evidence, not a new run.

All fifteen statements have executable coverage. The stronger S2/S3/S6/S12 checks are already merged. The explicit remaining gates are:

| Statement | Remaining evidence | Execution and implementation |
| --- | --- | --- |
| S8 | Actual reference-phone OCR/PDF processing, correct page provenance and each agreed small fixture within the 120-second target | Nakshatra executes and records; Raj implements reported fixes |
| S13 | Physical Safari/Android browser and installed-PWA behavior, keyboard, safe areas, zoom, playback and offline reopen | Chaitanya executes and records; Raj implements reported fixes |
| S15 | Team review of policy claims against actual behavior and the final host | Chaitanya reports discrepancies; Raj updates implementation/policy text; both testers review final facts |

Other statements remain subject to regression and edge-case testing. Do not downgrade a requirement, raise thresholds, remove a failing query or mark a device unsupported merely to obtain green results. A necessary scope/model/contract change requires team agreement, an explicit specification revision and new evidence.

## 3. Order and target dates

The course requires every statement green and the specification frozen by **3 November**. Dates below are targets, not promised passes. The [course timeline](https://anup.github.io/courses/cs437-2026-27-sem1/hackathon/) also schedules cross-group review during 2–10 November, acceptance on 16 November and demonstration on 17 November.

| Target | Package | Dependency and exit gate |
| --- | --- | --- |
| 28 October | Publish this plan and issue form; prepare reproducible baseline/test kit | Reviewed documentation on main before teammates rely on its files/form |
| 28–29 October | Initial physical-device compatibility pass and parallel bug finding | Reports identify exact commits, environments and actual failures |
| 29–30 October | Raj fixes core blockers and completes remaining runtime behavior | Testers retest original failures; no unresolved core blockers before revamp |
| 30–31 October | Raj implements the focused UI revamp | Complete flows and error states, with unchanged service contracts |
| 1–2 November | Testers run final device/edge-case rounds; Raj completes fixes and automated validation | Final UI and release build have current per-statement evidence |
| By 3 November | Final policy review, all-green specification and release candidate | Reviewed main, required CI, fifteen actual passes and documented deployment procedure |
| After approval | Publish and verify the hosted release | Post-publication smoke on the exact deployed commit; rollback available |

Do not postpone first phone inference until after the redesign. If phone feasibility or data safety is blocked, prioritize that fix and reduce optional visual polish, while preserving agreed product requirements. If the deadline is at risk, report the actual blocker and proposed scope decision before the deadline.

## 4. Package A: baseline, test kit and issue intake

Executable handoff: [tester quickstart](nakshatra-quickstart.md). `npm run qa:prepare` generates the synthetic library/invalid cases/expected-source data/blank ledger; `npm run qa:https` accepts existing local TLS files for the physical-device session. These commands do not publish a site or configure phone trust. Desktop testing does not wait for a phone connection.

[Chaitanya's focused quickstart](chaitanya-quickstart.md) uses the shared kit plus UI-stress notes, inert HTML, a C1–C15 ledger and the local `qa:webpages` helper for controlled capture failures. It does not depend on Nakshatra finishing her bug-finding round.

Raj prepares the implementation environment and test kit; Nakshatra and Chaitanya execute their assigned testing.

1. Obtain commit/publication approval, publish this documentation and issue form through a reviewed PR, and merge only with authorization. The issue form is available through GitHub's New issue screen only after it reaches the default branch.
2. Record the main SHA, Node 24 version, lockfile, model revisions, index version and existing retrieval-freeze hashes. Preserve unrelated work and existing libraries.
3. Provide the existing synthetic fixtures and their independent expected originals/pages/media intervals. Do not use real student chats or sensitive files in public evidence.
4. Provide known malformed/unsupported examples in a separate disposable test location. Add a small, previously unused exploratory set for realistic queries; keep it separate from the already consumed regression corpus and do not claim new general accuracy from it.
5. Prepare a production build and a phone-reachable trusted HTTPS address. Use a stable origin where practical, so repeated tests do not unnecessarily create new libraries/model caches. Do not publish a hosted preview or alter device trust settings without the needed user action/authorization.
6. Share the exact build URL and SHA with both testers. If they test different commits, their reports must say so. A locally modified checkout is not represented as clean main.

Repository: `https://github.com/rajmodi8905/cs437-Last_3_Brain_Cells-hack`. Issue form: [.github/ISSUE_TEMPLATE/bug-report.yml](../../.github/ISSUE_TEMPLATE/bug-report.yml).

## 5. Package B: independent bug finding

Send [Nakshatra's prompt](bug-hunt-nakshatra.md) and [Chaitanya's prompt](bug-hunt-chaitanya.md). Both start from current main and follow the actual README. They keep a pass/fail/blocked/not-run ledger; no minimum issue count is required.

### Nakshatra's scenarios

- Save all six supported kinds before model setup, reload, compare originals and observe queued/failed/ready visibility.
- Duplicate titles with different contents; duplicate bytes; rename, filtering and recent order; original identity after each operation.
- Stop/reopen while queued or processing; retry after failure; delete queued, processing and ready items; observe whether deleted items reappear.
- Export/restore mixed originals into a separate profile/device; repeat restore; verify hashes, titles, times, URLs, queued status and duplicate reporting.
- Malformed/corrupt archives and unsupported, corrupt, encrypted or over-limit files. Use synthetic data in disposable profiles for destructive/quota experiments. If a failure cannot be induced, record not tested rather than passed.
- Text PDF page 2, scanned PDF, OCR images, speech timestamps, silent video and visual-only retrieval; compare results with independently recorded targets.
- Weak/unrelated queries, empty queries, long queries and realistic paraphrases. Preserve the fixed model/query/threshold policy; observed misses are reports, not a reason to edit expectations.
- On available reference phones, measure the agreed small S8 fixtures, recording cold/warm state, setup state, bytes, elapsed time and final status.

### Chaitanya's scenarios

- First-use navigation, saving before setup, download progress, repeated setup clicks, interrupted setup and missing-asset repair.
- Each route at 390/768/1440 px, long filenames, empty/error/loading states, keyboard focus, escape/close behavior, reduced motion and readable copy.
- Physical iPhone/Android touch, keyboard-open forms, portrait/landscape, safe areas, pinch zoom, file selection and viewer/media controls.
- Exact originals from duplicate-title results; missing-source state; correct PDF pages and media seek locations.
- Permitted public-page capture, blocked capture, paste fallback, inert HTML import and visible truncation. Distinguish expected browser restrictions from broken fallback behavior.
- Safari/browser versus installed PWA, production offline launch, saved originals before models, interrupted foreground/background sessions and update notifications.
- Privacy/Terms links before setup, direct reload and offline; claims compared with actual destinations, storage/export/delete behavior and selected host.
- Copy/style restrictions from the plan, keyboard/accessibility problems, misleading claims, fabricated content or exposed confidence percentages.

### Reporting and triage

One observed defect per issue. Search open and closed issues first. Use the form and include exact SHA/build URL, device/OS/browser, browser/installed mode, cache/network state, fixtures, numbered steps, expected/actual outcome, occurrence count and sanitized evidence. Use `unknown` for unavailable details.

Distinguish runtime observation, reproduced automated failure and an unverified static-code concern. Static concerns need exact file/line reasoning and must not claim the app was run. Feature ideas do not become bugs solely because a tester would prefer them. New private files must never be attached to public issues.

Testers propose severity; Raj uses impact to schedule implementation:

| Priority | Meaning | Action |
| --- | --- | --- |
| P0 | Observed private-data exposure or irreversible loss/corruption | Stop affected release work and address immediately |
| P1 | Save/process/search/open/setup/offline fails on a required device, or a statement cannot pass | Fix before release and before redesign if it blocks core use |
| P2 | Workaround exists but behavior or usability is materially wrong | Resolve before freeze when required by SPEC; explicitly assess any deferral |
| P3 | Cosmetic polish or optional improvement | Address after required correctness; do not expand scope silently |

Testers retest each fixed issue on the original environment and commit/build supplied by Raj. They report failure if it persists. A closed issue alone is not evidence of a fix.

## 6. Package C: Raj's implementation work

For each reported defect:

1. Read its actual reproduction, related SPEC statement and relevant existing tests. Request missing reproduction facts from the reporter if necessary.
2. Add a meaningful regression test before the code fix when the failure is automatable; record the actual failure. For physical-only defects, retain the reporter's steps and require physical retest in addition to relevant automation.
3. Fix the smallest responsible layer: UI/controller, storage, queue, extraction, model worker, ranking, viewer, asset setup or service worker. Do not put engine/storage logic into view components.
4. Preserve original identities and bytes, atomic saves/publication, generation guards, source provenance, local inference and weak-match rejection.
5. Check cold/repeated inference, resource disposal, fallback and retry for fixes that touch phone runtime behavior. Never add remote inference as an invisible workaround.
6. Run checks appropriate to the change, document actual results and link the issue in a focused PR. Have the reporter retest the candidate. Merge through required reviews and explicit authorization.

Maintain the dependency versions and current model/index policy unless a separately reviewed fix requires changing them. A model, tokenizer, chunking, prefix, threshold or quantization change requires its own evidence and index compatibility/rebuild decision. Keep original failed retrieval evidence.

## 7. Package D: initial physical-device compatibility

Raj prepares and fixes the build/diagnostic setup. Nakshatra owns processing/retrieval test execution; Chaitanya owns installation and interface test execution. Device owners perform required physical taps and permission prompts. Raj is not assigned a separate exploratory phone bug hunt.

Primary matrix: MacBook M4/16 GB in Chrome and Safari; iPhone 17 in Safari and installed PWA; iQOO Neo9 Pro/8 GB in Chrome and installed PWA. Compatibility: Moto G85/12 GB and HP Pavilion/16 GB; additional gaming laptop where available. Record exact OS/browser versions and unavailable devices.

For the iPhone session, have a USB-C connection to the Mac, unlock/trust the computer, enable Safari Web Inspector on the phone and Safari developer features on the Mac. The cable supports diagnostics; it does not expose Mac localhost or make HTTP secure. Use reachable trusted HTTPS. Do not require Xcode/Developer Mode without an actual diagnosed need. [WebKit instructions](https://webkit.org/web-inspector/enabling-web-inspector/).

Measure setup and each modality separately. Record first-load and warm behavior, failures, search time, source location and model backend. Test background/foreground and interruption honestly: uninterrupted background processing is not promised. Browser and installed-PWA storage/cache behavior must be observed rather than assumed identical. Transfer is manual; no device synchronization is promised.

## 8. Package E: Raj's UI revamp

Start after initial phone compatibility and core blocker fixes, before final acceptance. Nakshatra and Chaitanya continue reporting; all design and UI implementation remains Raj's.

1. Read and apply the approved [Emil Design Engineering](https://github.com/emilkowalski/skills/blob/main/skills/emil-design-eng/SKILL.md) and [Mobile Native](https://github.com/emilkowalski/skills/blob/main/skills/mobile-native/SKILL.md) guidance before implementation. Use an approved reference/design direction for the revamp.
2. Revamp complete flows: first use, Library/Search, Add, processing feedback, exact-original viewers, Settings/backup/model setup and policy pages. Include loading, empty, error, failed/queued and unavailable-source states.
3. Reuse `src/app/services.ts`, `useCampusRecall` and shared DTOs. Replace `src/ui/` screen/style modules without coupling them to Dexie tables or model workers. Preserve IDs, data, source locations, routes and lifecycle guarantees. See [architecture](../architecture.md).
4. Use readable neutral surfaces, restrained blue, system fonts, labelled SVG icons, clear focus, primary touch targets at least 44 px and mobile inputs at least 16 px. Preserve zoom; handle keyboard, dynamic viewport and safe areas. Respect reduced motion and pointer capabilities.
5. No purple/decorative gradients, pill buttons, fake reviews/metrics/counters, vague promotional copy, emoji icons, product-authored em dashes, AI stock imagery/copy, custom cursors, scroll-jacking, parallax or decorative reveals. Preserve imported/quoted source text exactly.
6. Testers review screenshots and actual interactions, recording `Before | After | Why` for changes/findings. Isolated fixtures may support UI tests; never show fixture results as a real user's library.

Keep visual changes separate from model/storage changes in PRs. Do not call the redesign complete after only the default desktop screen looks correct.

## 9. Package F: final acceptance and policy facts

After the revamp, testers repeat affected scenarios and complete the full matrix. Earlier UI evidence does not establish that the new UI passes. Raj runs implementation validation, fixes reported failures and assembles the release evidence.

Use Node 24 and the README setup. After `npm ci`, install Chromium (`--with-deps` on Linux), run `npm run models:download` and `npm run build`. Then run:

```bash
npm run check
npm run format:check
npm test
```

For UI-only incremental work, use `npm run test:fast`, build and `npm run test:browser`. Repeat actual-model acceptance when changing engine/services/storage lifecycle/offline behavior, and on the final release candidate. Missing required models fail setup explicitly; no skipped/faked acceptance passes.

For every S1–S15, record its test references, exact commit, actual outcome, remaining manual checks and evidence. Include fixture hashes, independent expected source locations, model/index versions, cold/warm conditions and physical devices. Track no-regression checks for all twelve retrieval targets and negative queries, while retaining the consumed-corpus limitation.

Chaitanya compares the final policy pages with actual behavior and the selected host; Nakshatra reviews storage/delete/export facts. Raj makes corrections, sets the actual publication/update date when appropriate and renders the reviewed content. No invented contact, endorsement, encryption or security claims. Policy text does not replace network/privacy tests.

## 10. Package G: deployment preparation and release

GitHub Pages is a candidate for this free static application, not an already selected or deployed service. Confirm actual hosting limits, generated file sizes, base paths, MIME types, workers/WASM, cache behavior and HTTPS before selecting it. [Static hosting](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages), [HTTPS](https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https).

Raj prepares a reviewable deployment package:

- Production build from a reviewed main SHA and the pinned lockfile; correct `APP_BASE`, hash routes, manifest scope/start URL, icons and service-worker registration for the real path.
- Deployment workflow with test/build gates and only the permissions the selected host requires. No public inference backend, analytics, uploaded originals or test harness.
- Verified model/runtime sources, hashes and license notices; host MIME and caching behavior compatible with JS/WASM/PDF/media workers. Downloads remain explicit; no model binaries in Git.
- Final-host setup instructions and privacy facts, including host access logs and external model downloads.
- Update procedure that does not force-reload during saving/processing, preserves the library and handles incompatible indexes explicitly.
- Manual backup instructions before updates, a previous known-good build and a rollback procedure. Asset rollback does not automatically reverse a database migration; incompatible schema changes require a separately tested migration/recovery plan.
- Release evidence and reproducible README commands, with build/commit identifiers and unresolved issues.

Choose the final origin early enough for meaningful phone testing. A preview counts as publication and needs authorization. After authorization, publish a reviewed candidate to trusted HTTPS, then have the testers execute hosted setup, import/process/search/open, direct routes, offline launch, manual transfer and update smoke checks. A local pass does not establish a hosted pass. Do not announce the release ready if those checks fail.

## 11. Evidence and issue lifecycle

Use a dated directory such as `docs/verification/2026-11-02/` for approved final reports. Keep raw personal files, credentials, model weights and temporary harness outputs out of Git. Local test notes may stay outside public changes until reviewed.

Each tester's ledger includes: tester/date; main/candidate SHA; app URL; device/OS/browser/mode; profile/cache/network state; SPEC/scenario; fixture name/hash; expected; actual; elapsed time if measured; pass/fail/blocked/not-run; issue/retest links. A scenario that succeeds is recorded in the ledger, not opened as a bug.

Issue flow: reported → clarified/reproduced → prioritized → linked implementation PR → reporter retest → reviewed merge → verification on merged main. During a freeze, distinguish implementation defects from approved feature requests. Raj may manage this workflow and implement fixes; Nakshatra and Chaitanya own discovering and reporting defects.

## 12. Git, publication and completion rules

- Start implementation from current merged main on existing `raj_final`, preserving `Raj_setup` and all uncommitted work. Incorporate main normally; no force pushes, destructive resets or history replacement.
- Testers use current main or the exact candidate named for retest. They do not need a product-code branch to file issues. Keep reproduction notes separate from production source.
- Ask before staging/committing. Prepare concrete files and validation first. Obtain authorization for unapproved pushes, PR publication and deployment; never infer merge permission.
- PRs target main, satisfy the configured two human approvals and current CI, and state related SPEC IDs, issue links, actual validation and remaining gates. Never bypass protection.
- Record truthful AI assistance in course-required personal lab notes. Preserve human Git attribution; do not add AI/bot coauthors. Do not fabricate reports, measurements or reviews.

Release readiness requires all fifteen statements genuinely green; no unresolved P0/P1 or other issue that violates a statement; reporter retests; final-device evidence; factual reviewed policies; passing final CI; and a fresh README-run check. Publication and post-deployment verification are separate final actions. Deferred nonessential polish must have an explicit issue and reason.

**Status:** this document is a work plan, not a claim that phone tests, redesign, publication or final acceptance have happened.
