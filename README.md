# Campus Recall

A free, local personal library for screenshots, PDFs, notes, webpages and short recordings. Save an original, describe what you remember, and open the matching file, PDF page or media interval. There are no accounts, cloud inference calls, generated answers or API keys.

Built by Raj Modi, Chaitanya and Nakshatra for CS437 at IIT Gandhinagar. A student project, not an official IITGN service. Interview evidence and testable requirements are in [SPEC.md](SPEC.md).

## Run locally

Use Node 24 and npm. The lockfile pins dependencies.

```bash
npm ci
npm run dev
```

Open the localhost URL printed by Vite. Save files immediately, even before model setup. In Settings, choose **Download offline search**. The app displays the manifest's actual size and progress, verifies SHA-256 hashes, and then processes queued items. Keep the app open while processing. Completed downloads are reused after interruption; an incomplete current asset downloads again.

Initial setup needs about 445 MB plus application files. Allow additional browser storage for originals, extracted data and inference memory. No model weights are checked into Git. `predev` and `prebuild` copy local runtimes from installed packages and generate the asset manifest. Pinned public model metadata is in `scripts/model-assets.json`.

## Build and preview the PWA

```bash
npm run build
npm run preview
```

The static output is `dist/`. Serve it over HTTPS for installation and secure browser capabilities. Localhost works for desktop development; an ordinary HTTP LAN address is insufficient for phone PWA/WebGPU testing. No deployment is performed by these commands.

For a subdirectory deployment, set the complete base path at build time:

```bash
APP_BASE=/campus-recall/ npm run build
```

Routes use hashes, such as `#/library`, `#/settings`, `#/privacy` and `#/terms`. Install using Chrome's app menu, or Safari's Share menu and Add to Home Screen. Cache the production app by opening it online once, finish model setup, then test an offline reopen. Updates show a reload notification; finish processing and back up first.

## Supported inputs

| Type | Limit | Indexed content |
| --- | --- | --- |
| JPEG / PNG / WebP | 20 MB | OCR text and visual embedding |
| Unencrypted PDF | 20 MB, 50 pages | Page text or scanned-page OCR |
| Note | 20,000 Unicode characters | Saved text |
| Public webpage | 20,000 extracted characters | Captured or pasted plain text |
| MP3 / WAV / M4A | 50 MB, five minutes | English speech with timestamps |
| H.264 MP4, optional AAC | 100 MB, two minutes | English speech and a visual frame every five seconds |

Convert HEIC, HEVC and MOV before importing. A failed extraction preserves the original and exposes Retry. A blocked webpage capture offers pasted text or inert HTML/PDF import; there is no proxy. No-result search does not mean the item was never saved. Video search cannot cover every brief frame. Results are sources and extracted excerpts, not generated factual answers or confidence percentages.

## Storage and privacy

Each browser/device has its own IndexedDB library and model cache. Core inference and search use cached assets and local similarity calculations. Explicit setup, webpage capture and opening external links require ordinary network requests. There is no analytics or advertising.

Browser persistence is best-effort. Clearing site data, browser eviction or device failure can remove the library. Export a manual ZIP in Settings, or export an individual source from its viewer. ZIPs contain originals, metadata and hashes, without embeddings or models; they are **unencrypted**. Restore validates before writing, identifies content duplicates and queues fresh items. Import is limited to a 250 MB ZIP, 500 MB unpacked and 500 items; export smaller selections for larger libraries.

The app does not claim encryption at rest or control over browser/OS backups. Read the rendered [Privacy Policy](docs/product/privacy-policy.md) and [Terms](docs/product/terms-and-conditions.md), and review [third-party licenses](THIRD_PARTY_NOTICES.md).

## Test

Fast tests use actual storage logic, controlled vector arithmetic and inert HTML extraction. Full acceptance tests use the real pinned models, OCR, PDF and media runtimes. Missing model assets fail setup explicitly.

```bash
npm run check
npm run test:fast
npx playwright install chromium
npm run models:download
npm run build
npm test
```

`npm run models:download` verifies public assets into ignored `.models/` for reproducible testing. A localhost test-only server streams those checksum-addressed public files; it is not part of the app and receives no library data. Full tests redirect only setup downloads to this mirror, then reject unexpected external requests.

```bash
npm run test:browser       # production UI, responsive layouts and offline shell
npm run test:acceptance    # actual extraction and retrieval
```

The Browser plugin is unavailable in the current environment, so browser verification uses Playwright. Reports and screenshots go to ignored `test-results/` and `playwright-report/`. All campus announcements in fixtures are synthetic. See [acceptance design](docs/implementation/acceptance.md) and [verification evidence](docs/verification/README.md) for measured outcomes and remaining physical-device checks. A successful build is not evidence that every requirement or phone has passed.

Fixture regeneration needs macOS `say`, local ffmpeg and npm dependencies:

```bash
node scripts/create-fixtures.mjs
```

## Architecture

- `src/shared/`: published contracts and limits from Nakshatra.
- `src/storage/`: Dexie originals, metadata, atomic queue claims and ZIP transfer.
- `src/engine/`: extraction, asset integrity, local worker inference and ranking.
- `src/app/`: injected application services, headless React controller, worker bridge and fallback lifecycle.
- `src/ui/`: replaceable shell, screens, rows, dialogs, exact-source viewers and policy pages; theme and feature styles are separate.
- `src/sw.ts`: app-shell precache and explicit-setup runtime cache.

The views receive service contracts instead of accessing database tables or model implementations. See [architecture and frontend replacement](docs/architecture.md) for module boundaries, local APIs, network requests and the redesign checklist.

EmbeddingGemma 2 q4 text and vision share normalized 768-dimensional vectors. Whisper tiny.en transcribes speech separately. WASM uses a standard-operator lowering of the model's packed q4 embedding lookup because the distributed ORT WASM runtime lacks that kernel. The pinned weights and precision remain unchanged. See [retrieval notes](docs/verification/retrieval.md) for equivalence checks, prefixes, calibration and frozen versions.

## Team workflow

Implementation is on `raj_final`, from the two merged teammate packages. Preserve `Raj_setup`. Open reviewed PRs into `main`; do not merge without authorization. Keep local handovers and unrelated files out of public changes. See [implementation instructions](docs/implementation/README.md) and [AI-assisted development notes](docs/ai-use.md).
