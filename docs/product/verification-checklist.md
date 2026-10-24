# Campus Recall verification checklist

**23 October integration note:** The foundation-only findings and command evidence below are historical evidence from Chaitanya’s content handoff, not the current application status. Raj has implemented the product and added real-model, browser and accessibility tests. Read [current verification evidence](../verification/README.md) for actual results. Physical-device manual scenarios remain untested until the team records them. Policy changes in this integration still need team review before a deployment.

**Draft content handoff.** Documentation review and foundation checks are distinct from unfinished application acceptance. All manual scenarios below are **Untested**. Raj owns UI/engine/PWA implementation and automated application acceptance; Chaitanya supplies content and review instructions only.

## Documentation validation contract

These checks were defined before drafting the policy and guide content:

1. Scope: only the four agreed Markdown files in `docs/product/` may change. Preserve existing work, contracts, code, dependencies, and lockfile. Do not stage, commit, push, or merge.
2. Links: resolve each relative Markdown link from its containing file and verify any heading fragments. Verify repository destinations against the configured remote. Report external reachability separately; a valid-looking URL is not proof of reachability. Route strings are planned application routes, not working Markdown links.
3. Coverage: map every Chaitanya handoff topic to the sections below, and map manual scenarios to S1 through S15 without claiming complete automated coverage.
4. Factual consistency: compare claims with README, package scripts, shared constants, storage implementation, unavailable adapter, entry point, and existing tests. Label code inspection separately from runtime evidence. Explicitly identify planned features and unresolved differences.
5. Draft status: both policies must say Draft, include a draft version and separate implementation review note, and contain no invented effective/publication date, host, contact, legal clause, or security certification. Unknown facts must be stated as unresolved, not filled with placeholders.
6. Copy: scan the four files for em dashes, placeholder markers, invented contacts, absolute privacy/security guarantees, promotional claims, fake metrics/testimonials, confidence percentages, and generated-answer promises. Review matches in context, including negated cautions. Do not edit user originals or interview quotes.
7. Evidence: run available foundation install/test/typecheck/build commands when possible; record versions, exit outcomes, and limitations. No foundation pass proves browser persistence, model retrieval, offline behavior, S14, or S15. Leave unperformed manual checks Untested.

## Coverage map and factual sources

| Requirement | Content location |
| --- | --- |
| Originals, extracted content, transcripts, embeddings, browser storage | [Privacy Policy](privacy-policy.md), Information kept locally |
| Inference uploads, advertising/analytics, setup destinations, website requests, hosting logs | Privacy Policy, Processing and network requests |
| Deletion, unencrypted export/restore, separate libraries, eviction and OS/browser limits | Privacy Policy, Deletion/export and Retention sections |
| Draft version and actual dates on publication | Both policy introductions and update sections |
| Student project, ownership, imported material, errors, originals, third parties, updates/reporting | [Terms](terms-and-conditions.md) |
| Formats/limits, save/fallback, states, setup, search/source, backup, recovery | [User guide](user-guide.md) |
| Repeatable actions, expected outcomes, evidence, physical-device and copy review | Scenarios and evidence template below |

Review sources: [plan](../../IMPLEMENTATION_PLAN.md), [SPEC](../../SPEC.md), [Chaitanya handoff](../implementation/chaitanya.md), [contracts](../implementation/contracts.md), [acceptance design](../implementation/acceptance.md), [README](../../README.md), [package scripts](../../package.json), [shared types/limits](../../src/shared/index.ts), [storage](../../src/storage/index.ts), [entry point](../../src/main.tsx), [adapter](../../src/engine/unavailable.ts), [storage tests](../../tests/storage/repository.test.ts), and [adapter test](../../tests/engine/unavailable.test.ts).

## Current factual review and unresolved questions

Inspected baseline: `4b9ed54ec291291d6e8344eaa1ac9db47af28a0e` on `Chaitanya_setup`. The plan and handoffs retain planning-checkpoint wording saying no scaffold exists. README and current code establish that a foundation now exists; neither establishes a completed product.

