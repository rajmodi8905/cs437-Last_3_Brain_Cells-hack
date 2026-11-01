# Release integration checkpoint, 31 October 2026

Raj authorized integrating the outstanding landing fixes and device/release preparation, publishing the review candidate and preparing Android validation. The working branch is `raj_all_fixes`, updated normally from reviewed main `209b8028e72c00530f60093f56510cea71a0d6d1` (Chaitanya's PR #19). The original local changes and draft were preserved before updating; no history was rewritten.

Nakshatra's PR #24 was still open at head `dc782e799be9118048858669b36a6ebdcd2ae926`, with changes requested, during this checkpoint. Its fixes are not included or represented as tested here. After it merges, repeat its failure reproductions and affected storage/extraction/full acceptance checks on the combined main. No teammate branch was modified.

## Changes under review

- First-use onboarding follows actual route entry: policies remain accessible and the welcome dialog acquires focus when entering the library.
- The landing example has Pause/Resume, observes reduced motion and remains visible after state changes. Section links account for the actual sticky header height.
- Local device snapshots retain source/build/fixture identities and use verified HTTP/1.1 HTTPS. A release artifact checker rejects incorrect paths, altered runtimes, QA files, keys, model binaries and symlinks.
- A manual-only release workflow defaults to artifact preparation. No workflow was dispatched and no host, Pages setting or deployment was changed.
- Model cleanup uses the existing worker disposal message with a two-second bound. Actual offline WASM text/vision disposal/reopen coverage and the preserved update/offline-original regression accompany it.
- The [Android runbook](../implementation/android-validation.md) prepares the confirmed iQOO Neo9 Pro round. It records browser and installed mode separately. No Android result is claimed.

The optional WebKit configuration and existing standalone diagnostic are preserved from the earlier work. No WebKit investigation or rerun was performed during this integration. The known native development-WebKit failure remains documented in the [earlier evidence](2026-10-29-release-preparation.md); successful iPhone observations do not erase it.

## Validation

Environment: Node 24.22.1 on the available Apple M4 Mac; existing pinned dependencies and actual cached model assets. Browser plugin absent, so the repository's Playwright Chromium workflow was used. This is not a fresh operating system or new physical-laptop claim.

| Check | Observed outcome |
| --- | --- |
| TypeScript, ESLint, product restrictions and S1-S15 registry structure | Passed; registry structure alone is not a behavioral pass |
| Formatting | Passed |
| Fast suite | 80 passed across 18 files; no failures/skips |
| Production Chromium browser suite | 27 passed in 42.9 seconds; no failures/skips |
| Actual-model acceptance | 11 passed in 7.7 minutes; no failures/skips, including offline WASM text/vision disposal and reopen |
| Root production build and artifact inventory | Passed; 43 files, 110,123,720 bytes |
| Repository project-path build and artifact inventory | Passed; 43 files, 110,124,200 bytes |
| Project-path phone-width smoke | At 390 px, actual PDF rendering before model setup passed online and after offline reload; direct Privacy reload also passed offline, with no page/console errors |
| Retrieval freeze | All nine pinned input hashes match |
| Workflow syntax and local document links | Passed |
| Final render inspection | Desktop 1440 px and phone 390/320 px: correct identity, no blank page/framework overlay/horizontal overflow or console/page errors; Landing to Privacy opens without onboarding |

Root artifact SHA-256: `6d7663f72eb5f515b878a804d70d9af4d770f8a47a2b5e821d1a43379c2149da`.

Project-path artifact SHA-256: `eed736c4838ba2bdbde357a852a50f31a8c4adc544edafd9e2a9a8740b32906d`.

Local logs, source/test hashes, visual JSON and inspected screenshots are retained outside public source under `/tmp/campus-oct31-*`. No skipped, interrupted or pending model run counts as a pass. The corpus remains consumed regression data, not an estimate of general retrieval accuracy.

Each S9/S10/S11 run processed all thirty originals without processing failures. All twelve required targets ranked first across the three runs; every fixed negative returned no matches. This repeat used the real WASM backend and unchanged frozen queries/thresholds. All 144 source/test/tooling hashes were recorded and checked unchanged through the integration; committing those files does not change their tested bytes.

## Remaining release gates

Required human reviews and normal merge; Nakshatra's fixes and combined retest; physical Android execution and remaining device/transfer/setup-interruption checks; final policy/host review and authorized deployment followed by hosted verification. Earlier measured iPhone processing and owner-confirmed installed-app checks are retained with their original build identities. No new physical iOS run, all-fifteen-green conclusion, peer-review approval or hosted pass is inferred from this checkpoint.
