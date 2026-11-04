# Separate one-month deployment pilot

Recorded 4 November 2026, Asia/Kolkata. Status: discussion and confirmed product direction; no implementation, publication or resource provisioning authorized yet.

## Preserve the submitted project

Raj explicitly says the 3 November submission/form/website work is complete and must remain unchanged. Keep the submitted specification, acceptance evidence and historical status intact. Treat this as a separate deployment-pilot track and, when implementation is authorized, use an isolated branch/worktree with the submitted baseline preserved. Do not silently merge new cloud behavior into the graded baseline or relabel historical tests as pilot validation. The earlier proposal to obtain an instructor exception is not a claim that one was granted; any later graded-baseline integration needs its own decision.

The prior options document remains research/history. This note supersedes its recommendations about a Metis-first host and keeping all embeddings/derived index exclusively on each device.

## Confirmed direction

- Run a demand-validation pilot for at most one additional month, measured from its actual launch date; the launch date is not set.
- Proposed public setup: independent Name.com domain + Azure hosting/storage, reached through an INSIIT link. Maintainers' server offer remains an alternative, not a required dependency for this pilot.
- Exactly two user-facing modes: **Local only** and **Auto-sync**, the latter connected to an account.
- Raj explicitly confirmed **Azure stores/syncs originals and embeddings; processing and search continue on clients**. No cloud inference/search service is selected.
- Auto-sync users may download selected cloud originals for offline use. No separate mandatory native executable is selected. Explain the installable PWA before finalizing delivery.
- Keep “turn/pause sync off” separate from “remove my cloud copy.” Pausing stops future transfers; removal follows an explicit deletion/retention flow.
- Subsequently confirmed by Raj: private account storage with HTTPS/server ownership controls for this pilot. End-to-end encryption is out of scope. Account authentication, HTTPS and provider at-rest encryption must not be presented as E2EE.

## What an installable web app means

Students open the HTTPS address in Safari/Chrome. They can use it as a website or choose Add to Home Screen/Install, giving Recall an icon and its own app window. The same code serves phones and laptops. Supported cached functionality can work offline. Installation does not itself download every document/model, guarantee background execution or turn the product into a native App Store binary. Existing phone installation observations validate the earlier local app, not the proposed cloud pilot.

## Cloud-backed library, local search

Proposed design to make selective downloads useful:

1. Captures save locally first. In Auto-sync, an outbox uploads the original plus owner-scoped metadata and compatible index data after processing. The UI distinguishes local save, pending upload and acknowledged cloud sync.
2. A signed-in second device fetches the library catalogue and versioned embeddings/source-location records. Searches run locally over the cached index. Uploading query text to a cloud search endpoint is outside this chosen design.
3. Originals can be marked cloud-only, downloaded on opening, or explicitly kept offline. A cloud-only original cannot open offline until downloaded; report that state honestly. Avoid auto-deleting the only local original after an unacknowledged upload.
4. Synced embeddings save repeat indexing only when model revision, dimension, normalization, chunking/index version and original hash match. Validate them before publishing locally. Stale/incompatible indexes require safe reindexing, not a false Ready state.
5. A compatible embedding vector does not replace the query model. Each device still needs the relevant local model/runtime setup to embed a new natural-language query. Raj accepts this one-time download; treat it as normal setup, not an unresolved pilot blocker or optimization project.
6. Separate removal of an offline download from deletion of the account's document. Keep tombstones/conflict handling, owner authorization and account isolation from the earlier design. Background sync is best effort; foreground behaviour is the initial acceptance target.

Define the synced bundle explicitly before implementation: original bytes; title/capture/source metadata; model/index version; vectors and source-location/excerpt data needed for retrieval. Titles/excerpts/embeddings are private data too, protected within the account, not public files. The earlier blanket “no derived index in cloud” proposal no longer describes the selected direction.

Local-only mode keeps library content/index on the device. Ordinary host/model requests and explicit external webpage actions still occur; local-only does not mean a hosted site sends no network requests at all. No library/sync telemetry should silently appear in this mode.

## One-month Azure feasibility

Azure + a student domain + an INSIIT entry link is a reasonable small-pilot setup with $100 credit, subject to actual subscription availability and capped storage/traffic. No GPU or server model inference is required under the selected design. Name.com provides the address; Azure supplies hosting and persistent private storage.

Illustrative public Azure retail prices retrieved4November for Central India, Linux consumption pricing:

| Example VM    | Hourly compute | 30 days at720hours |
| ------------- | -------------: | -----------------: |
| Standard_B1ms |      USD0.0224 |           USD16.13 |
| Standard_B2s  |      USD0.0448 |           USD32.26 |

These are example compute-only quotes, not selected/provisioned SKUs or total bills. Disk, public IP if applicable, database/storage, operations, backups, egress and logs are additional. Subscription eligibility/quotas, capacity, regional prices and the actual Azure offer must be checked before provisioning. The pricing response is retained outside Git in `campus-pilot-scope/azure-vm-retail.json` under the local evidence directory.

Proposed initial capacity envelope for planning:50–100 invited users and200MB cloud originals per account (10–20GB maximum original storage), then measure actual uptake before expanding. These are proposed caps, not agreed quotas or observed demand. Storage/index overhead and repeated downloads also count. Use a shared lightweight DB for owner-scoped metadata/index records; do not add an expensive dedicated vector service merely to store embeddings when queries run locally.

Preserve the student credit spending limit, configure alerts where available, and review daily cost. Budgets/alerts are not an automatic shutdown mechanism. Do not assume the $100 can cover unlimited uploads, large media downloads or server-side AI processing. No billing settings or Azure account were inspected or changed.

## Demand measurement and end of pilot

Define success before launch: activation after opening the INSIIT link, opted-in sync accounts, successful two-device use, repeat usage and voluntary usefulness/friction feedback. Do not treat page views as demand or upload private document/query contents for analytics. Local-only usage should be measured through explicit opt-in feedback/measurement, with any telemetry separately disclosed and approved.

Publish the actual pilot end date and cloud-retention terms at launch. Provide an export/download window within the month, explain what happens to cloud-only originals, and allow removal of cloud copies. At the end, stop billed compute and follow the agreed live-object/backup deletion policy. Local downloads can remain usable in the client; do not promise the whole app continues operating offline on every device after shutting down its origin without testing it.

## Next discussion

The PWA explanation, client-local processing/search, private account storage and one-time model download have now been discussed and accepted. Follow the [ordered implementation plan](2026-11-04-implementation-plan.md), starting with pilot isolation and contracts after implementation authorization. Resource quotas/configuration remain proposals until approved. No changes to the completed3November submission are implied.

References: [Azure retail prices API](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices), [Container Apps billing](https://learn.microsoft.com/en-us/azure/container-apps/billing), [Blob Storage](https://learn.microsoft.com/en-us/azure/storage/blobs/storage-blobs-introduction), [Azure credit spending limit](https://learn.microsoft.com/en-us/azure/cost-management-billing/manage/spending-limit), [GitHub Student Pack domain offers](https://education.github.com/pack).
