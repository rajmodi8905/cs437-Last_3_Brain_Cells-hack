# Campus Recall user guide

**Draft for integration.** The current checkout has foundation APIs and a minimal message, not a usable retrieval interface. All product steps below are **planned and manually untested**. They use the plan's labels without defining new controls. Raj owns the interface and must verify the steps after integration.

## What runs now

Follow the [foundation README](../../README.md): use Node 24 and npm, then run:

```text
npm ci
npm run test:fast
npm test
npm run check
npm run build
npm run dev
```

`dev` starts the minimal foundation entry point. There are no Library, Add, Search, Settings, Privacy, or Terms screens yet. The repository APIs implement local saving, listing, renaming, deletion, and version-1 archive transfer. The unavailable engine rejects setup/index/search/cancel operations with `ENGINE_UNAVAILABLE`; repeatedly retrying cannot install the missing implementation.

Currently `test:fast` runs storage unit tests, `test` runs those plus the unavailable-engine test, and `check` only runs TypeScript. A successful build is a foundation build, not an installable/offline PWA acceptance result. See the [verification checklist](verification-checklist.md) for actual results and gaps. Do not change dependency versions to bypass a setup failure.

## Planned supported inputs

MB means 1,000,000 bytes. Text limits count Unicode code points.

| Input | v1 limit | If outside the limit |
| --- | --- | --- |
| JPEG, PNG, WebP | 20 MB | Convert unsupported images such as HEIC to a supported format and reduce size if needed |
| Unencrypted PDF | 20 MB, 50 pages | Supply an authorized unencrypted copy or split into smaller PDFs |
| Note | 20,000 code points | Split longer text into separate notes |
| Public HTTP(S) webpage snapshot | 20,000 captured text code points | Supply the relevant text or a supported snapshot; check any truncation notice |
| MP3, WAV, M4A audio | 50 MB, five minutes | Convert to a supported format or split/trim the recording |
| MP4 video, H.264 with optional AAC | 100 MB, two minutes | Convert HEVC/MOV to the specified MP4 codecs or split/trim |

Keep your original outside the app when converting. Changing a filename extension is not conversion. The foundation checks supplied MIME type, byte limits, text limits, and HTTP(S) URL schemes. It does not decode files or establish valid codecs, duration, PDF encryption, or page count. Those checks belong to planned processing before Ready. A successful save alone does not establish that processing will succeed.

## Planned save and library flow

1. Open Add and choose a supported file or paste a note. A title is optional. Display titles are limited to 120 code points; full original filenames are retained separately.
2. For a webpage, supply a public HTTP(S) URL and attempt capture. If browser restrictions or fetching prevent capture, paste its text or use the planned inert HTML/PDF snapshot fallback. Imported HTML must be parsed without executing scripts. Raw HTML import and URL fetching are not provided by the current repository API; it accepts supplied webpage text and a URL. A bare URL must not be treated as captured page contents.
3. Wait for Saved locally before assuming the save succeeded. Models must not be required to save. Basic validation or storage failure must not show a successful save.
4. Open Library to find recent saves, newest first, including queued/failed items. Filter by kind/status, change a display title, or open the stored original. Duplicate titles do not mean duplicate originals. Renaming preserves identity and bytes and may require reindexing.
5. Delete an item only when you no longer need that local copy. Deletion is intended to remove related derived records and jobs too. Existing exports and other-device copies remain separate.

| Label | Planned meaning |
| --- | --- |
| Saved locally | Confirmation that original, metadata, and job were committed; not a processing status or proof of search readiness |
| Queued | Original is stored and waiting for local processing |
| Processing | Local extraction/indexing is in progress |
| Ready | A complete current index has been published; not a guarantee that its contents are correct |
| Failed | Processing failed or was cancelled; the saved original remains available with a reason and explicit retry where appropriate |

Processing is planned to run while the app is open. After interruption, reopening should safely resume unfinished work; a small item may restart processing from the beginning.

## Planned setup and offline use

