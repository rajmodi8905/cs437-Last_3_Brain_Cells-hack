# Campus Recall: implementation and collaboration plan

Approved direction: 19 October 2026. This document describes requirements, not implemented features. The planning PR must merge before application implementation begins. No application code or executable acceptance tests exist at this checkpoint.

## 1. Publish the plan, then work separately

The documentation-only `plan_setup` PR publishes this plan, the [shared contracts](docs/implementation/contracts.md), [individual handoffs](docs/implementation/README.md), [acceptance design](docs/implementation/acceptance.md), and updated [SPEC.md](SPEC.md).

Obtain the required reviews and authorization to merge. Then every member pulls the merged plan from `main`. Do not push implementation directly to protected `main`.

| Person | Branch | Ownership | Handoff |
| --- | --- | --- | --- |
| Nakshatra | `Nakshatra_setup` | Scaffold, contracts, local persistence, backup/restore | [Instructions](docs/implementation/nakshatra.md) |
| Chaitanya | `Chaitanya_setup` | Policy content, user documentation, verification checklists | [Instructions](docs/implementation/chaitanya.md) |
| Raj | Existing `Raj_setup` | Core UI/UX, viewers, PWA, all AI/embeddings, integration, verification | [Instructions](docs/implementation/raj.md) |

Preserve the existing `Raj_setup` history. Every member starts from current merged `main` and incorporates later merges normally, without force pushes. The dependency and production merge order is:

**Plan on main → Nakshatra PR → Chaitanya PR → Raj PRs → final verification.**

Chaitanya can prepare content and checklists while the foundation is reviewed. Raj can perform device feasibility work and develop the core UI and engine against the published contracts after the planning PR merges. Runtime integration uses Nakshatra's merged persistence; policy pages use Chaitanya's reviewed content. Raj does not wait for Chaitanya to design or implement any interface. Production PRs still follow the stated merge order.

This chat implements Raj's package only, including all core interface and AI work. Nakshatra and Chaitanya work in their own environments. Raj may fix defects in their merged code during integration; this chat does not implement substitute storage or support-documentation packages while waiting.

## 2. Product and boundaries

Campus Recall is a free, installable PWA. Its primary flow is:

**Save → confirm local storage → process locally → search from memory → open the original source.**

| Input | Supported limits | Searchable information | Source opening |
| --- | --- | --- | --- |
| Images | JPEG/PNG/WebP, up to 20 MB | OCR text and visual content | Preserved original |
| PDFs | Unencrypted, up to 20 MB and 50 pages | Embedded text and scanned-page OCR | Matching page |
| Notes | Up to 20,000 Unicode code points | Original text | Saved note |
| Webpages | Public HTTP(S), up to 20,000 captured text characters | Snapshot text, title, URL | Saved text snapshot with separate visit action |
| Audio | MP3/WAV/M4A, up to five minutes and 50 MB | English speech transcript | Matching timestamp |
| Video | MP4 with H.264 and optional AAC, up to two minutes and 100 MB | Speech and sampled visual scenes | Matching timestamp |

MB means 1,000,000 bytes. Unsupported formats receive conversion guidance. HEIC and HEVC/MOV are outside v1. Saving and processing are separate: an already stored original remains available if deeper decoding, duration, codec, or PDF validation later fails; it must not become Ready.

Webpage capture attempts a direct fetch. Browser restrictions or fetch failures offer pasted text or an imported HTML/PDF snapshot. HTML is parsed as inert input and is never executed. No proxy server or account integrations are included.

- English is the acceptance baseline.
- Every device has a separate local library; transfer is manual export/import.
- No accounts, sync, generated answers, reminders, or task management.
- Audio search covers speech, not environmental-sound or music identification.
- Video scene search covers frames sampled every five seconds, not every brief moment.
- Processing runs while the app is open; unfinished work resumes safely after reopening.
- Core operations work offline after explicit setup.
- Browser storage retention is best-effort. Request persistence where available and provide backups.
- Do not claim encryption at rest or control over browser/OS backups.

Visual search, short-media search, and unencrypted manual transfer are now planned v1 capabilities. Handwriting, sound-event search, and encrypted transfer remain extensions.

## 3. Architecture

