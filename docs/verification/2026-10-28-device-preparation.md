# 28 October: local device preparation

Branch: `raj_oct28_device_setup`, created from current main `59756cc9aac759776dbb578b1f85d2822ad56d65`. This is preparation and implementation validation. Nakshatra and Chaitanya retain exploratory bug discovery/reporting/retesting.

## Current baseline

PRs #8 and #9 are actually merged, with successful PR checks. Current main's [CI run 40663915386](https://github.com/rajmodi8905/cs437-Last_3_Brain_Cells-hack/actions/runs/40663915386) is successful. The plan, issue form, shared materials and both tester handoffs are available on main. No open teammate bug reports were present when this work started.

## Prepared work

- `qa:device:prepare` typechecks and creates an isolated production snapshot, source/build/asset identities, downloadable synthetic fixtures, expected source references, temporary local TLS certificates and a blank physical-device record.
- `qa:device:serve` verifies source/snapshot integrity, certificate issuer/key/IP/expiry and serves the identified local HTTPS snapshot. It rejects changed builds and does not overwrite earlier sessions.
- [The runbook](../implementation/device-session.md) explains actual iPhone-owner actions, trusted HTTPS, download/setup distinctions, reference-fixture timing, physical evidence and cleanup.
- The actual prepared local session is under ignored `.cache/device-session-20261028/`. Its app has 47 hashed files, including four explicit QA public downloads/metadata files. Private keys and certificate configuration are outside its served app directory; the private directory is mode 0700 and both keys are mode 0600 on this Mac.

The prepared source records the main commit plus an input hash and honestly marks its local runtime/tooling inputs as changed. It does not claim these uncommitted changes are already reviewed main. Normal `dist/`, existing browser libraries and user model caches were preserved. No hosted deployment, OS/device certificate trust change or model download was performed.

## Actual checks

Environment: MacBook M4/macOS, Node 24.22.1, available OpenSSL and isolated Playwright Chromium. No physical iPhone was attached for this preparation; the user chose to connect it afterward.

| Check | Result |
| --- | --- |
| Before new implementation | Test suite failed setup for the missing device-session script; five cases did not run |
| First TLS integration attempt | Three certificate-verification cases failed while two other cases passed; root/server subject naming and issuer identifiers were corrected before preparing the retained bundle |
| Device-session integration after correction | Five cases passed: actual verified HTTPS identities, fixture transfer/no private-key exposure, app/runtime MIME, existing-session preservation and changed-build rejection |
| `npm run check` | Passed type/lint/product/spec mapping |
| `npm run test:fast` | 67 tests passed across 17 files |
| `npm run format:check` | Passed |
| Actual preparation command | Built the isolated PWA and generated 41 synthetic kit artifacts plus inventory, ZIP and expected source data; no inference weights downloaded |
| TLS client smoke | HTTPS 200, generated root verified by that explicit client; no trust-store installation |
| Isolated browser smoke of the retained HTTPS snapshot | Correct title, secure context and service-worker control; actual note save, reload, offline exact-original opening and offline Privacy Policy loading passed; zero page errors |

The browser smoke used a process-local leaf-SPKI allowlist; it does not establish that Safari or a phone trusts this root. A separate Node client validated the certificate against its explicit CA. Cache Storage, IndexedDB and WASM availability were observed only in this laptop browser. No capability flag is treated as successful phone inference.

The local HTTPS server was stopped after validation. The snapshot/certificates/blank notes remain locally for the next session. Private material and generated outputs are ignored and excluded from public source changes.

## Remaining before marking phone statements green

1. Device owner connects/unlocks the iPhone and records exact iOS/Safari versions.
2. Confirm network reachability and deliberately configure temporary certificate trust, or authorize an alternative hosted HTTPS preview.
3. Execute actual S8 timing/provenance and S13 installed-PWA/keyboard/safe-area/zoom/playback/offline checks; record failures honestly.
4. Complete S15's final policy/hosting review against the actual chosen deployment.

No phone result, all-fifteen-green claim, UI revamp, deployment or new model-accuracy result is asserted here. Models, thresholds, original fixtures and application `src/` code did not change. Actual-model acceptance was not repeated for local QA infrastructure; the existing successful main CI remains baseline evidence only.

## Physical iPhone session, 28 October, following preparation

Device: physical iPhone 17, iOS 27.0.1 (24A446), Safari Version/27.0.1. The owner enabled Web Inspector and personally installed/trusted the temporary local root. No Developer Mode was enabled. Inspection used Mac Safari through USB. The phone's user agent masks the OS as 18_7; the Safari Version and device-reported OS were recorded separately.

### Transport correction and tested build

The original Vite HTTP/2 HTTPS preview produced Safari's “network connection was lost”. A simple HTTP/1.1 HTTPS probe used the same certificate, and the HTTP/1.1 production preview then opened successfully on the real phone, confirmed by the owner and inspector. This identifies a working transport for this session; it is not a claim that all Safari HTTP/2 connections fail.

The QA server now attaches Vite's documented preview middleware to Node's HTTP/1.1 TLS server. Certificate verification stays enabled. A new regression failed first (`h2` negotiated), then passed (`http/1.1`). A second new test first failed for the missing certificate-reuse option, then passed. `--certificate-from` reuses an unexpired, matching server certificate and public root for a newly identified build without copying the root signing key, installing trust or extending expiry.

