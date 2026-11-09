# Pilot sync protocol (draft v1)

Status: draft, 5 November 2026, for agreement before parallel work. The types in `pilot/contract/` are the machine-checkable version of this document; if the two disagree, fix one of them in the same change.

All endpoints live under `/api/v1` on the pilot origin, use JSON unless stated, and return `Cache-Control: no-store`. The service worker must never cache `/api/` responses or object download URLs.

## Identity and sessions

- The server runs Google sign-in itself; there is no Firebase. `GET /api/v1/auth/google/start` stores a one-use attempt (random state, nonce and PKCE verifier, ten minutes), sets an HttpOnly `recall_login` cookie for `/api/v1/auth`, and redirects to Google with `hd=iitgn.ac.in`, `prompt=select_account` and an S256 code challenge.
- `GET /api/v1/auth/google/callback` takes the attempt named by the cookie (removing it), checks the state, exchanges the code with the client secret and PKCE verifier, verifies the ID token, opens a session and redirects to `/#/settings`. Failures redirect to `/?signin=failed|cancelled|not-eligible#/settings` without a session; the app shows the message and removes the parameter.
- An ID token is accepted when its RS256 signature matches Google's published OpenID keys, `iss` is `https://accounts.google.com` (or `accounts.google.com`), `aud` is the pilot's OAuth client ID, it is within its lifetime, its `nonce` matches the attempt (redirect flow), `email_verified` is true, the email ends in `@iitgn.ac.in` and the Workspace domain claim `hd` is `iitgn.ac.in` (personal Google accounts have none). `POST /api/v1/session` accepts such a token directly; local development servers use it with their own signing key.
- The vault owner key is `google:<sub>`. The email is checked for eligibility but is never the ownership key, and no request field can name a different owner.
- A successful exchange returns `csrf`, `email`, the vault `epoch` and `account`, an opaque 32-hex ID (a SHA-256 prefix of the owner key) that devices use to keep each account's local state apart. It also sets an HttpOnly, Secure, SameSite=Lax session cookie. Mutating requests must also send the `X-Recall-CSRF` header value returned with the session, and a matching `Origin`. `DELETE /api/v1/session` ends the session.
- INSIIT identity handoff is future scope and has no endpoint in v1.

## Vault and epochs

Each owner has one vault with an `epoch` (starts at 1). Removing the cloud vault deletes its objects and increments the epoch. Every write carries the epoch the client believes is current; a stale epoch is rejected with `VAULT_RESET`, so an old device cannot silently recreate a removed vault.

## Items and revisions

A cloud item is identified by a client-generated `globalId` (UUID v4), separate from local item IDs. Each change increments the item's `revision`. Fields:

| Field                                     | Rule                                                         |
| ----------------------------------------- | ------------------------------------------------------------ |
| `globalId`                                | UUID v4, unique per vault                                    |
| `kind`                                    | one of `image`, `pdf`, `note`, `webpage`, `audio`, `video`   |
| `title`                                   | 1 to 120 code points                                         |
| `mimeType`, `byteLength`, `contentSha256` | describe the immutable original; SHA-256 as 64 lowercase hex |
| `createdAt`                               | capture time, epoch milliseconds                             |
| `sourceUrl`                               | optional, `https:` or `http:` only                           |
| `revision`                                | positive integer, server-assigned                            |
| `deleted`                                 | tombstone flag; a deleted item never comes back              |
| `index`                                   | descriptor of the current index bundle, or absent            |

Per-kind byte limits are the app's existing `LIMITS` (20 MB images and PDFs, 50 MB audio, 100 MB video, 20,000 code points of text). Account quota is enforced on stored and reserved bytes, never on client-declared sizes; proposed starting quota 200 MB of originals per account, to be agreed.

## Writes

Every mutating request carries an `opId` (UUID v4). Repeating a request with the same `opId` returns the original result without applying it twice. Every change to an existing item carries `expectedRevision`.

