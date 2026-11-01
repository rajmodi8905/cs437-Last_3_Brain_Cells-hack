# Verification evidence

Current integration candidate: [31 October combined-main validation](2026-10-31-integration.md). It includes Chaitanya's merged fixes and the outstanding local landing/device/release changes; Nakshatra's still-open PR and Android execution remain separate gates. Earlier reports below retain their original dates and build identities.

Latest local work: [29 October Safari, installed-iPhone and iOS 26.5 continuation](2026-10-29-release-preparation.md#29-october-continuation-with-the-iphone-available), [automated release preparation](2026-10-29-release-preparation.md) and [28 October measured iPhone session](2026-10-28-device-preparation.md). The continuation isolates the development-WebKit crash without application code, records shipping-Safari and simulator inference, and separates owner-confirmed physical interactions from direct diagnostics. These changes are not yet committed or deployed.

Update, 26 October: [PR #6](https://github.com/rajmodi8905/cs437-Last_3_Brain_Cells-hack/pull/6) is now reviewed and merged, and main CI passed. See the [October checkpoint audit](milestones-2026-10.md) for current per-statement coverage, fresh-checkout results and remaining gates. The pre-PR measurements below are retained as their original evidence.

Implementation branch: `raj_final`, based on merged main `11cb2c4`. This report distinguishes implementation, automated evidence and manual release gates. This branch is a review candidate; no deployment is claimed.

## Environment and public assets

Available machine: Apple M4, 16 GB, macOS 27.0.1 (build 26A434). Automated browser: Playwright Chromium 156. Browser tests are resized desktop Chromium, not physical-phone tests. The final pre-PR checks, build and complete test suite passed on Node 24.22.1 after the service/view refactor. Earlier Node 26 checks are historical evidence; Node 24 remains the required development runtime.

The versioned manifest currently contains 50 pinned assets totaling about 445.2 MB, including license notices. Model revisions, byte lengths and SHA-256 hashes are checked into `scripts/model-assets.json`; runtime hashes derive from the lockfile. Downloaded binaries are ignored. No embedding audio encoder is loaded.

## Implemented behavior

The merged repository/storage foundation is reused. Integration adds source-container checks, index publication invariants, guarded queue recovery, actual extraction and local inference, original-source retrieval, a responsive PWA, policy pages and manual transfer controls. No account service, generated-answer model, paid API, analytics or institutional integration was added.

The same q4 weights run on WebGPU and on WASM with a standard-operator lowering of quantized Gather. Independent native and browser numerical equivalence tests are documented in [retrieval notes](retrieval.md). The actual WebGPU smoke report is [webgpu-probe.json](webgpu-probe.json).

## Retrieval evidence and its limit

The first frozen 30-item evaluation processed all originals successfully, returned eleven targets at rank one, missed the adviser-appointment note (R4), and rejected all three negatives. Preserve this result: [first evaluation](retrieval-first-evaluation.json), [first freeze](retrieval-first-freeze.json).

Question-only and multiple-query trials were explored using the separate calibration set. They did not resolve the observed miss and are excluded from the final implementation. The root cause was duplicate input: the note’s derived first-line display title was embedded a second time as document content. Treating that redundant title as `none` aligns note processing with calibration. The consumed R4 regression then retrieved the expected original above the unchanged threshold using the original query prefix.

All original queries, expected sources and negatives remain unchanged. Reruns are regression tests of a consumed corpus. They must not be described as fresh held-out accuracy. This small synthetic corpus does not establish general student-query accuracy. The current calibration and freeze are linked from [retrieval notes](retrieval.md).

## Automated requirement map

| SPEC | Executable evidence | Remaining limits |
| --- | --- | --- |
| S1 | Storage transaction rollback, original retention; browser save/reload; all supported corpus kinds | Physical browser crash/eviction behavior is not a durability guarantee |
| S2 | Ordering/filter/rename/duplicate-identity storage tests; real UI rename and long titles | Manual phone interaction remains |
| S3 | Stale claim/deletion/cancel-retry tests and UI deletion | Clearing earlier exported backups is outside deletion scope |
| S4 | Inert HTML/parser and omitted-credential tests; browser HTML fallback and no imported-resource requests | Public sites can block capture; manual fallback remains required |
| S5 | Exact-original browser checks, PDF page and audio seeking; missing-source test; corpus location assertions | Physical media controls and phone PDF interaction remain |
| S6 | Hash/metadata validation, atomic restore, duplicate detection and archive round-trip tests; browser export | Additional manual cross-device transfer remains |
| S7 | Asset integrity/resume/missing-asset unit tests; actual verified cache and offline repair state | Physical-phone download interruption remains |
| S8 | Actual JPEG/WebP OCR, embedded/scanned PDF and page assertions; source-header checks | Unusual/hybrid PDFs may need further real-world evaluation |
| S9 | Frozen synthetic corpus regression and fixed negatives with actual embeddings | First evaluation missed R4; general accuracy is not established |
| S10 | Actual text-free image and silent video scene retrieval | Coverage is only sampled frames; physical performance remains |
| S11 | Actual MP3/M4A/WAV decoding and Whisper, spoken video, timestamps, silence gate | English baseline; speech recognition can fail |
| S12 | Generation/CAS, interruption recovery, retry, worker failure/fallback tests | Physical browser suspension and memory pressure remain |
| S13 | Production PWA offline reload/originals, widths 390/768/1440, keyboard, reduced motion | Installed iPhone/Android PWA checks remain |
| S14 | Actual processing/search with network disabled after setup, unexpected-external-request assertions, cache-only inference | This is scoped test evidence, not a security certification |
| S15 | Direct/offline policy routes, first-use access, product scan and automated WCAG A/AA scans | Team policy review and deployment-specific hosting facts remain |

The map identifies test coverage; it is not a blanket claim that every scenario or device has passed. See the command results below and attached raw reports.

## Current command results

The final pre-PR `npm run check`, `npm run format:check`, `npm run build` and complete `npm test` completed successfully on Node 24.22.1. Results:

| Check | Actual outcome |
| --- | --- |
| TypeScript, ESLint and product-copy restrictions | Passed |
| Production build | Passed; normal output excludes the acceptance harness |
| Vitest fast suite | 44 tests passed across 13 files |
| Production browser suite | 7 passed, zero failures/skips; repeated after the service/view refactor |
| Actual-model acceptance suite | 9 passed, zero failures/skips, about 13.7 minutes |
| Automated WCAG A/AA scans | Zero violations across five routes at 390 and 1440 px |
| Formatting | `npm run format:check` passed |
| Dependency audit | Zero reported vulnerabilities in the [pre-PR audit](dependency-audit.json) |
| Node 24 subdirectory build and browser smoke | Save, exact-original opening, offline reopen and direct offline policy route passed under `/campus-recall/` |

All 23 pinned external setup URLs also returned HTTP 200 in both the [HTTP health check](network-endpoints.json) and the [actual browser CORS check](browser-endpoints.json). These checks sent no private content or queries. See [architecture and API inventory](../architecture.md) for every network boundary and the local interfaces.

Raw Playwright summaries: [acceptance](acceptance-run-summary.json), [browser](browser-run-summary.json). Additional reports: [accessibility](axe.json), [subdirectory smoke](subdirectory-smoke.json), [calibration](calibration.json), and separate fresh 30-item regressions for [S9](retrieval-S9.json), [S10](retrieval-S10.json) and [S11](retrieval-S11.json). Each corpus run processed all 30 originals, retrieved its expected targets at rank one and returned no matches for the three unrelated queries. These consumed-corpus reruns do not erase the initial failure described above.

The UI is now split behind injected service contracts with a headless controller, separate screens/rows/dialogs and feature styles. Import-boundary tests and a contract-only view test cover that separation; they do not substitute for the real-model tests above. The compiled CSS is unchanged by this refactor. The interface detector previously returned no findings. Screenshots were inspected at desktop and phone viewport sizes; [UI review](ui-review.md) records the interaction and accessibility changes. The pre-PR run made no remote CI claim. Main CI subsequently passed, as recorded in the dated checkpoint audit.

## Manual release gates

- iPhone 17: record exact iOS/Safari versions; install, import, keyboard-open layout, zoom, source playback, setup interruption, offline reopen and full model reload.
- iQOO Neo9 Pro, 8 GB: record Android/Chrome versions and repeat those checks, including processing time and memory failures.
- Compatibility: Moto G85, HP Pavilion with actual OS, and the gaming laptop where available.
- Safari on the available Mac: actual model/runtime and PWA behavior, separate from Chromium.
- Team review of the revised Privacy Policy and Terms before deployment; designate the actual host and its request logging policy.
- Required PR reviews and authorized merge. This task does not authorize bypassing protection or publishing a deployment.

No physical-phone test, deployment or later inter-group course peer review is claimed. PR #6’s two approvals and merge are separately verified in the dated checkpoint audit.
