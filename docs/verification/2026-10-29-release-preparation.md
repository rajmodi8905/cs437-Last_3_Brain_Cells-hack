# Release preparation, 28–29 October 2026

Working branch: `raj_oct28_device_setup`, based on main `59756cc9aac759776dbb578b1f85d2822ad56d65`. These are local, uncommitted changes. No push, PR, merge, hosted deployment or remote configuration change is claimed.

## What changed

- The certificate-supplied `qa:https` helper now uses the same HTTP/1.1 TLS transport that resolved the actual iPhone preview failure. Both QA paths have real TLS/ALPN checks. Existing session certificates may be deliberately reused for a new identified snapshot without copying the root signing key or changing trust/expiry.
- `release:check` validates a production artifact's expected runtime bytes/hashes, base paths, PWA scope/icons, precache references, size and file inventory. It rejects test downloads, certificates, model binaries, unexpected files and symlinks. Source review still matters: a file inventory cannot certify the privacy of intentionally authored content.
- The manually dispatched release workflow runs verification and prepares a project-path artifact. `publish=false` is the default. There is no automatic publication on push/merge. Repository/environment setup, policy approval, required reviews and publication authorization remain separate actions. The CI workflow now also checks formatting and the root production artifact.
- A production browser regression performs an actual service-worker update. It verifies the app waits for the user, the update button reloads only after activation, and the exact original survives both update and offline reopening.
- `ModelClient.dispose()` uses the worker's existing model-release operation before termination, with a two-second bound. It rejects interrupted requests, shares simultaneous cleanup, prevents requests being sent during cleanup and does not retry a failed disposal in a new worker. Five unit cases cover the client lifecycle. This did **not** fix the native development-WebKit GPU crash described below.
- Additional WebKit coverage has its own config/command. Its setup mirror serves the same pinned bytes directly because that engine cannot synthesize a 302 in `route.fulfill`. Production asset URLs and download behavior are unchanged. The WASM acceptance test runs actual text/image embeddings offline, disposes/reopens the model and compares repeated query vectors.

The frontend modules/service contracts, embedding model revisions, weights, quantization, input prefixes/chunking, source-location policy, thresholds, corpus and index version remain unchanged. All nine original retrieval-freeze hashes match. The only application source change is the bounded client cleanup; an unsuccessful experiment to explicitly destroy the GPU device was removed. No UI redesign was performed.

## Actual evidence