- **Upload original:** `POST /items/{globalId}/upload` reserves quota and returns an upload ID; bytes go in bounded chunks to `PUT /uploads/{uploadId}/chunks/{n}`; `POST /uploads/{uploadId}/complete` makes the server verify length, hash, MIME type and owner, then publish the item at revision 1 and append a change. The item is invisible until completion succeeds.
- **Publish index:** `PUT /items/{globalId}/index` with an index bundle (below). Accepted only if it matches the item's current `contentSha256`, its current `searchMetadataDigest` and a supported `indexVersion`.
- **Rename:** `PATCH /items/{globalId}` with `title` and `expectedRevision`. If the revision moved on, the response is `REVISION_CONFLICT` with the current item so the client can resolve it. A rename makes the old index stale until a matching bundle is published.
- **Delete:** `DELETE /items/{globalId}` with `expectedRevision`. Deletion always wins: it is applied even against a newer revision, and any later write to a deleted item returns `ITEM_DELETED`.
- **Remove vault:** `DELETE /vault` with the current epoch and an explicit confirmation field.

## Reading changes

`GET /changes?epoch=E&after=C` returns changes in commit order with a `cursor`. Cursors are allocated inside the write transaction so a reader can never see a later commit before an earlier one. A client stores the cursor and applied changes atomically. If the cursor is older than the retained history or the epoch changed, the response is `RESYNC_REQUIRED` and the client fetches the full catalogue.

`GET /items/{globalId}/original` and `GET /items/{globalId}/index` stream the immutable object for the current revision, with HTTP range support for originals.

## Index bundle

Matches the local `IndexedSegment` shape:

| Field                                               | Rule                                                                                                                                               |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `globalId`, `contentSha256`, `searchMetadataDigest` | must match the item's current state                                                                                                                |
| `indexVersion`                                      | exact string; v1 accepts the app's current `INDEX_VERSION`                                                                                         |
| `dimension`                                         | always 768                                                                                                                                         |
| `segments[]`                                        | `modality` (`text` or `visual`), `location` (`whole`, `page` with page ≥ 1, or `time` with 0 ≤ start < end), optional `text` excerpt, and `vector` |
| `vector`                                            | 768 finite numbers with L2 norm within 1e-3 of 1                                                                                                   |

At most 2,000 segments per bundle in v1. A malformed bundle is rejected as a whole and never replaces a valid one.

## Client states

Each synced item shows two independent states: **original** (`local-only`, `uploading`, `synced`, `cloud-only`, `downloading`, `offline-copy`) and **search** (`pending`, `indexed`, `stale`, `failed`). A cloud-only original never counts as available offline, and the only local copy is never evicted before the server has acknowledged it.

## Errors

