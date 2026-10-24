# Using Campus Recall

Campus Recall keeps a separate personal library in each browser and on each device. It can retrieve only information you explicitly save. All examples in the test/demo corpus are synthetic, not actual campus rules or interview evidence.

## Save an original

Open **Add to library**. Choose supported files, enter a note, or capture a public webpage. You may leave the title blank. File batches use the original filenames for identification. Wait for **Saved locally** before closing or reloading. This confirms storage, not search readiness.

The Library lists recent saves, including queued and failed items. Filter by file type or processing status. Open an item at any time to read its preserved original. Rename changes its display title and queues a new index generation; original bytes remain unchanged.

## Set up offline search

In **Settings**, choose **Download offline search**. Read the actual manifest size shown there. Setup fetches pinned public models and local runtimes, checks their SHA-256 hashes and caches them. Complete verified assets are reused after an interrupted setup. An unfinished asset must download again.

There are no paid inference calls or API keys. Initial setup needs internet and about 445 MB plus app files and inference memory. Browser space for your own library is additional. Setup verifies assets; it does not certify every browser or phone. The engine tries WebGPU where available and the same quantized model on WASM otherwise. Unsupported devices receive an error with the original retained.

## Wait for Ready

Processing runs while the app is open, one item at a time. Statuses are **Queued**, **Processing**, **Ready**, or **Needs attention**. A failure explains what happened and keeps the original. Use its actions menu to retry or cancel. Reopening resumes interrupted jobs. Deleting an item prevents late processing results from restoring it.

English is the acceptance baseline. Audio search covers speech. Video indexes speech and scenes sampled every five seconds; brief unsampled frames may not be retrievable. Extraction and transcription can contain mistakes.

## Find and verify

Type a remembered topic, detail or description in the search box and press Enter. On desktop, Command+K or Ctrl+K focuses search. Questions and descriptions use the same local retrieval model; no answer is generated. Results show excerpts from extraction or identify a visual match, and point to the saved original.

Open a result to inspect its exact source. PDFs open the matching page. Recordings seek to the matching interval without autoplay. You can download the preserved file or export that item as a backup. Source URLs open external websites and may have changed since capture; the saved webpage view is a plain-text snapshot.

A no-match result means nothing cleared the relevance threshold. It does not mean you never saved the item. Try a more concrete detail, a different description or the Recent saves list. Results are limited to five distinct originals. Scores are not confidence percentages.

## Webpage capture fallback

A capture request goes directly to the URL you enter without app-supplied credentials or a referring page. Some websites block browser access or require login. If capture fails, paste readable text or import an HTML/PDF snapshot. HTML is converted to inert plain text. Imported scripts and remote images are not executed or loaded. There is no proxy and no Gmail, WhatsApp or institutional integration.

## Supported limits

- JPEG, PNG, WebP: up to 20 MB.
- Unencrypted PDF: up to 20 MB and 50 pages.
- Notes and saved webpage text: up to 20,000 Unicode characters.
- MP3, WAV, M4A: up to 50 MB and five minutes of English speech.
- H.264 MP4, optional AAC audio: up to 100 MB and two minutes.

Convert HEIC, HEVC and MOV before importing. File size is checked before save; duration, codec and page limits are checked during processing. Oversized or unreadable content cannot become Ready, but the saved original remains available after a processing failure.

## Back up and transfer

In Settings, **Export library** creates an unencrypted ZIP of originals and metadata. The source viewer can export one item. Keep archives private. Model weights and embeddings are excluded. **Restore backup** validates the archive before modifying the library, assigns new identities and queues restored content for indexing. Duplicates are identified by content hash, kind and source URL, rather than title alone.

Restore supports ZIPs up to 250 MB, up to 500 MB unpacked and 500 items. For larger libraries export smaller selections, such as individual source backups. Manual restore is transfer, not automatic synchronization.

Browser eviction, cleared site data or device loss can remove your library. Request persistent storage in Settings, but keep backups regardless of the result. The app does not provide application-level encryption or control OS/browser backups.

## Install, update and use offline

Open a production build over HTTPS, finish model setup, then use Chrome's install menu or Safari's Share menu and **Add to Home Screen**. Desktop localhost is also a secure development context. A plain HTTP LAN address is not enough for phone PWA/WebGPU testing.

After caching, the production app's interface, originals, processing and search can run offline. New webpage capture still needs internet. Finish processing and back up before applying an app update. Use the Privacy Policy and Terms links in Settings for the current data-handling details.

## Report a problem

Use the repository issue tracker and include browser/version, OS, file type and a description of the failure. Avoid uploading private files or identifying information. The project is maintained by students and does not imply official IITGN support.