| Component | Decision |
| --- | --- |
| Application | React, TypeScript, Vite, responsive CSS; Node 24 for development |
| Persistence | Dexie over IndexedDB, original Blobs stored locally |
| Embeddings | `onnx-community/embeddinggemma-2-ONNX`, text and vision, `q4` |
| Inference | Transformers.js `4.3.1`, WebGPU with same-model WASM fallback |
| Speech | Quantized `onnx-community/whisper-tiny.en`, initially WASM |
| OCR | Tesseract.js and cached English assets |
| PDF | PDF.js for extraction and viewing |
| Media | Single-thread ffmpeg.wasm for audio extraction |
| Archives | fflate |
| PWA | vite-plugin-pwa, static HTTPS deployment |
| Tests | Vitest, React Testing Library, Playwright, actual model acceptance tests |

Pin dependencies exactly during the foundation and maintain one lockfile. Dependency changes after that require coordination with Raj. Do not commit downloaded model binaries or generated build output.

Model revisions:

```text
onnx-community/embeddinggemma-2-ONNX
daa72c51243991dfcaf9f9137d2c573d8f7790c0

onnx-community/whisper-tiny.en
2575352d61be1bf7225cf8f8b268a4678025fc58
```

Load EmbeddingGemma's text and vision components without its audio encoder. Use the separate speech model for transcripts. Retain model/library license notices. [Embedding export](https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/blob/main/README.md), [speech export](https://huggingface.co/onnx-community/whisper-tiny.en).

Ownership:

```text
src/shared/     Nakshatra: contracts, limits, fixtures
src/storage/    Nakshatra: IndexedDB and archives
docs/product/   Chaitanya: policy text, user guide, verification checklists
src/ui/         Raj: screens, viewers, routes, styles, rendered policy pages
src/engine/     Raj: extraction, models, indexing, ranking
src/app/        Raj: PWA shell, final wiring, worker bridge
```

Nakshatra supplies only a minimal runnable entry point and unavailable-engine adapter, without product screens or design choices. Raj owns the product shell, navigation, components, viewers, styling, PWA behavior, and final wiring. Chaitanya supplies content documents, not page components. The authoritative types, persistence transactions, worker protocol, and archive format are in [contracts.md](docs/implementation/contracts.md). Interface changes must be agreed before other modules change to use them.

### Processing

- Save original and metadata atomically before confirming success; saving does not require installed models.
- Persist jobs and process one item at a time. Preserve originals on failure and expose Retry.
- Use generations to prevent late worker responses from recreating cancelled/deleted work.
- Publish a completed set of segments atomically before marking Ready. Do not expose partially indexed items as Ready.
- Restart incomplete items safely after reopening. Reprocessing a small item from its beginning is acceptable.
- Preserve PDF page provenance. Use at most 256 model tokens per text chunk with 48-token overlap, without crossing a PDF page.
- OCR images and scanned PDF pages. Create visual embeddings for images and sampled video frames.
- Transcribe overlapping audio windows, retain timestamps, and label automated transcripts. Skip near-silent windows.
- Silent video is valid. Do not promise visual coverage between sample times.
- Keep work off the UI thread where browser APIs permit and release heavy resources between stages.

### Retrieval

- Use the documented embedding prefixes, 768-dimensional normalized vectors, and local cosine similarity.
- Calibrate separate text and visual thresholds. Similarity is not a correctness probability.
- Apply a bounded lexical boost only to eligible text candidates.
- Group by original item; return at most five distinct items with their strongest matching location.
- Weak results are excluded. An empty result does not prove an item was never saved.
- A visual result uses its preview/location, not an invented description or excerpt.
- Detect index-version incompatibility and reindex rather than mix vector spaces.

### Setup, offline use, and hosting

Use a versioned asset manifest for models, tokenizers, OCR data, WASM, and media runtimes. Display actual manifest sizes and progress; the 300–400 MB estimate is not a verified download size. Cache and verify required assets before declaring Offline ready. No content-bearing runtime request may fall back to a remote inference service.

Use static HTTPS hosting and hash routes. A phone visiting an ordinary HTTP LAN address cannot validate secure-context PWA/WebGPU features. Test those features using trusted local HTTPS or an explicitly authorized HTTPS deployment. App publishing/deployment still needs approval.

## 4. UI requirements