`{ "error": { "code", "message", "retryable" } }` with codes: `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND` (also returned for another account's items, so they cannot be told apart from missing ones), `NOT_ELIGIBLE` (not a verified IITGN Google account), `VAULT_RESET`, `REVISION_CONFLICT`, `ITEM_DELETED`, `QUOTA_EXCEEDED`, `LIMIT_EXCEEDED`, `HASH_MISMATCH`, `INDEX_INCOMPATIBLE`, `INVALID_INPUT`, `RESYNC_REQUIRED`, `INTERNAL_ERROR`.

## Implementation status (5 November)

`pilot/server/` implements the first server slice with plain `node:http`, no framework: Google token signature checks with Node's crypto (`tokens.ts`, with a cached Google key source for production), sessions with origin and CSRF checks, begin/chunk/complete uploads with hash and length verification, account quota, rename and delete through `decideWrite`, the change feed and original downloads. `pilot/tests/server.test.ts` covers it against a real local HTTP server with locally signed test tokens.

Storage sits behind `PilotStore` and `ObjectStore` (`store.ts`). Only the in-memory versions exist (`memory.ts`); they are not durable and are for tests and local development only.

Not built yet: PostgreSQL and Azure Blob storage adapters, index bundle publishing and download, vault removal, HTTP range downloads, expiry of abandoned uploads and their quota reservations, rate limiting, and a runnable server entry point. Real Google sign-in needs the pilot Firebase project, which does not exist yet.

`pilot/client/` implements the device side: a typed API client (`api.ts`) and a sync engine (`sync.ts`). Each pass reconciles the local library against the last agreed state and saves the resulting operations, with their operation IDs, before sending anything. It then pulls the change feed and applies other devices' renames and deletions to the local library, and finally sends the saved operations. When both devices renamed an item, the engine keeps both titles and marks a conflict instead of overwriting. The existing app storage is not modified; the engine reads it through the `LocalLibrary` interface. `pilot/tests/sync.test.ts` runs two simulated devices against the real local API, including lost responses, a network outage with a restart, and an account switch.

Not built yet on the client: the IndexedDB state store and the adapter around the app's Dexie library, the mode, sign-in and conflict screens, index bundle sync and local search over cloud items, downloads kept offline, cross-tab coordination, and handling of `needsResync` after a vault reset.

Added 5 November, later: the sync state is saved in IndexedDB, one database per account (`client/idb.ts`), and bound to one local library; an engine pointed at a different or recreated library refuses to run instead of planning mass deletions. `client/library.ts` adapts the app's existing Dexie repository without changing it. `server/static.ts` serves the built PWA and `/api` on one origin, and `npm run pilot:server` (`server/main.ts`, settings in `server/config.ts`) runs it locally with in-memory storage. Until the pilot Firebase project exists, a local development signing key can stand in for Google, and the server refuses to start with one unless the origin is `localhost` or `127.0.0.1`.

Still not built: the mode, sign-in and conflict screens, a browser-level two-device test of the real app, index bundle sync and cloud search, offline downloads, cross-tab coordination, durable server storage and real Google sign-in.

Phase 4 slice, 5 November: `GET /api/v1/config` reports the sign-in mode (`google`, or `dev` on a local development server); `POST /api/v1/dev/token` exists only on a development server and mints a Firebase-shaped token for a typed email, which then goes through the normal session checks, so non-IITGN emails are still refused; `GET /api/v1/session` restores the CSRF token after a reload. Settings has an Auto-sync section (`pilot/ui/AutoSyncSection.tsx`, logic in `pilot/client/autosync.ts`): Local only by default, sign-in, explicit "Include this device's library", sync status, conflicts, and a list of cloud items not on this device with byte-exact download. The library's sync ID is a random value kept in the library's own database, so a recreated database is detected. `npm run test:pilot:e2e` builds the app, starts `pilot:server` with a generated development key and runs two-browser tests of the real app. The service worker never handles `/api` requests.

Not yet: Google sign-in through Firebase, opening cloud items in the app viewer or keeping them offline, search over cloud items, durable server storage, and the hosted deployment.

Phase 5 and 6, 5 November. Server: `PUT`/`GET /items/{id}/index` store and serve index bundles checked against the item's current hash, title digest (`searchMetadataDigest`, SHA-256 of the title JSON) and `PILOT_INDEX_VERSIONS` (a test keeps it equal to the app's `INDEX_VERSION`); publishing an index does not change the item's revision, so it never causes rename conflicts; deleting an item deletes its index. `DELETE /vault` with `{ epoch, confirm: "remove-cloud-library" }` deletes every cloud copy for the account, drops unfinished uploads and moves to a new epoch; old-epoch writes get `VAULT_RESET` and old-epoch change reads `RESYNC_REQUIRED`. Upload completion checks the epoch before anything else.

Devices publish the index of each processed item once per (file, title, index version), fetch usable indexes of other devices' items into a per-account store, drop stale ones, and expose them to the app's search, which ranks them with local segments as `cloud:<id>` results shown with title, excerpt, page or time and a Download button. Phase 6 adds Keep offline (verified copy that opens without the network), Remove download (this device only), Delete from the cloud library (all devices, including the one that saved it), Pause sync on this device, Remove cloud library (with confirmation; this device starts over opted out), Start again after a removal elsewhere (the device sends nothing until then), sign-out with optional removal of this account's local sync data, and a Web Locks lease so one tab syncs an account at a time. The sync controller is app-wide, so syncing continues outside Settings.

