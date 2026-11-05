# Pilot sync protocol (draft v1)

Status: draft, 5 November 2026, for agreement before parallel work. The types in `pilot/contract/` are the machine-checkable version of this document; if the two disagree, fix one of them in the same change.

All endpoints live under `/api/v1` on the pilot origin, use JSON unless stated, and return `Cache-Control: no-store`. The service worker must never cache `/api/` responses or object download URLs.

## Identity and sessions

- The client signs in with Google through the pilot's own Firebase project and sends the Firebase ID token once to `POST /api/v1/session`.
- The server verifies the token's signature against Google's published keys, `iss` = `https://securetoken.google.com/<project-id>`, `aud` = `<project-id>`, expiry and issue time, `firebase.sign_in_provider` = `google.com`, `email_verified` = true and an email ending in `@iitgn.ac.in`. Anonymous or other providers are refused.
- The vault owner key is `(projectId, sub)`. The email is checked for eligibility but is never the ownership key, and no request field can name a different owner.
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