| Finding | Required follow-up and owner |
| --- | --- |
| Local storage/transfer APIs exist, but the entry point only renders a message and does not wire them or the unavailable adapter into a product flow | Raj: integrate and test product controls; no current UI save/search claim |
| No downloader, asset manifest, service worker, policy routes, OCR, transcription, or retrieval pipeline exists | Raj: establish actual assets/hosts/redirects, bytes, licenses, query retention, permissions, repair controls, and network behavior before final policy review |
| No deployment host/logging facts or published policy dates are established | Release owner and Raj: confirm actual host and logging practices, then set real dates and review policy version |
| Foundation file validation uses supplied MIME and size, without decoding or file-signature checks; PDF/media deep limits are constants, not enforced processing | Nakshatra/Raj: reconcile basic-container validation with contracts and implement deep checks; do not claim format validation complete |
| Raw HTML is not a supported repository file input; supplied webpage text is accepted without a fetch or HTML parser | Raj: implement inert conversion/manual fallback and visible truncation; prevent URL-only capture claims |
| Import validates listed paths/hashes/limits but does not reject every extra unlisted ZIP entry; storage tests cover only selected cases | Nakshatra: reconcile extra-entry rejection and complete malformed/quota/browser evidence before claiming the full archive contract |
| Publication checks nonzero finite 768-dimensional vectors but not all normalization, modality/text, location, or same-index-version invariants; enqueue can add a job for a Ready item | Nakshatra/Raj: reconcile processing guards and compatible-Ready requeue behavior with contracts; no complete index-validity guarantee |
| Existing tests use fake IndexedDB; no browser/model suite or S1–S15 acceptance registry is present. `npm test` can pass without model assets, and `check` has no lint command | Foundation owner/Raj: implement required acceptance harness and lint coverage; retain honest package-only results meanwhile |

These are review findings, not changes to shared contracts. No runtime fixes are included in this package. Policy text cannot establish S14 privacy behavior or S15 route access.

## Foundation command evidence

Executed on 22 October 2026 (Asia/Calcutta), against the inspected baseline plus these four uncommitted documentation files. Runtime: temporary Node `v24.22.0`, npm `10.9.3`, Windows PowerShell. No dependency or lockfile versions were changed.

| Check | Actual outcome | Scope |
| --- | --- | --- |
| Locked install: `npm ci --cache .cache/npm --no-audit --no-fund` | Exit 0, 200 packages installed | Node 24 run completed with required subprocess access; deprecation warning for `whatwg-encoding` |
| `npm run test:fast` | Exit 0, 10 tests passed in one file | Isolated storage tests using fake IndexedDB |
| `npm test` | Exit 0, 11 tests passed in two files | Storage plus unavailable-engine test only |
| `npm run check` | Exit 0 | TypeScript only; no lint script present |
| `npm run build` | Exit 0; Vite 7.1.7 built 27 modules | Minimal foundation bundle, not PWA acceptance |
| Relative Markdown link scan | 28 links resolved; no heading fragments to check | Four new documents only |
| Draft/copy/whitespace scan | Passed: Draft markers present; no em dashes, TODO/TBD/FIXME markers, email addresses, absolute security/privacy slogans, or trailing whitespace | Pattern scan plus contextual review, not a legal/security audit |
| Coverage/status review | All handoff topics mapped; 19 manual scenarios cover S1–S15 and explicitly say Untested | Documentation coverage only |
| Factual review | Current/planned distinction checked against the sources above; unresolved differences recorded | Code inspection, not browser or inference evidence |
| Scope and diff checks | Exactly four new product documents; tracked code, dependencies and lockfile unchanged; `git diff --check` passed | No staging, commit, push, or merge |

The one external Markdown destination is the project repository and matches `git remote -v`. An authorized `git fetch origin` succeeded and confirmed HEAD equals `origin/main`; HTTP page reachability was not separately tested. Relative links were checked using a Node script that parsed Markdown destinations, resolved them from each containing file, and asserted target existence. The same scan checked Draft markers and prohibited literal patterns; coverage and broader promotional/UI claims were reviewed in context. Future edits require rerunning these checks.

Environment setup initially failed with Node 22 and an uncached-package error. A subsequent install still used Node 22 because the system npm launcher selected its bundled runtime. Invoking npm's CLI explicitly with the temporary Node 24 binary corrected that; a sandbox subprocess `EPERM` was resolved by rerunning with the required access. The successful checks above all used Node 24, not the earlier attempts. For this Windows session the invocation was:

```powershell
$taskNodeDir = "$PWD\.cache\npm\_npx\387698761821791d\node_modules\node\bin"
$env:PATH = "$taskNodeDir;$env:PATH"
& "$taskNodeDir\node.exe" "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run test:fast
```