Not yet verified: retrieval of a synced cloud item with the real local models (the merge is tested through `LocalEngine.search` with a stand-in query vector), WebKit and physical devices, durable server storage, real Google sign-in and the hosted deployment.

Phase 7, 5 November. All six kinds (image, PDF, note, webpage, audio, video) sync through the same path, keeping kind, MIME type and source link, byte for byte; tests cover the largest accepted video (100 MB) and the longest note (20,000 four-byte code points), and one byte over a limit is refused. Each upload chunk must fill exactly its place in the declared file, so stored bytes never exceed the declared size. When the account quota is reached nothing is published, the app says the cloud library is full, and the waiting item uploads by itself once space is freed. `GET /items/{id}/original` answers single `bytes=` ranges with `206` (and `416` with `bytes */size` when the range cannot be served); devices download originals larger than 4 MB in parts, retry a lost part once and check the whole hash before use. A cloud item opens in the app's own viewer (text, image, PDF page, audio or video time), from Settings or from a search result at the page or time found; it is not saved on the device, so no backup export is offered.

Entry: an INSIIT link only opens the site (`/?from=insiit`); INSIIT does not sign anyone in, and Settings says so. On load, entry and credential-looking parameters (`token`, `id_token`, `access_token`, `refresh_token`, `code`, `credential`, `oobCode`) are removed from the address with `history.replaceState`, and tokens are never accepted from a URL. Direct Google sign-in was first built on Firebase and then replaced the same day; see the next paragraph.

Sign-in without Firebase, 5 November, later: the server runs Google's OpenID Connect sign-in itself, as described under "Identity and sessions". Settings shows "Sign in with Google" when the server is configured with `PILOT_GOOGLE_CLIENT_ID` and `PILOT_GOOGLE_CLIENT_SECRET` (both or neither; not together with a development key); the button is a normal page navigation, not a popup, and the app loads no Google or Firebase code. The Firebase packages were removed. `pilot/tests/google-signin.test.ts` drives the flow against a stand-in for Google's token endpoint (PKCE proof, one-use attempts, wrong state, missing cookie, expiry, nonce, personal and other-domain accounts, cancel, token-endpoint failure), and `pilot/e2e/google-redirect.spec.ts` runs the app against a second local server in Google mode, catching the server's redirect so the browser never contacts Google.

Not yet verified: real Google sign-in (needs the Google OAuth client, its registered callback URL and a test account), the redirect from an iOS home-screen app and on physical devices, a one-use INSIIT login handoff (future scope, not claimed), expiry of abandoned uploads and clean-up of abandoned sign-in attempts in durable storage, durable server storage and the hosted deployment.

Durable storage, 6 November: `pilot/server/postgres.ts` (PostgreSQL, schema `pilot` by default, numbered migrations applied once under an advisory lock) and `pilot/server/blob.ts` (Azure Blob Storage; a private container) replace the in-memory stores outside local development. Every multi-row change is one transaction; change cursors are allocated under a row lock on the account's vault, so they commit in order, and `changesAfter` reports the last change it returned. Saving an item is refused if the cloud library was reset since the request's epoch check. Upload chunks are stored as staging objects (`staging/<uploadId>/<n>`) instead of server memory; completion hashes them one at a time, joins them into the original (Blob block list) and deletes them, so the server never holds a whole file. A completion that crashed after saving its item finishes on retry. Removing the cloud library also deletes half-sent uploads' staged chunks. Originals are read from storage only for the requested range. On Azure the server gets Blob tokens from the VM's managed identity through the instance metadata service; no storage key is configured. Settings: `PILOT_DATABASE_URL`, `PILOT_DATABASE_SCHEMA`, `PILOT_BLOB_ACCOUNT_URL`, `PILOT_BLOB_CONTAINER`, optional `PILOT_MANAGED_IDENTITY_CLIENT_ID`; a public origin refuses to start without durable storage, and `PILOT_BLOB_CONNECTION_STRING` (Azurite) is accepted only on a local origin. `npm run test:pilot:storage` runs the whole pilot suite with PostgreSQL 17 and Azurite in Docker, including the same conformance tests for memory and durable stores and server restarts (catalogue, originals, renames, sessions, an interrupted upload). Without Docker, `npm run test:pilot` reports those tests as skipped.