Tested snapshot: ignored `.cache/device-session-20261028-http1/`, source commit `59756cc9aac759776dbb578b1f85d2822ad56d65`, changed runtime/tooling inputs honestly recorded, input SHA-256 `b32ce47a92228bc21aea1d5dea48b649f9499f6a35ce98a30530ea2867f90ece`. There are 47 hashed app files. The app bundle/model policy is unchanged from the earlier snapshot; the new identity includes the QA transport tooling. Old snapshots and notes were retained. The same owner-trusted certificate was reused.

### Observed results

All results below used the production app, real extraction/models and its actual local library. Synthetic fixtures were staged before disconnecting networking, then selected through the real file form using the inspector; this does not establish a physical Files-picker or keyboard pass. No mocked embeddings, transcripts or search responses were installed.

- Owner completed the 445.2 MB setup and then verification. The UI reported Assets verified. The inspector confirmed a secure context and controlling service worker.
- A synthetic note was Ready by the first check 8,656 ms after Save. This is an upper bound, not exact indexing time. “Where is our adviser appointment?” retrieved “Meet the mentor at the north library entrance on Tuesday afternoon.” The original viewer displayed that exact saved note.
- Five agreed image/PDF fixtures were processed independently while `navigator.onLine` was false, after the owner disabled Wi-Fi and mobile data. Timers ran from Save activation until the corresponding production item row reached Ready, using `performance.now()` and a MutationObserver. Models were already set up; the embedding model was warm from the note, and the JPEG was the first OCR case.

| Fixed fixture | Save to Ready | Outcome / network state |
| --- | ---: | --- |
| `sample-01.jpg` | 2,235 ms | Ready, offline |
| `sample-02.png` | 1,438 ms | Ready, offline |
| `ocr.webp` | 1,394 ms | Ready, offline |
| `sample-03.pdf` | 307 ms | Ready, offline |
| `scanned.pdf` | 864 ms | Ready, offline |

These five timing measurements satisfy the 120-second reference-phone timing target for these particular small fixtures. They do not establish maximum-size-file performance. Read-only inspection found real normalized 768-dimensional vectors. The PDF's three text segments retained their independent page numbers, including the group-size instruction on page 2; the scanned PDF contained the badminton tryouts OCR text.

- Offline PDF search for “How many classmates can work together for CS437?” ranked `sample-03` first with its group-size excerpt and Page 2 location. Its original PDF rendered to a nonempty 892 × 1263 canvas. The page-number input was not separately recorded, so this is result-provenance plus rendered-source evidence rather than a separate physical pagination check.
- “Find the red backpack on the table” returned only `sample-07` as Visual content. That image reached Ready in 1,342 ms. Safari reported online again by then, so its processing is not counted as an offline measurement.
- MP3 `sample-09` reached Ready in 6,828 ms, M4A `sample-10` in 4,617 ms, spoken MP4 `sample-11` in 8,245 ms, and silent MP4 `sample-12` in 1,876 ms. These stages reported online and are local-inference compatibility evidence, not proof of offline media processing.
- The chess-orientation query returned the MP3 transcript with a 0:02–0:08 source interval. An initial inspection showed currentTime 0; a repeated opening showed 2.62 seconds, stable on a later inspection. No seek implementation was changed. Repeated physical playback/seeking remains a follow-up; the initial discrepancy is preserved here.
- The theatre-rehearsal query returned the spoken MP4's transcript with its 0:02–0:10 interval. The original video reported currentTime 2.89 seconds, duration 12.75 seconds and loaded metadata without a media error. Playback itself was not exercised.
- After the owner disabled networking again, the yellow-umbrella/bicycle query returned silent `sample-12` at the sampled 0:05–0:07 scene while `navigator.onLine` was false.
- Before restart, read-only database inspection found 11 Ready items and 26 normalized 768-dimensional segments. All ten imported file originals matched the staged source files by SHA-256. The remaining item was the synthetic note.
- A full Safari page reload with networking disabled preserved all 11 Ready items, a secure context and service-worker control. A fresh post-reload embedding search retrieved the adviser note, and its exact original opened offline. Privacy Policy and Terms and Conditions both loaded offline. No horizontal overflow was observed in the library and Terms DOM checks; this is not a complete physical layout/keyboard review.
- Inspector-only requests for missing OCR debug source maps received offline 503 responses. Processing nevertheless completed. These are explained diagnostic errors; a clean-console claim is not made.

The phone owner was told the physical session was finished and that they could disconnect. No installed-PWA, full 30-item physical evaluation, offline media-processing, physical playback, keyboard/zoom/orientation, backup transfer or final policy-review pass is inferred from these results.

### iOS 26 compatibility scope and local checks

An isolated iPhone 17 simulator running the installed iOS 26.5 runtime rendered the actual first-use screen over trusted local HTTPS. This is a render smoke only. It is not a physical-phone benchmark, an inference/search pass, or evidence for iOS 26.0. No application minimum-version restriction was added, and the existing WASM fallback was preserved.

After the transport changes: seven device-tooling cases passed; all 69 fast tests across 17 files passed; `npm run check`, `npm run format:check` and whitespace checks passed. Preparing the identified snapshot completed TypeScript and the production PWA build. All nine frozen retrieval hashes remain unchanged. Full desktop real-model acceptance was not rerun for this tooling-only change; actual phone inference above is separate evidence. No application source, dependency lockfile, retrieval thresholds or fixtures were changed. No staging, commit, push, PR, merge or hosted deployment occurred.

The local HTTPS and fixture servers were stopped after the session, and the isolated iOS 26.5 simulator was shut down. The prepared snapshots and phone library were retained. The owner can remove the temporary root profile in Settings → General → VPN & Device Management when no longer needed.
