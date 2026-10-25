# Acceptance design and evidence

Status: acceptance design, with executable tests now in `tests/`. See [verification evidence](../verification/README.md) for current measured outcomes and remaining checks. The first held-out evaluation missed R4; it is preserved in the report. Subsequent runs of that corpus are regression evidence, not independent held-out evidence. Nakshatra supplies test tooling and storage/repository cases; Raj authors all UI/engine acceptance scenarios before their feature implementations. Chaitanya supplies content-review checklists. Raj owns the actual-model corpus and final evidence.

Read [SPEC](../../SPEC.md), [the plan](../../IMPLEMENTATION_PLAN.md), and [shared contracts](contracts.md). Every S1–S15 statement needs an automated test. Tests are independent: fresh library/profile/fixtures, no dependency on another test's execution order. Shared setup may preload verified public models; never share a previous test's private library as a shortcut.

## Commands to deliver

| Command | Required behavior once the scaffold exists |
| --- | --- |
| `npm run dev` | Start the documented development app |
| `npm test` | Run unit, browser, and actual-model acceptance suites; nonzero exit for failures or missing required assets |
| `npm run test:fast` | Run isolated unit/component checks during development |
| `npm run build` | Build the production static PWA |
| `npm run check` | Typecheck and lint without rewriting files |

README separately documents Node 24, `npm ci`, browser installation, and explicit model preparation/setup. There is no silent paid API fallback. Test setup must download the same pinned assets as the application, record their hashes, and make missing/corrupt assets explicit. Do not silently skip, mark pending cases as passed, or use a fake embedding adapter in actual-model acceptance.

Foundation tests can legitimately fail before downstream features exist. Record that state as incomplete, not green. Fast package checks may pass while the full suite remains red; CI and PR reports must distinguish them.

## 30-item retrieval library

Create twelve targets and eighteen distractors. Give original files generic names such as `sample-01.png`, not target answers. Expected item IDs are captured when originals are imported; expected pages/media intervals are recorded manually before running the pipeline.

All announcements, course rules, dates, and scenarios are synthetic demo/test data, not actual IITGN requirements or additional interviews. Visual fixture originals must be team-created or appropriately licensed with provenance. Do not present a synthetic fixture as Suhani's actual banner or Bhavya's chat. No AI-generated stock imagery is needed.

| Case | Target description | Fixed query | Expected source |
| --- | --- | --- | --- |
| R1 | Legible JPEG badminton tryouts demo banner | Find the badminton team registration announcement | Original banner image |
| R2 | PNG with fictional CS437 hand-in deadline | When do we hand in the CS437 project? | Original deadline screenshot |
| R3 | Three-page fictional CS437 PDF, group-size rule on page 2 | How many classmates can work together for CS437? | PDF page 2 |
| R4 | Note: “Meet the mentor at the north library entrance on Tuesday afternoon.” | Where is our adviser appointment? | Original note |
| R5 | Public static fixture snapshot about robot-building workshop registration | Find the sign-up page for the robot-building session | Saved text and original fixture URL |
| R6 | PDF page 2: “Written objections must arrive within seven calendar days.” | How long is the appeal window? | PDF page 2 |
| R7 | Text-free image showing a red backpack on a library table | Find the red backpack on the table | Original image, visual match |
| R8 | Text-free image showing a bicycle beside a basketball hoop | Find the bicycle beside the basketball court | Original image, visual match |
| R9 | Short MP3, clear spoken announcement about a demo chess orientation | Find the voice announcement about the chess orientation | Audio interval containing the announcement |
| R10 | Short M4A, clear spoken instruction about collecting a demo lab access card | Where was the recording about collecting the lab access card? | Audio interval containing the instruction |
| R11 | MP4 H.264/AAC; speech gives a demo theatre rehearsal location after the opening | Find the video explaining where theatre rehearsal is | Video spoken interval |
| R12 | Silent H.264 MP4, distinctive visual scene sustained across sample times | Find the video with a yellow umbrella next to a bicycle | Video sampled-scene interval |

R6's meaningful query terms must not appear in target text, title, filename, or metadata. R7/R8/R12 must not contain their answer description as OCR text, filenames, or user notes. They verify visual embeddings, not a textual shortcut. Speech targets' answer wording must not be supplied in filenames, captions, or metadata. R12's relevant scene must be visible at a five-second sample point; the app does not promise unsampled-frame coverage.

Distractors cover other sports/events, courses/semesters, forms, generic deadline/group-size words, unrelated notes, different coloured objects/scenes, and unrelated speech/video. Freeze exact contents, original hashes, page maps, and independently annotated media intervals before evaluation.

S9 checks R1–R6 in the top three distinct items, S10 checks R7/R8/R12, and S11 checks R9/R10/R11. Each suite independently builds the needed fresh library using actual processing. Different chunks from one file cannot fill several top-three item positions.

## Negative queries and calibration

Reserve these as acceptance negatives. Exclude corresponding subjects from every library item and its metadata:

- N1: Find the instructions for replacing a car's alternator.
- N2: Find the sourdough bread recipe I saved.
- N3: Show the hotel reservation for my Paris holiday.

All three require an empty result list and the no-relevant-result state. Assert state and IDs, not exact message wording. A no-result state must not assert the user never saved the item.

