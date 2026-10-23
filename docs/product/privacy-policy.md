# Campus Recall Privacy Policy

**Draft, version 0.1. Not published or effective.** The actual publication, effective, and update dates must be recorded when this policy is published. This draft describes the intended product and the limited foundation currently implemented.

## Review note: implementation status

At foundation commit `4b9ed54ec291291d6e8344eaa1ac9db47af28a0e`, repository code stores originals and metadata locally and provides deletion and unencrypted archive transfer. The entry point only displays a foundation message. Product controls, policy routes, model downloads, extraction, search, viewers, and offline caching are not implemented. No end-to-end privacy or physical-device result is claimed here.

The following planned practices require Raj's implementation review and network tests before publication. See the [verification checklist](verification-checklist.md) for evidence and unresolved facts.

## Information kept locally

The foundation uses IndexedDB through Dexie, with a version-1 database named `campus-recall`. It stores original file bytes, or UTF-8 text for notes and supplied webpage snapshots, along with titles, original filenames where supplied, item identifiers, content hashes, sizes, capture times, source URLs where supplied, processing status, and jobs. Original bytes are reconstructed as Blobs when read.

The planned processing engine will also store extracted text, automated speech transcripts, embeddings used to compare meaning or visual content, and source locations. The database has stores for segments, previews, and settings; their presence does not mean extraction is running. Planned queries will be processed locally. Query retention must be checked against the completed implementation before release.

## Processing and network requests

The product requirement is no upload of originals, extracted text, transcripts, embeddings, source metadata, or queries for inference, remote storage, advertising, or analytics. No advertising or analytics integration is present in the inspected foundation. The completed application is planned to have no app advertising or analytics and no account or automatic synchronization service. These are requirements, not a completed network audit.

Explicit initial setup will download public model and runtime assets over the internet. Planned model sources are the Hugging Face repositories `onnx-community/embeddinggemma-2-ONNX` and `onnx-community/whisper-tiny.en`, with revisions specified in the [implementation plan](../../IMPLEMENTATION_PLAN.md). There is currently no runtime asset manifest or implemented downloader. Actual download hosts, redirect destinations, byte counts, integrity checks, and OCR/PDF/media runtime sources remain unverified. The final policy must name the actual destinations after Raj establishes and tests the manifest; the model repository names alone are not a complete host inventory.

After explicit setup, local import, processing, search, restart, and saved-source viewing are required to make no outgoing network requests. Missing assets must require setup repair without a remote inference fallback. Offline readiness and these request restrictions remain untested in the application.

Explicitly capturing a public webpage will request the chosen website, subject to browser restrictions. The planned capture omits credentials and offers manually supplied text or an inert HTML/PDF snapshot if fetching fails. Opening the original website is a separate online action, governed by that website and the browser's behavior. Neither action should attach unrelated library content or search queries. Saved snapshots are separate from live websites.

Loading an online application or downloading assets involves requests to the selected hosts. Static hosting may have request logs. No deployment host, logging fields, retention period, or host privacy practice is established by this checkout. These facts must be confirmed for the selected deployment before publication; this draft makes no claim that hosting logs are absent.

## Deletion, export, and restore

The repository's delete operation removes the selected item's original, metadata, segments, previews, and jobs in a transaction and rejects late publication for the deleted item. Product deletion controls and restart behavior still require integration testing. Deleting an item does not delete copies in previously exported archives, other device libraries, or browser/OS backups, and is not a guarantee of secure erasure.

Manual export creates an **unencrypted ZIP archive** of selected originals and user metadata, including titles, capture times, filenames and source URLs where present. Derived extracted segments, embeddings, jobs, model weights, and settings are not exported. Original notes and webpage text remain included as originals. Anyone with access to the archive can read its contents. Choose its storage and recipients carefully.

Restore creates new local item identifiers and queues imported originals for processing. Duplicate detection uses content hash, item kind, and source URL; a matching title alone is not a duplicate. Each device/browser profile has a separate library. Manual export/import is transfer, not ongoing sync, and the product controls are still planned.

## Retention and device responsibilities

Browser storage is best-effort. Clearing site data, browser eviction, private browsing behavior, profile changes, or device loss can make a library unavailable. The planned app will request persistent storage where supported, but this cannot guarantee retention. Keep a separate manual backup and verify that it restores before relying on it.

The foundation does not implement application-level encryption at rest or archive encryption. Browser and operating-system storage, device access, and backups are outside the application's control. This policy does not promise exclusion from those backups or a security guarantee.

## Updates and questions

Review project changes and report problems through the [project repository](https://github.com/rajmodi8905/cs437-Last_3_Brain_Cells-hack). Do not include private originals, queries, or unredacted archives in public reports. No dedicated contact address is established in this draft.

Before publication, Raj must reconcile this content with actual requests, storage, permissions, deletion, and export behavior and record the policy version and actual dates. See also the [Terms and Conditions](terms-and-conditions.md) and [user guide](user-guide.md).