Clean-up and limits, 6 November: an unfinished upload expires 24 hours after it began (chunk and completion requests then get `NOT_FOUND`), and a sweep at start-up and every 10 minutes deletes expired sessions and sign-in attempts, expired uploads with their staged chunks (freeing their quota), and finished-upload records and saved operation results older than 30 days. A device whose upload expired begins it again once with new operation IDs, and a resumed upload no longer re-sends chunks the server already acknowledged. Rate limits are in-process token buckets: every API request per client address (600, refilling 10 a second), sign-in requests per address (`POST /session`, `/dev/token`, `/auth/*`; 10 a minute by default, `PILOT_SIGN_IN_PER_MINUTE`) and signed-in requests per account (300, refilling 5 a second). Over a limit the API answers `429 RATE_LIMITED` (retryable) with `Retry-After`; devices keep the work and try in the next pass instead of marking the item failed. The client address comes from the last `X-Forwarded-For` entry only with `PILOT_TRUST_PROXY=1`, set when the pilot runs behind its own HTTPS proxy.

Backup and restore, 6 November: `pilot/server/backup.ts` takes a logical backup of every pilot table from one read-only snapshot (`REPEATABLE READ`), as gzipped JSON lines with a manifest (format, database version, row counts, SHA-256), into its own private Blob container (`PILOT_BACKUP_CONTAINER`, default `pilot-backups`, never the originals' container). The server takes one at start-up and then every `PILOT_BACKUP_EVERY_HOURS` (24) and keeps the newest `PILOT_BACKUP_KEEP` (14); the manifest is written last, so an interrupted backup is never listed or restored. A restore checks the hash, the format and that the backup's database version equals the code's, then writes into an empty database (or schema) in one transaction, and refuses one that has data. `verifyObjects` then checks that every live item's original and index exist in Blob storage. Operators use `node .cache/pilot-server/backup.mjs list | now | verify | restore <key> [--schema <name>]` with the server's environment. Originals and index bundles are not copied: on Azure, the storage account's soft delete and blob versioning (Phase 8) protect them; data at rest is encrypted by Azure Storage. Rehearsed locally with the bundled server: backup, a fresh database, restore (0 missing objects), the server running from it with the same session, byte-identical original, ranges and change feed; a second restore was refused.

Final release preparation, 6 November: container packaging lives in `pilot/deploy/` with digest-pinned Node 24, PostgreSQL and Caddy images, mounted secret files and a separate data-disk mount. `pilot/azure/` defines the isolated VM/storage/network, Blob versioning/soft delete and a scoped one-month compute cutoff. Each owner mutation now holds a PostgreSQL advisory transaction lock from precondition reads through publication and the saved idempotent reply; the API sends success only after commit. Concurrent rename/delete, quota and retry regressions exercise two API servers sharing PostgreSQL.

Fresh Local only startup reads only its local activation preference and makes no pilot API/sign-in requests. Explicit Set up Auto-sync enables contact and remembers that choice for reload/Google return; signing out or Use Local only clears it. Library inclusion remains a separate upload permission. Settings exports verified cloud originals and whitelisted metadata in split local-restore-compatible ZIPs, excluding embeddings and credentials.

Remaining implementation limit: staged chunk objects whose recording failed in a crash are not swept. Hosted Azure/Google and physical-device results require their own evidence; local suites do not imply they pass.

Code-review fixes, 9 November: index bundles count toward the account quota like originals (the stored bundle size is kept with the item; replacing a bundle counts only the new one, deleting the item frees it) and an index that would pass the quota gets `QUOTA_EXCEEDED`. Sign-out is recorded on the device before `DELETE /session` is sent; if the server cannot be reached the app says the device may still be signed in, never restores that session, and ends it the next time the service is reachable (on start-up, on turning sync on, or with Sign out again). When the app starts and the service cannot be reached, it opens the last signed-in account's local sync data, so items kept offline are listed in Settings and open or download without the network; signing out clears that account.