Raj must read and apply [Emil Kowalski's Design Engineering](https://github.com/emilkowalski/skills/blob/main/skills/emil-design-eng/SKILL.md) and [Mobile Native](https://github.com/emilkowalski/skills/blob/main/skills/mobile-native/SKILL.md) skills. User restrictions take precedence over decorative examples. Neither teammate owns the product's visual design, core screens, interactions, viewers, or PWA integration.

Build a search-first personal library with light neutral surfaces, dark text, restrained blue accents, system fonts, rectangular buttons with at most 6 px corner radius, and labelled SVG icons. Desktop has navigation, results, and a source preview. Phones have readable cards and a full-screen viewer. Real library counts only.

Do not use purple/decorative gradients, pill buttons, fake reviews/testimonials/metrics/customer counters, vague hero text, emoji icons, em dashes in product-authored copy, AI-generated stock photos, generic promotional illustrations or AI marketing copy, custom cursor effects, parallax, scroll-jacking, decorative scroll reveals, or fake content presented as a real library.

Preserve original imported text and research quotes. These restrictions do not authorize changing user documents. No promotional landing page or decorative hero is required.

Search results and keyboard navigation update without entrance/reordering animations. Useful feedback may use 100–160 ms transitions. Respect reduced motion, pointer capabilities, zoom, safe areas, dynamic viewport units, 16 px phone inputs, visible focus, and at least 44 px primary touch targets. Test open-keyboard and installed-PWA states on real phones.

Required routes:

```text
#/library
#/search
#/add
#/settings
#/privacy
#/terms
```

Policy pages are accessible from Settings and first-use information, before model setup, and offline after app caching. Chaitanya drafts the factual content described in [Chaitanya's handoff](docs/implementation/chaitanya.md); Raj builds the rendered pages, links, routes, offline access, and final implementation review described in [Raj's handoff](docs/implementation/raj.md). Do not invent contact details, security certifications, institutional endorsement, or legal facts.

## 5. Verification and schedule

The fifteen checkable requirements are in [SPEC.md](SPEC.md). [acceptance.md](docs/implementation/acceptance.md) defines the fixed corpus, test boundaries, commands, and evidence. No mock proves extraction or retrieval success.

Primary devices: MacBook M4/16 GB, iPhone 17 with actual iOS/browser version recorded, and iQOO Neo9 Pro/8 GB. Compatibility: Moto G85/12 GB, HP Pavilion/16 GB with OS recorded, and the available gaming laptop. Browser emulation does not replace physical-phone evidence.

After dependency/browser/model setup:

```bash
npm run dev
npm test
npm run test:fast
npm run build
npm run check
```

`npm test` includes actual-model acceptance tests. Missing assets cause a clear setup failure, not a silent skip. CI checks every PR. Full acceptance evidence accompanies engine/integration PRs.

| Deadline | Deliverable |
| --- | --- |
| 19–20 October | Planning PR, contracts, acceptance design. Nakshatra supplies the test harness/storage cases; Raj supplies UI/engine cases and starts feasibility after the plan merges. |
| 21–22 October | Reviewed Nakshatra foundation merged. |
| 22–24 October | Reviewed Chaitanya policy/user-documentation PR merged. Raj develops the product UI, viewers, PWA shell, and text/image engine in parallel. |
| 25–27 October | Raj integrates core UI and text/image retrieval; at least eight of fifteen statements genuinely pass through reviewed PRs. |
| 28–31 October | Audio/video, calibration, physical-device checks. |
| 1–3 November | All statements pass; specification freeze. |
| 4–10 November | Peer-review fixes, backup and offline/device rechecks. |
| 11–15 November | Frozen-release rehearsal. |
| 16 November | New acceptance request: spec and tests before feature. |
| 17 November | Demonstration. |

## 6. Rules and completion

Every member's AI must read applicable instructions, merged plan, contracts, acceptance design, and its handoff. Preserve uncommitted work and stay within ownership. Write tests before features, record actual failures/passes, and never fabricate interviews or measurements. Ask before staging/committing; obtain authorization for publication/deployment. Verify the intended GitHub identity before publishing.

All changes arrive through reviewed PRs. Meet the actual required approvals without bypassing protection. Merge only with authorization. Update from merged `main` before later work. Record AI use in course-required lab notes. Keep private handovers and unrelated local files out of public commits.

Completion requires all fifteen statements green, a reviewed merged PR from each member, reproducible fresh-laptop setup, and the device matrix passing Save → Process → Search → Original. Demo a paraphrase, visual search, media timestamp, manual transfer, and offline use with labelled synthetic material.
