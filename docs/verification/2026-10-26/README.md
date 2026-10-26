# 26 October checkpoint verification

This run used a new remote clone of reviewed main `6a96bc0dce76a8297253b3cfced5dc2a74d8bc2d` with the follow-up setup/test patch applied. Application code under `src/` did not change. The clone started without project dependencies, downloaded models or generated runtime files. The machine's npm cache and installed Playwright browser were available. It was not a fresh operating system or an independent human trial.

Environment: macOS on Apple M4, Node 24.22.1, Playwright 1.64.1 Chromium, actual pinned models using WASM. These results do not establish iPhone/Android/Safari compatibility.

| Check | Actual result | Evidence |
| --- | --- | --- |
| Fresh install | `npm ci` succeeded; audit reported zero vulnerabilities | [Run record](fresh-checkout.json) |
| Direct model setup after install | Passed without a prior build; pinned public files fetched and hash-verified | [Baseline failure and candidate repair](setup-regression.json) |
| Type/lint/product/statement mapping | Passed; all fifteen IDs mapped | [Run record](fresh-checkout.json), [registry](../../../tests/spec/coverage.json) |
| Fast behavior tests | 50 passed in 14 files | [Vitest file results](vitest-file-results.json), [run record](fresh-checkout.json) |
| Production browser tests | 8 passed, zero skipped | [Playwright summary](browser-summary.json) |
| Actual-model tests | 10 passed, zero skipped, 8.3 minutes | [Playwright summary](acceptance-summary.json), [actual run output](actual-model-run.log) |
| Automated accessibility | Zero violations in tested screens | [axe report](axe.json) |
| Production build | Passed | [Run record](fresh-checkout.json) |

The functional patch inputs are hashed in the setup report and match the fresh clone. All nine input hashes in the existing retrieval freeze were rechecked without changing models, queries or thresholds.

## Actual-model details

The suite exercised calibration, OCR, PDF text/page extraction, media decoding, English transcription, text/vision embeddings, weak-match rejection, packed-q4 reference equivalence, offline production behavior and interrupted indexing/retry. The three retrieval cases each rebuilt their own 30-item library with actual extraction and indexing.

- [S9 text results](retrieval-S9.json): R1–R6 all rank one.
- [S10 visual results](retrieval-S10.json): R7/R8/R12 all rank one, including a silent sampled video.
- [S11 speech results](retrieval-S11.json): R9/R10/R11 all rank one with independently annotated source intervals.
- All three unrelated queries returned no result in each library run.
- [Calibration scores](calibration.json) retained thresholds of 0.70 for text and 0.69 for visual matches.

These are consumed-corpus regression results. The original miss and subsequent fixes remain documented in [retrieval evidence](../retrieval.md). They are not a general accuracy estimate or a new held-out evaluation.

## Reviewed main and remaining work

[Review/CI metadata](review-and-main-ci.json) verifies the existing foundation/integration PRs and the successful main CI run. The [milestone audit](../milestones-2026-10.md) conservatively counts eight already reviewed/merged green statements. The new setup repair and stronger coverage checks require their own PR review; this report does not claim that follow-up has merged.

Physical-phone performance, installation/keyboard/safe-area/zoom/playback, Safari and final policy/hosting review remain open. Earlier missed deadlines remain recorded as missed. The present setup regression is not evidence of an on-time failing test for those dates.

The browser tests themselves passed. Their first output-copy wrapper encountered a missing log directory; the saved summary was recovered from the actual Playwright report before running the model suite. This logging issue is recorded in the run record.