Build separate calibration originals/queries/negatives covering text, visual, and transcribed speech. Calibration must not reuse R1–R12 or N1–N3. Choose text/visual thresholds on that set using the deterministic procedure in Raj's handoff. Freeze thresholds, prefix policy, dimensions, model revisions, and input processing before acceptance. If acceptance fails, report it; do not tune repeatedly on the held-out answers while calling the result independent validation.

Controlled vectors/scores independently exercise below/at/above-threshold arithmetic, normalization, deduplication, and tie-breaking. They do not replace actual extraction/embedding/ranking tests.

## Automated scenario map

| SPEC | Required scenarios | Primary owner |
| --- | --- | --- |
| S1 | Each supported kind; save before models; durable restart; forced storage failure; original hashes | Nakshatra |
| S2 | Recent ordering/filter combinations; duplicate titles; rename preserves original and ID | Nakshatra (storage) + Raj (UI) |
| S3 | Delete queued/Ready/Processing items; no related records or late resurrection; idempotent repeat | Nakshatra + Raj |
| S4 | Allowed HTTP fixture; denied CORS/fetch; pasted text; imported inert HTML; oversized capture/truncation indicator | Raj |
| S5 | Seeded independently mapped sources, duplicate titles, PDF page, media interval, missing original, no substitute | Raj |
| S6 | Selected export; valid cross-profile restore; same-title distinct originals; hash duplicate; tamper/version/path/quota failure | Nakshatra |
| S7 | Explicit progress; interrupted download; missing runtime; verified complete cache; offline restart; repair state | Raj |
| S8 | Known-phrase JPEG/PNG/WebP, text PDF page 2, scanned PDF; actual OCR/embeddings; corrupt/encrypted/over-limit input | Raj |
| S9 | Actual R1–R6, negatives, top-three distinct IDs, empty query, thresholds, incompatible index | Raj |
| S10 | Actual R7/R8/R12, visual source locations, no text/metadata answer leakage | Raj |
| S11 | Actual R9/R10/R11, spoken phrase, original playback interval, near-silence, media limits | Raj |
| S12 | Stop/reopen during processing; retry after failure; stale claim rejection; no duplicate published generation | Raj + Nakshatra |
| S13 | Production PWA routes, shell/original offline reopen, widths 390/768/1440, keyboard/focus/reduced motion | Raj |
| S14 | Actual fresh private imports, all processing/search/view paths after setup, network assertions, missing-asset no-fallback | Raj |
| S15 | Privacy/Terms links, direct route reload, before setup, cached offline, factual implementation review, forbidden-copy/style review | Chaitanya (content) + Raj (pages, integration, checks) |

Each scenario uses real code for the behavior it claims. A seeded viewer test can prove source mapping independently; it does not prove ranking. A fixture adapter may prove UI event wiring; it does not prove the engine. Partial storage tests must not be reported as passing an entire integration statement.

## Time, quality, and network assertions

- After asset setup, each agreed small image/PDF/text fixture must become Ready within the existing 120-second target on the documented primary reference phone. Document fixture sizes. This is a target, not a measurement. Record failures honestly and distinguish it from full-length media performance.
- Media source seeking must fall within its manually annotated relevant interval, allowing two seconds at the edges. Do not compare the entire transcript to one exact generated string.
- Record warm/cold model state, indexing/query timing, failed jobs, ranks, device/browser/OS, thresholds, fixture hashes, and index version. Do not extrapolate laptop results to phones.
- For S14, finish setup first, monitor outgoing requests, then import fresh sentinel-bearing originals, process every modality, query, restart, and view. No actual outgoing core-path network request is permitted; cached reads and Blob URLs are local. Assert private sentinels do not appear in any request URL/body/log sent remotely.
- Check explicit model setup and webpage requests separately. They may fetch their allowlisted resource or chosen URL but must never attach unrelated content or queries. Missing assets during a private operation cause a repair state, not a remote fallback.
- Use the production build with service-worker behavior for offline tests, not only a development-server mock. Reopen with the same local browser profile/cache when testing restart.

## Physical-device matrix

Primary: MacBook M4/16 GB (Chrome and Safari), iPhone 17 (Safari and installed PWA), iQOO Neo9 Pro/8 GB (Chrome and installed PWA). Record the actual versions; “second latest iOS” is not a version number.

Compatibility: Moto G85/12 GB and HP Pavilion/16 GB with actual OS/browser recorded; use the gaming laptop as an additional check when available. Automated Chromium/WebKit and resized desktop screenshots do not establish physical-phone correctness.

Test phone keyboard open, landscape, safe areas, pinch zoom, touch, long filenames, empty/errors, media playback, setup interruption, offline launch, and a model/runtime reload. Use trusted HTTPS for secure-context capabilities; an HTTP LAN URL alone is insufficient for PWA/WebGPU acceptance. Do not deploy a preview without approval.

## Release report

Record the tested Git commit, model/runtime/asset revisions, fixture hashes, per-SPEC tests and outcome, actual commands, physical-device results, PRs/reviews, and unresolved failures. Update the report when the implementation changes. An unchecked box, old assistant completion message, policy page, or future schedule is not test evidence.