The temporary cache location is session-specific; on a normally configured Node 24 machine use the README commands directly. The other recorded commands used the same explicit runtime invocation with their respective npm arguments. Generated dependencies/cache/build output are ignored local artifacts.

Full application acceptance is **Incomplete**, regardless of these outcomes. The current tests do not exercise real-browser restart, quota recovery, source viewers, inference, network privacy, or PWA installation. `npm run dev` and manual troubleshooting flows were not run or verified during this handoff. No S1–S15 application statement is marked passed.

## Manual scenario prerequisites

Run after Raj integrates the application, on a production build with recorded assets and a fresh library/profile per independent scenario. Use labelled synthetic or appropriately licensed fixtures, never private user material. Obtain the frozen corpus, hashes, expected item IDs/pages/intervals and model configuration from the [acceptance design](../implementation/acceptance.md). Do not replace real extraction with seeded vectors when claiming retrieval success.

Use trusted HTTPS for phone secure-context checks; ordinary HTTP LAN access is insufficient. No deployment is authorized by this checklist. Test cached restart in the same profile. Keep setup/webpage requests separate from private-operation request measurements. Browser emulation is separate evidence from physical hardware.

## Manual scenarios

Every row starts **Untested**. Expected outcomes are requirements, not observations. For each run, use the evidence template below; mark Pass/Fail only with actual evidence.

| ID / SPEC | Exact actions | Expected outcome | Initial result |
| --- | --- | --- | --- |
| M01 / S1 | Before model setup, save each supported kind with no title; record IDs/hashes; close and reopen the same profile; open recent originals | Confirmation only after commit; queued originals survive with matching bytes/text/URLs | Untested |
| M02 / S1, S6 | In a disposable test profile, have the harness force save and import write/quota failure; compare library before/after | No false save confirmation, successful new item, or partial restore; prior library unchanged | Untested |
| M03 / S2 | Save mixed kinds/statuses including two different originals with the same title; combine type/status filters; rename one; reopen both | Newest-first stable ordering; filters combine; rename preserves ID, bytes and capture time; correct original per ID | Untested |
| M04 / S3 | Independently delete Queued, Ready, and Processing fixtures; release a delayed worker response; repeat deletion and restart | No item, original, preview, segment, or job remains; no resurrection | Untested |
| M05 / S4 | Capture controlled allowed and blocked public URLs; try pasted text, inert HTML containing scripts/events, and PDF fallback; capture over-limit text and try URL-only input | Safe snapshot/URL retention; no script execution; actionable fallback and truncation indication; no invented captured text | Untested |
| M06 / S5 | Open independently mapped sources with duplicate titles, PDF page 2 and annotated media intervals; remove one original using the test harness and reopen its result | Correct ID/bytes/page; seek within annotated interval with two-second edge tolerance and no forced autoplay; unavailable source without substitution | Untested |
| M07 / S6 | Select a subset, export, inspect ZIP contents, restore in a second profile/device, repeat import; include same-title distinct content | Only selected originals/metadata; no derived indexes/models; fresh queued IDs, matching bytes/times/URLs; reported true duplicates without overwrite; first library remains separate | Untested |
| M08 / S6 | Import disposable archives with altered hash, missing original, unsupported version, traversal path, extra executable entry, and invalid metadata; compare existing library | Reject each invalid archive without changing prior data; empty export selection rejected | Untested |
| M09 / S7 | Start explicit setup, interrupt it, resume; remove/corrupt a required runtime in a disposable profile; then complete setup and restart offline | Real progress; no premature Offline ready; explicit repair without remote inference; complete assets permit local operation | Untested |
| M10 / S8 | Offline after setup, process known-phrase JPEG/PNG/WebP, text PDF page 2 and scanned PDF; separately try corrupt/encrypted/over-limit inputs | Actual extraction/page provenance; small fixtures meet the 120-second reference-phone target or record failure; invalid processing retains original with Failed reason | Untested |
| M11 / S9 | Build the frozen 30-item library through actual processing; submit R1–R6, N1–N3, empty query, and an incompatible-index case | R1–R6 expected IDs in top three distinct items; at most five results; negatives empty without asserting never saved; empty query avoids inference; incompatible index requires reindexing | Untested |
| M12 / S10 | Process R7/R8/R12 without answer-bearing metadata; run fixed visual queries and open matches | Expected originals in top three and correct video sample location; previews without invented captions; no unsampled-scene promise | Untested |
| M13 / S11 | Process R9/R10/R11 and near-silent audio/silent video; query and open media; exercise duration/codec limits | Actual English speech retrieval and annotated intervals; silent video visual eligibility; explicit failures for invalid media | Untested |
| M14 / S12 | Interrupt real processing before publication, reopen; force recoverable failure, inspect original, Retry; release stale claim | Original retained; one current Ready generation after recovery; no stale/duplicate publication | Untested |
| M15 / S13 | At 390/768/1440 px, navigate empty/error/populated states with long filenames; use keyboard, focus, zoom and reduced motion; cache and reopen offline | Readable responsive controls, visible focus, usable navigation and original access without model gate; no forced reload during active work | Untested |
| M16 / S13 | On each physical phone, install through its supported browser path; open keyboard, rotate landscape, pinch zoom, inspect safe areas, play media and relaunch offline; interrupt setup and reload runtimes | Usable touch/keyboard/installed layouts and playback; primary targets at least 44 px, phone inputs at least 16 px; no clipped essential controls | Untested |
| M17 / S14 | After verified setup, monitor outgoing requests while importing fresh sentinel-bearing originals of every kind, processing, searching, restarting and viewing; repeat with missing assets; separately inspect setup/web capture | Zero outgoing core-path requests and no remotely sent private sentinels; missing assets require repair; explicit setup/web requests attach no unrelated library data | Untested |
| M18 / S15 | Before model setup, follow Settings and first-use links to Privacy/Terms; directly load/reload `#/privacy` and `#/terms`; after caching, repeat offline from production build | Both readable policies accessible by every path without a model gate; actual content matches implementation and real publication facts | Untested |
| M19 / S15 | Review authored UI/policy copy and styles against the prohibited-pattern list below, then compare policy claims with M04/M07/M17 and actual host/asset inventory | No prohibited authored patterns or invented facts; each published claim has evidence or is revised before release | Untested |

