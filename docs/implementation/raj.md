# Raj: core UI, local intelligence, integration, and verification

**Current release assignment:** follow [the completion and release plan](release-plan.md) for all further implementation, fixes, UI revamp, integration and release validation on `raj_final`. Nakshatra and Chaitanya own exploratory bug finding and issue reporting. The original implementation details below remain product context; they do not assign Raj a separate bug-hunting package.

23 October integration override: Raj requested `raj_final` from merged `main`. Preserve `Raj_setup`. The implementation and checks now exist; see [verification](../verification/README.md). The requirements below remain the handoff baseline.

Branch: existing `Raj_setup`; preserve its history and incorporate latest merged `main` normally. Read [team instructions](README.md), [plan](../../IMPLEMENTATION_PLAN.md), [SPEC](../../SPEC.md), [contracts](contracts.md), and [acceptance design](acceptance.md). Ask before staging/committing and publishing unapproved changes.

This chat implements Raj's package: all core UI/UX, viewers, routing, rendered policy pages, PWA behavior, and all AI/embeddings. Own `src/ui/`, `src/engine/`, `src/app/`, and the PWA assets/configuration. Nakshatra supplies storage/contracts; Chaitanya supplies content documents. Do not build substitute storage or their documentation package. Independent UI/engine work can start after the planning PR merges; production integration uses Nakshatra's merged foundation and reviewed Chaitanya content, following the agreed PR order.

## Checkpoint 1: verify the browser path first

1. Use the pinned model revisions and Transformers.js version in the plan. Verify the actual revision artifacts before constructing a download manifest; do not guess filenames or asset sizes.
2. Load EmbeddingGemma 2 q4 text and vision without the audio encoder. Verify actual normalized 768-dimensional text and image inference.
3. Verify quantized English speech transcription and single-thread ffmpeg audio extraction. Do not use paid/remote inference or a laptop service as a hidden phone fallback.
4. Test persistent asset reload offline, repeated sessions, and disposal. Check WebGPU first and same-model WASM on failure. Avoid retaining full decoder, ASR, and embedding allocations together.
5. Run on the MacBook M4, iPhone 17, and iQOO; record exact browser/OS versions, actual asset bytes, model/runtime configuration, time, and failure details. Use trusted HTTPS for phone PWA/WebGPU testing, not an insecure LAN URL. Any hosted preview/deployment requires approval.

Report feasibility blockers before making more promises. Smaller dimensions, a different model, dropping a modality, or requiring a laptop are contract/product changes, not silent optimizations. No device performance or test pass is established by this handoff.

## Checkpoint 2: product UI, viewers, and PWA

