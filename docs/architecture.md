# Architecture and frontend replacement

Campus Recall has no hosted REST backend or inference endpoint. Its application API consists of asynchronous TypeScript contracts and request-ID-based worker messages. User data stays in the browser library. Public download URLs and explicitly requested webpages are the network boundaries.

## Module boundaries

| Module | Responsibility | Redesign impact |
| --- | --- | --- |
| `src/main.tsx` | Creates one service instance and mounts the chosen view | Mount a replacement frontend here |
| `src/app/services.ts` | Composes Dexie, the local engine, capture, preferences and live library subscription | Keep this contract and composition when changing the skin |
| `src/app/useCampusRecall.ts` | React controller: loading, actions, search generations, notifications and app lifecycle | Reuse its state/actions, or replace it for a different interaction model |
| `src/ui/App.tsx` | Navigation, app shell and source-preview placement | Replace freely |
| `src/ui/screens/` | Library/search and Settings presentation | Redesign one screen at a time |
| `src/ui/Add.tsx`, `Viewer.tsx`, `ItemRow.tsx`, `Dialogs.tsx` | Capture forms, source rendering, rows and dialogs | Replace individually; their data uses shared contracts |
| `src/ui/styles/` | Theme, base, shell, controls, library, capture, settings, source, feedback and responsive styles | Edit the theme or replace styles without touching inference |
| `src/ui/useModalFocus.ts` | Focus trapping and restoration for the current DOM | Adapt selectors when replacing dialogs or the shell |
| `src/shared/` | Records, limits and the cached PDF/runtime loader | Preserve source identities and format limits |
| `src/storage/` | Transactions, originals, processing claims, segments and archive transfer | Independent of JSX and styling |
| `src/engine/` | Asset verification, extraction, inference orchestration and ranking | Independent of the current views |
| `src/app/model-client.ts`, `model-protocol.ts` | Typed worker transport and backend fallback | Preserve when redesigning screens |
| `src/sw.ts` | App-shell precache and cached runtime reads | Preserve offline behavior; rebuild after changing assets |

Views receive a `CampusRecallServices` instance through `<App services={services} />`. They do not instantiate a database, inspect Dexie tables, or import extraction/model implementations. Add receives a save contract and capture service; Viewer receives original/backup operations. The application layer never imports the current UI or CSS.

The composition root creates services once per page, outside React rendering. Do not construct a new database/engine inside each screen or component render. `subscribeLibrary` returns an unsubscribe function; `subscribeProgress` does likewise. Subscription errors surface in the UI instead of silently leaving a stale library.

The stylesheet entry preserves import order because later responsive/readability rules override earlier base rules. A redesign can replace the entry and screen modules together. There is no component-library dependency, external font or hardcoded fixture result in the production interface.

## Local API

| Contract | Operations | Guarantees and evidence |
| --- | --- | --- |
| `LibraryRepository` | Save, get item/original, list/filter, rename, delete, export, import | Durable transaction confirmation, exact IDs, original hashes, atomic archive validation; storage and production browser tests |
| `EngineClient` | Setup, enqueue indexing, search, cancel, subscribe, dispose | Indexing resolves after enqueue; completion arrives through library state/progress. Actual-model acceptance verifies retrieval |
| `ApplicationEngine` | Read-only readiness and download size | Settings reads actual setup state, not a hardcoded ready flag |
| `CaptureService` | Validate URL, capture, inert HTML extraction | Omitted credentials/referrer, HTTP status/MIME/size checks and safe fallback; unit and actual HTTP browser tests |
| Preferences | Get/set local settings | Explicit service methods, without view access to database tables |
| Model worker | Documents, query, image, transcribe, dispose | Typed inputs, request IDs, terminal result/error, serial inference and one fresh-worker WASM fallback; transport tests and real inference |

Model outputs are normalized 768-dimensional vectors. Search returns source IDs, locations and source excerpts. It does not generate answers. Preserve the source ID when opening results; never select an original by its title or visible position. Preserve empty/weak-match behavior and version compatibility when changing the results layout.

## Network inventory

| Request | When allowed | Verification |
| --- | --- | --- |
| Static shell, manifest, icons, bundles and `sw.js` | Loading/updating the application | Production build, direct-route and offline browser tests |
| `asset-manifest.json` | Initialization and setup | App-shell precache plus manifest/integrity tests |
| Pinned Hugging Face model/config/tokenizer URLs | Explicit offline setup only | All 23 external setup URLs, including OCR below, returned HTTP 200 during the pre-PR health check; actual setup checks hashes |
| Pinned jsDelivr English OCR data | Explicit offline setup only | Same endpoint audit and verified setup cache |
| Local `runtime/` files | Explicit setup, then cache reads | Actual model/OCR/PDF/media processing with networking disabled |
| User-selected HTTP(S) webpage | Explicit capture; opening its external link is separate | Credential omission, CORS/HTTP error fallback, safe parsing and truncation browser tests |
| Repository issue link | User explicitly opens Report an issue | Navigation only; no attached documents or search query |

Public endpoint health reports: [HTTP](verification/network-endpoints.json) and [browser CORS](verification/browser-endpoints.json). Both checks passed all 23 external setup URLs. A successful HEAD check alone does not prove availability forever or inference correctness. Production setup and offline processing tests provide separate behavioral evidence. There is no `/api/search`, upload server, WhatsApp/Gmail connector, analytics endpoint, embedding API or remote fallback to probe.

`prepare-assets.mjs` has a build-time metadata fallback for maintainers recreating the pinned manifest; normal locked builds use the checked-in manifest. The test asset server and acceptance harness are excluded from the production application.

## Redesign checks

1. Preserve the injected services contract, shared DTOs and original-source behavior.
2. Keep database, model, capture and ranking code outside the views. Architecture tests enforce import boundaries.
3. Use isolated UI fixtures for design tests only. A contract-only presentation test searches and opens the expected original through an injected adapter; it does not establish model quality.
4. Run `npm run check`, `npm run test:fast`, `npm run build` and `npm run test:browser` for screen/style changes. Check keyboard/focus, mobile layout, original viewers and offline policy routes.
5. Run actual-model acceptance after changes to services, queue/extraction, indexing, worker transport, offline caching or retrieval. Do not rewrite golden source IDs/queries to disguise a failure.

Current device and release limitations remain in [verification evidence](verification/README.md).