Prohibited-pattern review covers purple/decorative gradients, pill buttons, fake reviews/testimonials/metrics/customer counters, vague hero or generic AI marketing copy, emoji icons, AI-generated stock photos/promotional illustrations, custom cursors, parallax, scroll-jacking, decorative scroll reveals, em dashes in authored product copy, fake library content, confidence percentages, and generated answers/captions. Preserve original imported text and research quotes. Search/keyboard results must not have entrance/reordering animations. Verify useful feedback, if present, stays within the plan's 100–160 ms guidance and respects reduced motion.

## Physical-device matrix

| Device | Required surface | Result |
| --- | --- | --- |
| MacBook M4 / 16 GB | Chrome and Safari | Untested |
| iPhone 17 | Safari and installed PWA | Untested |
| iQOO Neo9 Pro / 8 GB | Chrome and installed PWA | Untested |
| Moto G85 / 12 GB | Record actual browser and installed behavior | Untested |
| HP Pavilion / 16 GB | Record actual OS/browser | Untested |
| Available gaming laptop | Additional compatibility check, record hardware | Untested |

No actual OS/browser versions, timing measurements, screenshots, or device passes have been collected for this handoff.

## Evidence template for each run

Copy this template for each scenario. Its initial values intentionally record absence of evidence rather than fictitious results.

| Field | Initial value |
| --- | --- |
| Scenario and SPEC IDs | Not run |
| Tester, date/time/timezone | Not recorded |
| Tested commit and any working-tree changes | Not recorded |
| Production build/base URL and secure context | Not recorded |
| Evidence class: automated, emulation, physical device, or code review | Not recorded |
| Device/RAM, OS and browser exact versions; installed/browser mode | Not recorded |
| Asset/model revisions, hashes, runtime versions, index version and thresholds | Not recorded |
| Fixture hashes, expected IDs/pages/independently annotated intervals | Not recorded |
| Preconditions, profile, cache/network and warm/cold state | Not recorded |
| Exact actions and expected outcome | Copy the chosen scenario before running |
| Actual outcome, errors, timings/ranks and outgoing requests | Not observed |
| Screenshots, logs, request trace and automated test references | Not collected; redact private data |
| Result and limitations | Untested |
| Follow-up owner, issue and retest reference | Not assigned |

Record failures as failures, missing prerequisites as blocked/incomplete, and unperformed work as Untested. Do not convert an isolated storage test, mock, screenshot, or policy draft into a whole-SPEC pass. Recheck evidence after relevant implementation changes.