Read and apply [Emil Kowalski's Design Engineering](https://github.com/emilkowalski/skills/blob/main/skills/emil-design-eng/SKILL.md) and [Mobile Native](https://github.com/emilkowalski/skills/blob/main/skills/mobile-native/SKILL.md) skills before UI implementation. Record the source revision used. User restrictions override decorative examples.

### Design and interaction rules

- Build a search-first personal library: light neutral solid surfaces, dark text, restrained blue accent, and system fonts. Desktop has navigation, results, and source preview; phones use readable cards and a full-screen viewer.
- Use rectangular buttons with at most 6 px radius, labelled SVG icons, real counts, and real progress only. Unknown progress stays indeterminate.
- No purple/decorative gradients, pill buttons, fake reviews/testimonials/metrics/customer counters, vague hero copy, emoji icons, AI-generated stock photos/promotional illustrations, generic AI marketing copy, custom cursors, parallax, scroll-jacking, or decorative scroll reveals.
- No em dashes in product-authored UI/policy copy. Preserve imported documents, filenames, and interview quotes exactly. Do not auto-populate a real library with synthetic content.
- Search and keyboard navigation update immediately. Use only useful 100–160 ms feedback, respect reduced motion, and avoid a decorative motion dependency.
- Gate hover by capability; use dynamic viewport units/safe areas, at least 16 px phone inputs and 44 px primary touch targets. Preserve zoom, visible focus, selectable content, and real-phone keyboard/landscape behavior.

### Routes and implementation sequence

| Route | Required behavior |
| --- | --- |
| `#/library` | Recent real items, type/status filtering, title editing, saved/processing state, original opening, delete |
| `#/search` | Submitted query/type filter, progress, distinct source results, no-match and actionable error states |
| `#/add` | File picker, pasted note, public-URL capture/manual fallback, limits and conversion guidance |
| `#/settings` | Model download/progress/readiness, real storage estimates, selected export/import, policy links |
| `#/privacy` | Chaitanya's reviewed policy content, safe rendering and direct/offline access |
| `#/terms` | Chaitanya's reviewed terms, with the same access guarantees |

1. Build tokens, shell, hash routing, accessible controls, and layout from the shared types. Fixture adapters may support isolated tests before storage merges; never include fake search results in production.
2. Connect save to the real repository. Confirm only after the durable transaction resolves; queued/failed originals remain visible and usable before models exist.
3. Implement direct webpage capture with omitted credentials and an abort timeout. On blocked/failed extraction offer pasted text or inert HTML/PDF input. A URL-only item must not claim page contents.
4. Implement recent items, filters, rename/delete, retries, and search/result cards. Distinguish missing model assets, engine errors, no matches, and unavailable originals. Never present similarity as a confidence percentage or generate a visual caption.
5. Build image zoom, PDF.js page opening, plain-text note/snapshot views, and audio/video seeking after metadata loads without forced autoplay. Load by item UUID and revoke temporary object URLs on teardown.
6. Build setup/progress/storage/backup controls and first-use information. No account wall, fake consent record, marketing landing page, or hero is required.
7. Implement PWA manifest/icons, shell and policy caching, install guidance, and update notification. Do not force reload while saving/processing. Model/runtime setup integrates with this cache rather than a separate PWA implementation.
8. Integrate Chaitanya's four content documents from `docs/product/`; Raj implements rendered policy pages, links, routes, accessibility, and offline behavior. Before content arrives, draft/test components against explicit fixtures without claiming policies are final.

### UI and policy verification

Write interaction tests before features. Check repository-driven success/failure, queued/failed item visibility, UUID-based source opening with duplicate titles, PDF pages/media times, safe HTML/excerpts, and object URL teardown. Check widths 390/768/1440, long titles, empty/errors, keyboard/focus/reduced motion, zoom, and physical-phone keyboard/safe areas.

Verify both policy routes from Settings and first use, on direct reload, before model setup, and offline from the production build. Review their text against actual implementation; policy wording does not prove S14. Scan owned product copy/styles for prohibited patterns, without editing user originals.

Report UI findings in the skills' `Before | After | Why` table. Distinguish screenshots/emulation from real-phone evidence. You own all automated UI/PWA/source-viewer tests; Chaitanya contributes content review/checklists, not these implementations.

## Checkpoint 3: asset manager and engine bridge

- Implement the exact EngineClient and worker protocol. Reuse the storage port supplied by Nakshatra; do not create a second database or unpublished schema fork.
- Asset manifest contains pinned URLs, exact byte lengths, integrity hashes, and license/source notices for model/tokenizer/OCR/PDF/media/WASM assets. Do not include unused embedding audio weights.
- Explicit setup shows true byte progress, reuses complete cached assets, and verifies the entire required set before Offline ready.
- After setup, no network fallback on private operations. Missing/corrupt assets produce a setup repair state. Request URLs/cache keys must not contain filenames, queries, or extracted private text.
- Keep downloaded binaries and temporary benchmark files out of Git. Make test setup reproducible without committing large weights.
- Integrate the model/runtime asset manifest with the app-shell service worker you own. Keep one coherent PWA cache/update implementation; test the production static base path and offline reload.

## Checkpoint 4: queue and source extraction

- Hold the processing Web Lock, recover unfinished jobs, and process one item at a time. Prioritize interactive search between heavy stages without running competing model sessions.
- Validate duration, codecs, and PDF encryption/page limits before Ready. Preserve saved originals on failure and provide retry.
- Use transactional generation/claim checks on publication/failure; cancellation/deletion must prevent stale results. Publish whole item generations atomically.
- Parse note/web snapshot text safely. Never execute imported HTML.
- PDF.js extracts embedded text page by page. Render/OCR pages without usable embedded text. Never join chunks across pages.
- Tesseract.js extracts image/scanned-page text with cached English assets; create OCR text chunks and visual image embeddings for supported images.
- Split text into at most 256 model tokens with 48-token overlap. Preserve source/page provenance.
- ffmpeg extracts mono 16 kHz PCM from supported audio/video. Transcribe overlapping 30-second windows with five-second stride context; reconcile overlapping transcript segments/timestamps. Skip near-silent windows and label automated transcripts.
- Sample video frames at 0, 5, 10, ... seconds below duration; retain sample times and previews. Silent videos still get visual indexing. There is no promise of finding unsampled brief scenes.
- Stage heavy work and dispose decoders/models before the next peak-memory stage. Use a DOM adapter only where browser media/canvas APIs require it; never block React rendering with inference.

## Checkpoint 5: retrieval

- Use contract prefixes, index version, 768-dimensional normalized vectors, local cosine filtering, bounded lexical boost, deterministic tie-breaking, file-level grouping, and at most five distinct results.
- Query embeddings use the same model/revision/dimension as indexed text and images. Reject malformed/zero vectors and incompatible indexes.
- Choose separate text and visual thresholds only with the calibration set. Evaluate a deterministic grid from 0.00 to 0.90 in 0.01 steps; maximize correct top-three retrieval subject to rejection of all calibration negatives, breaking ties toward the higher threshold. If no setting meets both, report failure and improve the pipeline/calibration design without tuning against acceptance queries.
- Freeze thresholds, corpus, prompts, and model configuration before acceptance runs. Do not pretend thresholds are correctness probabilities.
- Return excerpts from extracted segment text and source IDs/locations. Never generate answers, captions, citations, or replacement files.
- A missing original is explicit. A no-result state does not claim the item was never saved. Model-not-ready and index incompatibility remain distinguishable from no matches.

## Checkpoint 6: integrate actual handoffs

Use Nakshatra's merged repository and processing port with the UI, route components, PWA shell, and original viewers you implement. Wire save → queued item → engine processing, setup completion → queue recovery, retry/cancel/delete, search results, and model progress. Fix storage/contract mismatches with Nakshatra and document agreed changes. Chaitanya's handoff is content only; there is no dependency on teammate-built screens or viewers.

Review Chaitanya's policy/user-guide content against actual requests, model hosts, static hosting, storage, archives, deletion, and errors. Render the policy documents as safe readable pages, implement links/routes/offline access, and write their integration tests. Do not invent missing facts or claim untested privacy behavior. Coordinate factual text changes with Chaitanya; you own the page implementation and visual design.

## Checkpoint 7: acceptance and release evidence

Build the fixed 30-item corpus using actual extraction/inference, not seeded answer vectors. Run positive/negative retrieval, source viewing, interruption, deletion races, archive transfer, and outbound-network assertions. Run production PWA checks on primary and compatibility devices.

Record:

- Commit and model/asset revisions, library versions, thresholds, index version, fixture hashes.
- Exact device/OS/browser, tested modalities, indexing failures, query ranks, timing targets versus measured results.
- Requests during setup/web capture separately from zero-network private paths.
- Physical-phone tests versus browser emulation, and limitations not covered.

The existing 120-second small-fixture target remains an acceptance target, not measured performance. Full-length media has separate measured processing evidence; never extrapolate from a short fixture.

Run `npm test`, `npm run test:fast`, `npm run build`, and `npm run check` after their setup prerequisites. Missing assets or unsupported required execution paths are failures, not skips. Prepare focused PRs, request approval before staging/commits, and respect reviews/merge authorization.

By 3 November, all fifteen SPEC statements must pass. Prepare the fresh-laptop README, license notices, manual transfer instructions, and labelled synthetic demo with paraphrase/visual/media/offline cases. Keep local handover notes out of public PRs unless authorized.
