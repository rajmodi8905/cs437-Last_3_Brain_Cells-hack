# Pilot specification: account Auto-sync

Status: draft, 5 November 2026. These statements cover only the one-month Auto-sync pilot. The root `SPEC.md` (S1 to S15) and its tests stay unchanged and must keep passing; nothing here replaces them. A statement is green only when its test runs against real behavior. Emulators and test identities are allowed during development, but hosted claims (P13, P14) need the real Azure deployment and real signed-in browsers.

The wire format, states and limits referred to below are defined in [protocol.md](protocol.md). Machine-checkable types live in `pilot/contract/`.

### P01 — Local only stays local

**Statement:** In Local only mode the app never initializes sign-in, never polls a sync endpoint and never sends library originals, titles, extracted text, embeddings or queries to the pilot API.

**Test:** Run save, process, search and open in Local only mode with request monitoring; assert zero requests to the pilot API and identity origins, and that existing documented model and webpage requests are unchanged.

### P02 — Sync only after explicit opt-in

**Statement:** Nothing is uploaded until the user has signed in and explicitly included a library. Signing in alone uploads nothing, and an existing local library is never included silently.

**Test:** Sign in without including a library and assert no upload operations; include it and assert uploads start only for the included items.

### P03 — Owner isolation

**Statement:** A vault is reachable only with a valid session for its owner. The server derives ownership from the verified identity (Google subject of a verified `@iitgn.ac.in` Workspace account), never from a client-supplied field.

**Test:** User A reads and writes its vault; user B, an expired or wrongly signed token, a non-IITGN or unverified email, an anonymous identity, a guessed item ID and an edited ownership field are each rejected.

### P04 — Exact original sync

**Statement:** A synced original arrives on another device byte-for-byte identical, with the same SHA-256, length, MIME type, kind, title, capture time and source URL.

**Test:** Upload a known PDF from client A; download it on client B and compare hash, length and metadata to the source.

### P05 — Versioned index sync

**Statement:** An index bundle is accepted and used only if it matches the item's current original hash, search-metadata digest and the exact index version, and every vector is finite, normalized and 768-dimensional.

**Test:** Publish a valid bundle and confirm it is current; publish bundles with a stale original hash, wrong index version, wrong dimension, non-finite values or a digest mismatch and confirm each is rejected without replacing the valid state.

### P06 — Search the cloud catalogue locally

**Statement:** A second device searches synced items with its own local query model and the existing ranking policy, and each result keeps its page or time provenance. No query text leaves the device.

**Test:** On client B, without downloading the original, a natural-language query returns client A's PDF at the correct page; request monitoring shows no query sent to any server.

### P07 — Selective offline originals

**Statement:** Keep offline downloads and verifies an original and keeps it available offline; Remove download deletes only the local copy and never deletes the account document.

**Test:** Keep an item offline, go offline and open it; Remove download, confirm the catalogue entry and index remain and that no delete operation was sent.

### P08 — Idempotent, resumable upload

**Statement:** Retrying an upload or completion with the same operation ID never creates a duplicate item, and an interrupted upload resumes without corrupting the stored original.

**Test:** Drop the completion response and retry; restart the server mid-upload and resume; assert exactly one item with the correct hash.

### P09 — Conflicts, tombstones and stale devices

**Statement:** Writes carry an expected revision. Deletion wins over any older revision, a stale device cannot recreate a deleted item, and two renames from the same base revision produce a reported conflict instead of a silent overwrite.

**Test:** Delete on A while B is offline with an older revision; reconnect B and replay its changes; assert the item stays deleted. Rename on both from the same revision and assert one succeeds and one reports a conflict.

### P10 — Pause, vault removal and account switch

**Statement:** Pause stops new transfers and polling on that device only. Remove cloud vault deletes all of the account's cloud objects and moves the vault to a new epoch that old devices cannot write to. Switching accounts never mixes two libraries.

**Test:** Pause and assert no further sync requests; remove the vault and assert an old device's writes are rejected; sign in as another user and assert the first user's items are not visible.

### P11 — All six formats within limits

**Statement:** Images, PDFs, notes, webpages, audio and video sync with their existing per-file limits, and the account quota is enforced on stored bytes rather than client-declared sizes.

**Test:** Sync one of each kind including the largest accepted size; exceed the account quota and assert a clear quota error with nothing partially published.

### P12 — Google sign-in

**Statement:** Users sign in with a Google account through Google sign-in run by the pilot server (no Firebase); only verified `@iitgn.ac.in` Workspace accounts get a session, each sign-in attempt is usable once, and sign-out ends cloud access on that device. INSIIT handoff is future scope and is not claimed.

**Test:** Sign in with a test IITGN account and receive a session; a non-IITGN or personal Google account is refused; a replayed, expired, wrong-state or wrong-nonce return opens no session; after sign-out sync requests fail as unauthenticated.

### P13 — Durability, restart and backup

**Statement:** Synced data survives server restarts and container replacement, and a backup can be restored to a working state.

**Test:** Restart the API and storage, then verify catalogue and originals; restore a backup into a fresh environment and verify an item end to end.

### P14 — Hosted PWA

**Statement:** The hosted origin serves the installable PWA over HTTPS with its workers, WASM runtime and policies; private API responses and signed object URLs are never cached by the service worker.

**Test:** On the hosted origin, install the PWA, check the service-worker caches for private responses, update to a new build and confirm the library and offline originals remain.

### P15 — Export, shutdown and privacy of metrics

**Statement:** Before the announced end date users can export their cloud originals; pilot metrics are aggregate counts only and never include document names, text or queries.

**Test:** Export a vault and compare hashes with the stored originals; inspect the metrics records and confirm they hold no document or query content.
