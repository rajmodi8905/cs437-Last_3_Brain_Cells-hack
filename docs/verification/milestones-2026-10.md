# October milestone audit and completion evidence

Recorded on **26 October 2026**, using Asia/Kolkata time. This report separates earlier deadline history, current executable tests and the reviewed/merged 27 October checkpoint. It does not change the dates of earlier work.

## Course requirements and earlier deadlines

Sources: [hackathon timeline](https://anup.github.io/courses/cs437-2026-27-sem1/hackathon/) and [class 15](https://anup.github.io/courses/cs437-2026-27-sem1/classes/class-15/). Runnable tests may fail at the early checkpoints; written Test paragraphs alone are insufficient.

| Checkpoint | Recorded evidence | Deadline result |
| --- | --- | --- |
| Spec 5, 9 October 23:59 | [19073c0](https://github.com/rajmodi8905/cs437-Last_3_Brain_Cells-hack/commit/19073c0) contains five statements at 19:13 IST, with user evidence, but explicitly says executable tests are pending | Five-statement component on time; complete milestone missed |
| Spec 10, 16 October 23:59 | Latest pre-deadline snapshot still has five statements and no executable tests. [92b0a3a](https://github.com/rajmodi8905/cs437-Last_3_Brain_Cells-hack/commit/92b0a3a) expands to fifteen on 19 October at 18:10; [b481f54](https://github.com/rajmodi8905/cs437-Last_3_Brain_Cells-hack/commit/b481f54) first adds tests at 23:06 that day | Missed; current specification/test artifacts are later completion |
| 27 October | At least eight of fifteen statements must be green, implementation merged through reviewed PRs, and the app runnable from README | Reviewed implementation and passing main CI already exist; fresh-checkout evidence and setup repair are documented below |

No on-time failing-test run is claimed for 9 October. A newly reproduced failure in the current setup workflow is evidence of the present repair, not a reconstruction of that earlier deadline.

## Reviewed and merged implementation

- [PR #4](https://github.com/rajmodi8905/cs437-Last_3_Brain_Cells-hack/pull/4): foundation/persistence, approved by two reviewers and merged on 21 October.
- [PR #6](https://github.com/rajmodi8905/cs437-Last_3_Brain_Cells-hack/pull/6): integrated local engine, PWA and tests, approved by `chaitanyachaudhary30` and `Nakshatra1967` at exact head `6f44d6f8ce269922d2cdda06fa2022fade60de45`, then merged on **25 October at 12:43 IST**.
- Reviewed `main` merge: `6a96bc0dce76a8297253b3cfced5dc2a74d8bc2d`. [Main CI run 40171974638](https://github.com/rajmodi8905/cs437-Last_3_Brain_Cells-hack/actions/runs/40171974638) succeeded: **44 fast tests, 7 browser tests and 9 actual-model tests**. The PR CI also succeeded.
- [Saved review/CI metadata](2026-10-26/review-and-main-ci.json) records the actual review states, exact revisions and completed run.

Main has an active ruleset requiring a PR and two approvals. This follow-up uses `raj_final` and a new PR; it does not push directly to main or bypass review. The extra setup/coverage changes are not represented as merged until that PR actually merges.

## Statement-by-statement evidence

The conservative merged minimum counts **S1, S4, S5, S7, S9, S10, S11 and S14: 8/15**. Their implementation and existing tests reached main through the reviewed PRs above and passed main CI. All eight are repeated by the current verification. Stronger checks for four other statements are added in this follow-up and are excluded from that minimum. The reference environment is documented desktop Chromium, not a physical-phone claim.

| ID | Result and counting | Executable evidence |
| --- | --- | --- |
| S1 | Green; counted | [Repository tests](../../tests/storage/repository.test.ts), [save/reopen UI](../../tests/e2e/library.spec.ts), [all-six-kind exact-byte reopen](../../tests/spec/storage-contracts.test.ts) |
| S2 | Green candidate checks; excluded from merged minimum | [Combined type/status filters, stable ordering and rename](../../tests/spec/storage-contracts.test.ts), real rename/duplicate-title UI |
| S3 | Green candidate checks; excluded from merged minimum | [Queued/processing/ready deletion with all stores and late publication](../../tests/spec/storage-contracts.test.ts), [stale generation tests](../../tests/storage/integration.test.ts) |
| S4 | Green; counted | [Inert extraction and URL tests](../../tests/engine/capture.test.ts), [actual controlled HTTP capture/fallback](../../tests/e2e/library.spec.ts) |
| S5 | Green; counted | [Duplicate-title/missing-source UI](../../tests/e2e/library.spec.ts), [actual offline PDF page/audio seeking](../../tests/acceptance/offline.spec.ts), independently mapped corpus locations |
| S6 | Green candidate checks; excluded from merged minimum | [All-format byte/hash/metadata transfer](../../tests/spec/storage-contracts.test.ts), [independent browser-profile export/restore](../../tests/e2e/library.spec.ts), malformed archive tests |
| S7 | Green; counted | [Asset progress/integrity/cache tests](../../tests/engine/assets.test.ts), [actual offline cache and missing-model repair](../../tests/acceptance/offline.spec.ts) |
| S8 | Automated extraction passes; not counted as fully green | [Actual OCR/PDF/model tests](../../tests/acceptance/extraction.spec.ts); the 120-second reference-phone target is unmeasured |
| S9 | Green; counted | [Actual S9 fresh 30-item regression](../../tests/acceptance/retrieval.spec.ts), [ranking boundaries](../../tests/engine/ranking.test.ts) |
| S10 | Green; counted | [Actual S10 text-free images and sampled silent-video scenes](../../tests/acceptance/retrieval.spec.ts) |
| S11 | Green; counted | [Actual decoding/transcription](../../tests/acceptance/extraction.spec.ts), [S11 independently annotated media intervals](../../tests/acceptance/retrieval.spec.ts) |
| S12 | Green candidate checks; excluded from merged minimum | [Real offline indexing interruption and retry](../../tests/acceptance/recovery.spec.ts), [repository generation/recovery tests](../../tests/storage/integration.test.ts) |
| S13 | Automated browser checks pass; not counted as fully green | [Responsive/offline UI](../../tests/e2e/library.spec.ts), [keyboard and reduced motion](../../tests/e2e/accessibility.spec.ts); physical installation/keyboard/safe-area checks remain |
| S14 | Green; counted | [Actual offline multimodal processing/search/source opening and external-request rejection](../../tests/acceptance/offline.spec.ts) |
| S15 | Automated policy/accessibility checks pass; not counted as fully green | [Direct/first-use policy navigation](../../tests/e2e/accessibility.spec.ts), [automated accessibility](../../tests/e2e/axe.spec.ts), offline routes; final team policy/hosting review remains |

[Machine-readable coverage registry](../../tests/spec/coverage.json) maps every statement to real suites. `npm run check` validates registry completeness only. It does not turn a file-path check into a behavioral pass. `npm test` runs the storage, browser and actual-model assertions. Controlled vectors are used for storage/ranking invariants, not as evidence of semantic retrieval.

The corpus is already consumed regression data. Its original miss, subsequent corrections and frozen query/model policy remain in [retrieval evidence](retrieval.md). Passing it is not an estimate of general student-query accuracy.

## Stranger-from-README verification and setup repair

A new remote clone of main was created with this candidate's tracked changes applied. It started without `node_modules`, `.models`, generated `public/runtime` or `asset-manifest.json`. No existing project model cache was copied. npm's registry cache and the machine's installed Playwright browser were available; this is not a claim of a new physical laptop or fresh operating system.

Commands actually exercised on Node 24.22.1:

```bash
npm ci
npm run models:download
npm run check
npm run test:fast
npx playwright install chromium
npm run build
npm run test:browser
npm run test:acceptance
```

The published setup script failed when the generated manifest did not exist. The fix adds a `premodels:download` lifecycle step and puts build before model download in the README's normal test sequence. CI deliberately downloads models before its first build, guarding the direct-after-install path. The fresh clone fetched and SHA-256-verified all public model/OCR files without an API key.

The baseline failure was independently reproduced using the exact published package/downloader in an otherwise empty directory. It exited nonzero for the missing manifest. The candidate download then completed from the fresh checkout. [Red/green setup evidence](2026-10-26/setup-regression.json) records the distinction.

**Current fresh-checkout result:** **50 fast tests in 14 files, 8 browser tests and 10 actual-model tests passed**. No failed or skipped browser/model cases; actual-model runtime 8.3 minutes. All twelve fixed targets ranked first and the three unrelated queries returned no result in each independent library run. Automated accessibility found no violations in its tested states. Type/lint/product/coverage checks and production build also passed.

Raw dated reports are kept under [2026-10-26](2026-10-26/README.md). No test run or peer approval is invented, and no physical-device result is inferred from desktop emulation.

## Remaining gates

The 27 October half-green checkpoint does not require pretending that all final-release work is complete. Physical iPhone/Android/Safari testing, the reference-phone performance target, final policy/hosting review and any required later inter-group reviews remain. The new follow-up PR needs its required human reviews before merge. The earlier missed deadlines remain missed in this audit.