Environment: MacBook M4/16 GB, Node 24.22.1; Chromium 156 and additionally Playwright WebKit 27.2. That WebKit build is not the installed Safari version, iOS 26.5, or a physical phone. The [physical iPhone session](2026-10-28-device-preparation.md#physical-iphone-session-28-october-following-preparation) remains separate evidence of the preceding app build.

| Check | Outcome |
| --- | --- |
| Final TypeScript/lint/product/coverage mapping and formatting | Passed |
| Final fast suite | 78 passed across 18 files, no failures/skips |
| Final Chromium UI and actual-model suites | 12 UI tests and 11 actual-model tests passed, no failures/skips |
| Root and repository-project-path production builds | Both passed artifact validation: 43 public files each |
| Actual service-worker update and offline preserved original | Passed in Chromium; also passed in WebKit |
| Project-path save/reload/exact original/offline policy smoke | Final candidate passed in Chromium and WebKit at 390/768/1440 px, with zero page errors |
| Final WebKit UI suite | 12 passed, no failures/skips |
| WebKit real text embedding/search and unrelated-query rejection | Passed, using WebGPU |
| WebKit explicit same-model WASM text/vision, normalized vectors and disposal/reopen | Passed, with network disabled after setup |
| Actual iOS 26.5 simulator | First-use render only; further inspection blocked by the Mac Safari inspection tool timing out |

The three original 30-item suites are consumed-corpus regressions, not held-out accuracy. The final candidate's S9/S10/S11 runs each processed all thirty items, returned their required targets at rank one and rejected all three negatives. The complete actual-model suite passed in 6.2 minutes. No pending/interrupted/failed run is counted as passed.

### Failures preserved

- The new artifact suite initially failed because its checker module did not exist. A first real-build check incorrectly assumed absolute Workbox precache URLs; the checker was corrected to accept scope-relative URLs and validate their resolved paths.
- Initial update/project-path smoke scripts used an overly exact Title locator. The corrected update test then exposed a test navigation race while evaluating during the intended reload. It now waits for the future DOMContentLoaded event before reading the new document. These were test mistakes, not product bugs.
- Early extra-engine attempts were interrupted, used a config with the wrong working directory, or shared helper-server lifetime with another test run. They are not compatibility results. Subsequent suites run sequentially.
- WebKit emits the deliberately blocked webpage fixture's CORS rejection through `pageerror`, whereas Chromium does not. The fixture test permits only that specific fixture URL/access-control diagnostic; unrelated errors still fail, and fallback/source/probe assertions remain intact.
- A separate Playwright WebKit GPU/offline-navigation case repeatedly crashed its native WebContent process after processing, when returning from the harness to the production source viewer. Sanitized crash reports show SIGSEGV in `InspectorInstrumentation::instrumentingAgents` / `GPUDevice::contextDestroyed` during worker context destruction. Graceful session release alone and a later explicit GPU-device-release experiment did not resolve it. The latter was removed; the original model worker/freeze was restored. Do not report the native GPU case as passing, silently skip it or describe the app as compatible with every Safari version.

## Known blocker and reproduction

```bash
npx playwright install webkit
npm run models:download
npm run build
npm run test:webkit -- tests/acceptance/offline.spec.ts
```

Use the final source checkout and pinned dependencies. This command is expected to reproduce the observed development-WebKit failure, not a promised pass. Capture the browser's actual version and crash/console output. The test remains enabled. Its setup uses real pinned bytes; the GPU and WASM paths are not substituted for each other. The successful physical iPhone Safari session is useful evidence but does not explain or erase this separate failure.

Next investigation: recover Mac Safari Web Inspector when the owner is back, distinguish shipping Safari/actual iOS behavior from this development-engine crash, and investigate a tested runtime or upstream-browser remedy. Do not change the model, lower acceptance thresholds, hide the failed case or claim iOS 26 support from a newer desktop engine. The verified WASM path is fallback evidence, not proof that default WebGPU succeeds.

## Deployment and remaining gates

See [deployment preparation](../implementation/deployment.md) for the candidate host's documented limits/logging, exact build commands, manual workflow, hosted verification and rollback. No host was selected or configured remotely. The Privacy Policy remains factual about that unselected state; final host-specific wording and team approval still need completion before publication.

Still requires separate evidence: actual installed iPhone/Android PWA, physical keyboard/safe-area/zoom/file-picker/playback, repeated media seeks (including the initial iPhone audio-position discrepancy), cross-device manual transfer, exact iOS 26 inference, tester retests and final hosting/policy review. No all-fifteen-green or deploy-ready claim is made while these gates and the WebKit failure remain.

## Artifact identities

The final normal root artifact has 43 files / 110,104,364 bytes, SHA-256 `c21afffbbb09443e4ede475c935f7b856858ad3a93105fcb9acf6c4e29979912`. The project-path artifact has 43 files / 110,104,844 bytes, SHA-256 `ebecfab93dc8288252fd3956e8dbff60db5c6d236a0b9fdd592d438a38ceeb7a`. Both use asset-manifest SHA-256 `b1105d0d38961eefda12c2310c141c026eda01f092c325bf73bdfa313c9c27e9`; the largest file is the 32,232,419-byte ffmpeg WASM runtime. Local validation does not establish hosted MIME types or policy approval.

Final raw local results are retained under ignored `.cache/`: `oct29-final-all.log` (78 fast / 12 UI / 11 actual-model), `oct29-webkit-ui-final.log` (12 UI), `oct29-project-path-smoke-final.json`, and root/project artifact JSON reports. Type/lint/format, whitespace and workflow YAML syntax checks passed. Workflow execution on GitHub and hosted verification remain Not run. No task-owned local test server or simulator is intentionally left running.

## 29 October continuation with the iPhone available

The earlier sections describe the completed automated run. This continuation adds shipping Safari, simulator and device-owner evidence. Branch `raj_oct28_device_setup`, HEAD `59756cc9aac759776dbb578b1f85d2822ad56d65`, and all application sources remain unchanged from that candidate. Nothing was staged, committed or published.

### Browser crash isolated from the application

The new [standalone diagnostic](../../scripts/reproduce-webkit-teardown.mjs) creates and terminates two plain WebGPU workers per case. It uses no Campus Recall code, models or library. On pinned Playwright WebKit 27.2, the no-listener control survives and reloads; both a property error handler and an event listener crash the page. The command deliberately returns exit code 1 for these failures. A missing GPU is also a failure, never a passing control.

```bash
node scripts/reproduce-webkit-teardown.mjs
# Manual comparison in a browser with its inspector connected:
node scripts/reproduce-webkit-teardown.mjs --serve
```

This matches the worker/error-listener conditions and native stack addressed by [WebKit change 323630](https://commits.webkit.org/323630@main), associated with [bug 327093](https://bugs.webkit.org/show_bug.cgi?id=327093). The installed ONNX runtime attaches an `onuncapturederror` handler in `lib/wasm/jsep/backend-webgpu.ts`. This is strong evidence for the upstream browser diagnosis, not proof that the pinned Playwright binary contains the fix. The registry still returned Playwright 1.64.1 during this run. No dependency, model, worker, threshold, query or index-policy change was made. The original failing acceptance case remains enabled.

### Shipping Safari 27.0.1

Native Safari inspection worked for the local desktop page. The real pinned models were verified through the existing checksum-addressed local setup mirror. No model output was mocked.

- Three WebGPU query/dispose/reopen rounds produced 768-element vectors with norm `1.0000000038801489`, without a native crash.
- The actual production pipeline processed JPEG, text PDF, M4A, spoken MP4 and silent MP4 to Ready. Recorded laptop times were 3,627 / 287 / 5,629 / 6,055 / 2,355 ms respectively. These are laptop observations, not S8 phone timings.
- The badminton query returned the correct original image. After engine disposal and navigation to the production app, its five saved items remained visible. Semantic PDF search returned sample-03, and the viewer opened page 2 of 3 with the original page rendered.

The console contained a favicon 404 and the previously known missing OCR source-map 503. Neither is an inference failure; neither is omitted from the observation. This desktop run did not disable OS networking and is not a new full offline-acceptance pass. Browser plugin unavailable; Playwright and native CUA were used. Native screenshots were reduced Stage Manager thumbnails, so they are not offered as detailed layout proof.

### Physical installed iPhone app: owner-confirmed checks

The wired paired device was iPhone 17 / iOS 27.0.1, build 24A446. The owner opened `https://10.7.46.5:4473` and confirmed that Campus Recall loaded. A fresh production QA snapshot was prepared with Node 24.22.1 at ignored `.cache/device-session-20261029-node24`, reusing the prior unexpired certificate. Source input hash: `439dc9336f95c1897e6a98bd9abd3040835d1c8a806aedeeca0112905905bcae`. The first preparation used the host's Node 26 and was superseded by this Node 24 build.

The following results are the owner's explicit replies to numbered physical instructions, not inspector-derived measurements:

| Physical check | Owner's reported result |
| --- | --- |
| Add to Home Screen and launch without Safari address bar | Installed app opens; saved library appears |
| Search chess audio, play, seek twice and reopen | All checks worked, including requested passage-position check |
| Play rehearsal video, seek twice and reopen | All checks worked, including requested passage-position check |
| Turn Wi-Fi/mobile data off, close/reopen installed app, search and open saved PDF | All checks worked |
| Type/save a note using the keyboard; choose a synthetic image/PDF through Files | All worked; no blocked controls |
| Portrait/landscape, pinch zoom, keyboard/safe-area controls and original opening | All worked; no blocked controls |

No new physical timing, original checksum, screenshot or exact cached-client bundle fingerprint was independently captured. These reports support the requested physical interactions, but do not establish every iPhone edge case or a byte-verified install of the fresh candidate. An update was requested if a banner appeared; its appearance was not separately reported. Initial audio-position uncertainty from 28 October remains in that earlier record; this is a successful owner-reported repeat, not a code fix.

Remote inspection initially reported Connecting/No inspectable contents. After the owner toggled Web Inspector, the installed app became a visible target. Its remote inspector opened a blank white window, also seen with the simulator inspector. No Developer Mode, trust-store change, certificate-warning bypass or forced Safari termination was used. The phone is no longer needed for this session. Temporary certificate trust remains under the owner's control and expires 4 November.

### iOS 26.5 simulator: actual inference

The existing isolated iOS 26.5 simulator ran a self-starting harness using the compiled acceptance modules and the same verified pinned bytes. This avoided the blank remote-inspector frontend; it did not replace inference with fixtures. Two default-backend text/image/dispose/reopen rounds selected WASM, each returning 768-element text and image vectors. Norms were `0.9999999844418002` and `1.0000000003497795`. Combined text/image round times were 10,178 and 12,544 ms on the simulator, not physical-phone performance.

A new synthetic appointment note reached Ready; “Where is my adviser appointment?” retrieved that exact item and its unchanged original text. After disposal, the harness navigated back to the production library, which rendered in Simulator. This adds real iOS 26.5 WASM inference and retrieval evidence. It does not establish iOS 26.0, physical iOS 26 performance, WebGPU in Simulator or installed-PWA behavior there.

Local records: `.cache/oct29-webgpu-minimal-repro.json`, `.cache/oct29-native-safari.json`, `.cache/oct29-ios26-results.json` and `.cache/oct29-owner-confirmed-iphone.md`. The temporary simulator harness and native receiver are retained locally with those records. Full 78/12/11 and 12-WebKit-UI results above were not rerun or relabelled as new passes; this continuation changes only diagnostics and evidence.

Still open before final release: development-WebKit upstream-binary retest, Android/device matrix, interrupted setup and memory-pressure cases, cross-device transfer, teammate retests and final policy/host approval. The UI revamp remains the next separate planned package, with an approved reference/direction required. These successful checks do not make all fifteen statements or deployment unconditionally green.