Open Settings and explicitly start model/runtime setup while online. Check actual download bytes/progress; no final download size is verified yet. An interrupted setup or missing runtime must remain incomplete. Offline ready must appear only after all required assets are cached and verified, including OCR, PDF, and media runtimes.

After setup and app caching, reopen in the same browser profile offline and check local saving, processing, search, and original viewing. Model setup must not hide saved originals or policies. Capturing or visiting a live website is a separate network action. Missing assets should offer repair, not cloud inference. Installation paths and exact browser instructions remain pending PWA integration and real-device testing.

## Planned search and source viewing

1. Enter a description of what you remember, such as the subject of an announcement or an object's appearance. Optionally filter by item kind. Search retrieves saved material; it does not generate an answer.
2. Review up to five distinct source results. Text excerpts come from automated extraction; visual matches use previews and locations without invented captions. Similarity is not a correctness percentage.
3. Open a result and inspect its original. PDFs should open on the matching one-based page. Audio/video should seek to the matching interval after metadata loads, without forced autoplay. Confirm details against the source.
4. If nothing relevant appears, try another description, check filters and processing state, and browse recent saves. No result does not establish that you never saved the item.

English is the acceptance baseline. Speech search does not identify music or environmental sounds. Video scenes are sampled every five seconds; brief unsampled moments may be missed. Silent video is eligible for visual processing.

## Planned backup and device transfer

1. Select the items to export in Settings; an empty selection must be rejected. Save the **unencrypted ZIP** somewhere you control. It includes selected originals and metadata, not embeddings, processing jobs, or model assets. Notes/snapshot text are originals and are included.
2. Transfer that archive yourself to the other device or browser profile. There is no account sync or shared automatic library.
3. Import it there. Valid new items should preserve bytes, titles, capture times, and source URLs but receive fresh IDs and Queued status. Model setup and reindexing are local to the receiving device.
4. Review imported and skipped-duplicate counts, open representative originals, and compare them before relying on the backup. Duplicates use hash, kind, and source URL; equal titles with different contents remain separate. Import must not overwrite an existing duplicate's title.
5. A malformed archive or storage failure must leave the existing library unchanged. Keep the original archive and report the failure using a non-sensitive reproduction rather than editing its manifest to bypass validation.

Browser storage may be evicted or cleared. Persistence requests, when implemented, cannot guarantee retention. Export regularly and test restoration. Deleting local data does not remove exported copies, and the app cannot control OS/browser backups.

## Troubleshooting and current evidence

Except for the foundation engine error identified above, these are planned recovery instructions, not tested UI fixes.

| Symptom | Action after integration | Evidence needed |
| --- | --- | --- |
| Failed extraction or unsupported file | Read the reason, keep/open the saved original, convert or reduce input if necessary, and use Retry for a recoverable failure | Real invalid and recoverable fixtures; original retained; no false Ready |
| Incomplete setup or `MODEL_NOT_READY` | Complete explicit setup; repair missing assets while online, then repeat offline verification | Interrupted/corrupt-cache tests without remote fallback |
| `ENGINE_UNAVAILABLE` in this foundation | Wait for Raj's engine integration; this is not an empty-search result | Existing adapter code and isolated test |
| Missing original or `SOURCE_UNAVAILABLE` | Do not accept another same-title file as a substitute; restore from a known backup or re-import your original | Missing-source viewer test |
| Save/import storage or quota error | Keep the source/archive, check available device/site storage, back up accessible items before freeing space, and retry only after resolving the cause | Forced write/quota failure without false success or partial import |
| Lost library after clearing data/profile change | Return to the original profile if available, otherwise restore your separate backup | Real browser retention/restore checks; no recovery guarantee |
| Incompatible index | Allow planned local reindexing with the matching assets; do not treat it as no matches | Index-version test |

Do not clear all site data as a routine cache repair: it may erase originals as well as assets. The exact asset-only repair controls are unresolved. Report problems through the repository linked in the [Terms](terms-and-conditions.md), without private content. Read the [Privacy Policy](privacy-policy.md) for draft data-handling details.
