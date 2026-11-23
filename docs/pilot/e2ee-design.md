# End-to-end encrypted Auto-sync: design

Status: built, 23 November 2026. Phase 0, the envelope library, is built: `pilot/contract/e2ee.ts`, tested in `pilot/tests/e2ee.test.ts`. Phase 1, the server, is built: sealed items, vault settings and pairing in `pilot/server`, tested in `pilot/tests/e2ee-server.test.ts`. Phase 2, the sync engine, is built: it seals and opens items in `pilot/client/sync.ts`, tested in `pilot/tests/e2ee-client.test.ts`. Phase 3, the screens, is built: `pilot/ui/EncryptionPanel.tsx` in Settings, with pairing tested in `pilot/tests/e2ee-pairing.test.ts` and both flows in a browser in `pilot/e2e/encryption.spec.ts`. Phase 4, sealing what is already in the cloud library, is built: the reseal operation on the server and in the engine, tested in `pilot/tests/e2ee-reseal.test.ts` and in a browser. Phase 5 adds the end-to-end test on PostgreSQL and Azure Blob (`pilot/tests/e2ee-durable.test.ts`), the privacy pages, the protocol section and the E statements in SPEC.md. It extends the [sync protocol](protocol.md) (v1) and the [pilot spec](SPEC.md).

## Summary

Auto-sync can become end-to-end encrypted without changing how search works, because the server never searches app content: each device downloads the index bundles and ranks them locally (P06). The server only has to store and hand back bytes. This design encrypts every original, index bundle and piece of item metadata on the device, with a key the server never sees, so the server and Azure hold only ciphertext.

The Telegram (and WhatsApp) bot stays as it is: the server must read what a student sends in order to OCR it, index it and answer searches, so bot items cannot be end-to-end encrypted. They stay in the same library, marked as readable by the server. One visible change follows from this: the bot can search only what was sent through the bot, not what devices synced.

## What changes for the student

|                                                     | Today (v1)                                                     | With this design                                                                         |
| --------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| In transit                                          | TLS 1.3 to Caddy                                               | Unchanged, plus the payload itself is encrypted                                          |
| Originals in Azure Blob                             | Plaintext (Azure encrypts at rest with Microsoft-managed keys) | AES-256-GCM ciphertext; the key never leaves devices                                     |
| Index bundles (vectors, text excerpts)              | Plaintext                                                      | Ciphertext                                                                               |
| Title, source URL, type, capture time, content hash | Plaintext in PostgreSQL                                        | One sealed metadata blob                                                                 |
| What the server still sees                          | Everything above                                               | Account, item IDs, revisions, ciphertext sizes, upload and change times, number of items |
| App search queries                                  | Never sent                                                     | Never sent                                                                               |
| Items sent to the bot                               | Readable by the server                                         | Still readable by the server, and labelled as such                                       |
| Bot searches                                        | Cover the whole cloud library                                  | Cover only items sent through the bot                                                    |
| Losing every device and the recovery code           | Cloud library still readable after sign-in                     | Cloud library is gone for good                                                           |

## Threat model

Protects against:

- Anyone who can read the server's storage: project operators, Azure, a leaked database dump or Blob container, and the daily database backups.
- A stolen session cookie or Google account alone. Signing in proves identity, not possession of the key, so it gets ciphertext only.
- Tampering with stored objects. Swapped, truncated, reordered or edited chunks and bundles fail decryption, and nothing local is replaced.

Does not protect against:

- A compromised device or browser profile. The key and the local library live there, as the local library already does today.
- A malicious app update. The app is delivered from our own server, so a changed bundle could read the key. This is the standard limit of web-delivered encryption, and the privacy page must say so, not claim absolute protection.
- Traffic analysis. Sizes, timing and counts stay visible (see "Open questions" for padding).
- Bot items, by design.

## Keys

All cryptography uses the browser's Web Crypto API (`crypto.subtle`), with no new dependencies. The server does no cryptography beyond the SHA-256 checks it already does on uploads.

| Key                 | What it is                                                                                      | Where it lives                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Recovery secret `R` | 128 random bits, shown once as a recovery code                                                  | Written down by the student, and in IndexedDB in the account's per-account database `anyrecall-pilot-sync-<account>` |
| Vault keys          | A wrapping key (AES-KW) and a check key (HMAC-SHA-256), both derived from `R` with HKDF-SHA-256 | Derived again on each device from `R`; never exported                                                                |
| Item key `DK`       | 256 random bits per item version, wrapped with the vault wrapping key (AES-KW)                  | Wrapped form stored on the server with the item                                                                      |
| Pairing key         | Ephemeral ECDH P-256 pair, used once                                                            | Memory only, during "Add a device"                                                                                   |

- **Why per-item keys.** Rotating or removing one item never touches the others, and re-sealing an item (a new original) gets a fresh key. Because each `DK` encrypts exactly one original and one index bundle, chunk nonces can be counters without risking reuse.
- **Key derivation.** Both vault keys use HKDF-SHA-256 with `R` as input and `vaultSalt` as salt. The info string is `ar-e2ee-1|vault-wrap` for the wrapping key and `ar-e2ee-1|vault-check` for the check key.
- **Vault salt and key check.** On setup the device stores two public values with the vault: a random 16-byte `vaultSalt`, and `keyCheck = HMAC-SHA-256(check key, "ar-e2ee-1|key-check|" + epoch)`. A device that enters a recovery code recomputes `keyCheck` and is told "That recovery code is for a different library" before it tries to decrypt anything.
- **Recovery code format.** 128 bits as 26 Crockford base32 characters plus one check character, shown in groups of four (`7KQ2-9MXA-...`). It has full entropy, so no password stretching is needed.
- **What a device stores.** The 16-byte recovery secret `R`, because pairing hands `R` to the new device and Settings can show the recovery code again. The vault keys are derived from it as non-extractable `CryptoKey`s. Making them extractable or not would add little: script running in the page could still use them to decrypt. `R` is deleted with the rest of the account's local sync data when a student signs out with "also remove this account's offline copies and sync data" ticked, and when the vault is removed.
- **Epochs.** Removing the cloud library already increments the epoch and resets every device (`VAULT_RESET`). The next setup after a reset creates a new `R` and `vaultSalt`, and so new vault keys, so an old device's key can never decrypt the new library.

## Sealed formats

Format version `ar-e2ee-1`. Every encrypted unit uses AES-256-GCM with a 128-bit tag, and binds where it belongs through the additional authenticated data (AAD), so a ciphertext cannot be moved to another item, epoch or position.

**Original.** Encrypted in chunks of 4 MiB of plaintext, matching today's upload chunks and download ranges, so each ciphertext chunk is 4 MiB + 16 bytes (the last is shorter).

- Nonce: 4 zero bytes followed by the 64-bit big-endian chunk index. This is safe because `DK` is unique to this original.
- AAD: `"ar-e2ee-1|original|" + globalId + "|" + epoch + "|" + chunkIndex + "|" + (isLast ? 1 : 0)`.
- The final-chunk flag stops truncation; the index in the AAD stops reordering.
- Range downloads ask for whole ciphertext chunks: chunk `i` is bytes `i * (4 MiB + 16)` to `min((i + 1) * (4 MiB + 16), total) - 1`. Viewers and `downloadRangeBytes` keep working, since they already read in 4 MiB steps.

**Index bundle.** The existing `IndexBundle` JSON, gzipped, then encrypted in one piece with `DK` and a random 96-bit nonce. AAD: `"ar-e2ee-1|index|" + globalId + "|" + epoch + "|" + metaRevision`. Bundles are at most 24 MiB today (`MAX_INDEX_BYTES`), and that limit applies to the ciphertext.

**Sealed metadata.** A JSON object `{ kind, title, mimeType, byteLength, contentSha256, createdAt, sourceUrl }`, encrypted with `DK` and a random 96-bit nonce. AAD: `"ar-e2ee-1|meta|" + globalId + "|" + epoch + "|" + metaRevision`. A rename re-seals this object only; the original and its key stay as they are.

The plaintext `contentSha256` inside the sealed metadata is still checked: after decrypting an original, the device hashes it and compares, exactly as `SyncEngine.download` does today.

## Protocol changes (v1 + sealed items)

Sealed items are added alongside v1 items, not instead of them. A vault is either **plain** (today's behaviour, unchanged) or **sealed** (encryption turned on). A sealed vault can still hold plain items, which is how bot items work.

**Vault.** `PUT /vault/e2ee` takes `opId`, `epoch`, `vaultSalt` (16 bytes) and `keyCheck` (32 bytes), both base64url, and answers `{ e2ee: { vaultSalt, keyCheck } }`. It sets them once per epoch: the same settings again are answered the same way, other settings are refused with `INVALID_INPUT`, and removing the cloud library clears them. From then on `GET /session` and every `GET /changes` page include `e2ee: { vaultSalt, keyCheck }`, so each sync pass knows before it sends anything; a plain vault's responses have no `e2ee` field, so existing clients see no change.

**Item fields for sealed items.** The server stores and returns these; the v1 plaintext fields are absent.

| Field                              | Rule                                                                                                                                    |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `enc`                              | `"ar-e2ee-1"`                                                                                                                           |
| `wrappedKey`                       | base64url, AES-KW-wrapped `DK` (40 bytes)                                                                                               |
| `sealedMeta`                       | base64url ciphertext, at most 16 KiB                                                                                                    |
| `metaRevision`                     | positive integer, incremented on each rename; the server checks it only grows                                                           |
| `cipherByteLength`, `cipherSha256` | the stored original's ciphertext; the server verifies these on upload completion, as it verifies `byteLength` and `contentSha256` today |

**What the server stops checking for sealed items, and who checks instead.**

| Check today (server)                                            | For sealed items                                                                                                                                            |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-kind size limit from `kind`                                 | Server: one overall ciphertext limit (100 MB, the largest per-kind limit, plus 16 bytes per chunk). Device: per-kind limits, as it does before saving today |
| `contentSha256` and MIME type of the original                   | Server: `cipherSha256` and length (transfer integrity). Device: plaintext hash after decrypting                                                             |
| Index bundle matches `contentSha256` and `searchMetadataDigest` | Server: the bundle's `metaRevision` equals the item's. Device: decrypted bundle matches its sealed metadata                                                 |
| Vectors: 768 finite numbers, unit norm, at most 2,000 segments  | Device, after decrypting, with the same `validateIndexBundle` from `pilot/contract`. A bad bundle is skipped locally and never replaces a good one          |
| Title length, `sourceUrl` scheme                                | Device, before sealing                                                                                                                                      |

Unchanged for sealed items: `opId` idempotency, `expectedRevision` and `REVISION_CONFLICT`, delete-always-wins tombstones, the change feed and cursors, quota (now counted in ciphertext bytes, which are slightly larger), `X-Recall-Account`, CSRF, rate limits, and the owner-prefix check on every object key.

**Upload.** `POST /items/{globalId}/upload` takes `{ opId, epoch, sealed: { enc, wrappedKey, sealedMeta, metaRevision: 1, cipherByteLength, cipherSha256 } }` for a sealed item, and keeps only those six fields. Chunks and completion work as today, on ciphertext, and the quota counts `cipherByteLength`. An encrypted vault refuses plain uploads from devices, and a plain vault refuses sealed ones, both with `INVALID_INPUT`; the bot's own items are not uploaded through this route. The published item is `{ globalId, revision, deleted, sealed }`, plus `sealedIndex` once there is one. `GET /items/{globalId}/original` serves the ciphertext as `application/octet-stream`, with `ETag: "sha256-<cipherSha256>"` and byte ranges, so a device can fetch and open one chunk at a time.

**Rename.** `PATCH /items/{globalId}` takes `{ opId, epoch, expectedRevision, sealedMeta, metaRevision }`. A stale `expectedRevision` is `REVISION_CONFLICT`; a `metaRevision` that does not grow, or a plain `title`, is `INVALID_INPUT`. The old index bundle becomes stale until the device publishes one for the new `metaRevision`, the same rule as today's title digest.

**Index.** `PUT /items/{globalId}/index` takes `{ opId, epoch, sealedIndex, metaRevision }`, with the sealed bundle as base64url. A `metaRevision` other than the item's is `INDEX_INCOMPATIBLE`, and a plain `bundle` is `INVALID_INPUT`. The item then lists `sealedIndex: { metaRevision, byteLength }`, and `GET /items/{globalId}/index` serves the bundle as `application/octet-stream`.

**Delete.** As today. The tombstone is `{ globalId, revision, deleted: true }`; the server keeps no wrapped key or sealed metadata for it, and deletes the original and index objects after the tombstone commits.

**Storage.** Sealed items share the `items` table and change feed with plain ones, with only the public fields in `data`. `PilotStore.getItem`, which all bot code uses, never returns a sealed item; the API routes read both kinds. The vault settings are a new `vaults.e2ee` column, and pairing requests a new `pairings` table that backups leave out. This is database migration 7, so the first release with it goes through the manual release path in [deployment.md](deployment.md), as migrations 3 to 6 did.

## The sync engine (phase 2)

The engine in `pilot/client/sync.ts` does all sealing and opening, so the screens and search keep working with the same item fields.

- **Knowing the library is encrypted.** Each pull stores the `e2ee` settings from `GET /changes`. The engine derives the vault keys from the secret this device keeps and uses them only if the key check passes for the current epoch.
- **Locked.** Without a matching secret the pass stops after the pull and returns `locked`: nothing is applied, sent or uploaded in plain, and local items wait as pending uploads. `unlock(code)` checks a typed recovery code against `keyCheck` before keeping it, so a wrong code is refused (`WRONG_KEY`) and a mistyped one too (`INVALID_CODE`).
- **Turning it on.** `turnOnEncryption()` makes `R` and the salt, keeps them on the device first, then calls `PUT /vault/e2ee` and returns the recovery code. A retry after a lost reply sends the same settings again. If the server refuses, the unused secret is deleted. `recoveryCode()` shows the code again.
- **Uploads.** In an encrypted library new uploads are sealed. The wrapped item key and sealed metadata are kept with the pending upload before it begins, so a resumed upload seals exactly the same ciphertext and its declared hash still matches. An upload begun in plain before encryption was turned on finishes in plain.
- **Opening.** Sealed items are opened as they arrive, and the device's catalogue holds their opened fields next to `sealed`, so listing, download, Keep offline and export see titles and plaintext hashes as before. An item that does not open (tampered, or metadata moved from another item) is counted as failed and the catalogue keeps what it had.
- **Originals.** A sealed original is downloaded one sealed chunk per request when it has several, and each chunk is opened as it arrives. The plaintext is checked against the sealed `contentSha256`. Offline copies are kept decrypted on the device.
- **Renames and indexes.** A rename seals the metadata again under the next `metaRevision`. An index bundle is sealed for the item's current `metaRevision`, and only when the cloud copy already has this device's title and original. Other devices open a bundle only when its `metaRevision` is the item's, check it with `validateIndexBundle`, and keep an empty entry for one that does not open or match, so it is not downloaded again until the item changes.
- **Storage on the device.** `R`, its salt and epoch are kept in the account's sync database (version 4 adds a `vault` table). Removing the cloud library, starting again after a reset, and signing out with the account's sync data removed all delete it.
- **Export.** `exportCloudVault` takes the engine's `sealedReader()` and writes decrypted originals and titles. Without the key it stops and asks for the recovery code.

## Adding a device

Google sign-in still opens the session. Before a new device can read a sealed vault it needs `R`, by one of two routes.

**Recovery code.** Type the 27-character code (26 characters and a check character); the device derives the vault keys, checks `keyCheck`, then syncs.

**Pairing with a device you already have.** The app cannot scan a QR code: Caddy's `Permissions-Policy: camera=()` blocks the camera, and that is worth keeping. So pairing uses a short typed code and a six-digit check number.

The order matters. If one device published its public key first and the other sent its key together with the secret, a dishonest server could keep generating substitute keys until both screens showed the same six digits (about a million tries, a few seconds of work). So the new device commits first and reveals last:

1. The new device creates an ephemeral ECDH P-256 pair and calls `POST /pairing` with only a commitment, `SHA-256("ar-e2ee-1|pairing-commit|" + publicKey)`. The server returns a pairing ID and an 8-character code, valid for 10 minutes and used once, and the new device shows the code.
2. On the device that has the key, the student chooses **Add a device** and types the code. That device claims the pairing, receives the commitment, creates its own pair and publishes its public key.
3. Only then does the new device reveal its public key. The old device checks it against the commitment; a different key stops the pairing.
4. Both devices show the check number, from SHA-256 of both public keys. A server that swapped a key had to fix its substitutes before it could see the key it needed to match, so the numbers differ.
5. The student confirms the numbers match on both devices. The old device then seals `R` with AES-256-GCM under a key from ECDH and HKDF, bound to the pairing ID and both public keys. The new device opens it, checks `keyCheck`, keeps `R`, and deletes the pairing.

The server only ever sees a commitment, two public keys and an encrypted `R`. The private keys live in the page's memory, so leaving Settings ends a pairing.

**Pairing API.** All calls need a signed-in session; the writes also need encryption to be on for the vault (`INVALID_INPUT` otherwise). Each step needs the one before it and happens once (`INVALID_INPUT` otherwise). A pairing never crosses accounts: another account gets `404` for it.

| Call                                                                 | Answer                                                                                                                                                         |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /pairing` with the new device's 32-byte `commitment`           | `{ pairingId, code, expiresAt }`; the code is 8 Crockford base32 characters, valid for 10 minutes, and the server keeps only its SHA-256                       |
| `POST /pairing/claim` with the typed `code`                          | `{ pairingId, commitment }`, once; case, spaces, dashes and look-alike letters are forgiven. Each account gets 10 tries per 10 minutes, right or wrong (`429`) |
| `PUT /pairing/{pairingId}/old-key` with the old device's `publicKey` | `204`, after the claim                                                                                                                                         |
| `PUT /pairing/{pairingId}/new-key` with the new device's `publicKey` | `204`, after the old key, and only if the key matches the commitment                                                                                           |
| `PUT /pairing/{pairingId}/secret` with the 44-byte `sealedSecret`    | `204`, after the new key                                                                                                                                       |
| `GET /pairing/{pairingId}`                                           | `{ claimed, oldPublicKey?, newPublicKey?, sealedSecret? }`, each field once its step is done                                                                   |
| `DELETE /pairing/{pairingId}`                                        | `204`; the new device deletes the pairing once it has the key, and either device when it cancels                                                               |

This replaces the pairing calls first built in phase 1, which had the new device publish its key first.

## The screens (phase 3)

The Auto-sync section in Settings has an **End-to-end encryption** panel once the library is included.

- **Before including.** A box chooses encryption from the start; see "Turning it on for an existing library".
- **Off.** It says the pilot service can read cloud copies. **Turn on end-to-end encryption** shows the recovery code first (it is kept on the device, nothing is sent yet). The student types its last group to confirm they saved it, and only then is encryption turned on.
- **On, with the key.** **Show recovery code** shows it again. **Add a device** takes the pairing code from the new device, shows the check number, and sends the key after **The numbers match**.
- **On, without the key.** Auto-sync says it is waiting for the library's key. The student types the recovery code and chooses **Unlock**, or chooses **Pair with another device**, which shows a pairing code and then the check number.
- The panel says that items sent to the Telegram bot stay readable by the pilot service, and, until phase 4, that items already in the cloud library are not encrypted again.

## Bot items in a sealed vault

- The bot keeps publishing plain v1 items with plaintext originals and indexes, as it does today. Its code does not change.
- Devices already read plain items. They keep doing so. In an encrypted library they label bot items in search results and in Settings: "Sent through Telegram, readable by the pilot service".
- Devices learn which items are bot items from `GET /bot-items`, which lists the account's items the Telegram bot saved (`tg_saved`), and ask only while some plain item is not yet known to be one. The server also refuses to seal a bot item.
- The bot's search (`chat/search.ts`, `ownerSearchItems`) skips sealed items, because their index bundles are ciphertext. The bot's notice, privacy page and the T-statements must change from "searches your whole cloud library" to "searches what you sent the bot".
- Optional, later: a **Seal this item** action. A device re-uploads a bot item as a sealed item and deletes the plain copy. After that the bot can no longer find it.

## Turning it on for an existing library

1. Settings → Auto-sync → **Turn on end-to-end encryption**. The device shows the recovery code, the student types back its last group, and only then are `vaultSalt` and `keyCheck` set.
2. From then on every unlocked device, after each pull, queues a **reseal** for each plain cloud item that is not a bot item and has no other work queued. Items this device synced are sealed from its own copy; items only another device had are downloaded, checked against their hash, and sealed. Whichever device gets there first does it; a second one gets `REVISION_CONFLICT` and sees the item sealed on its next pull.
3. A reseal is an upload of the sealed original with `reseal: { expectedRevision }` next to `sealed`. Completing it replaces the plain item with the sealed one under the next revision, in one step, and only if the item is still plain, live, at that revision and not a bot item. The sealed original gets its own object key, so the plain one stays readable until the change has committed. Then the server forgets the plaintext: it rewrites the item's earlier change-feed entries to the sealed version, drops saved operation results and finished uploads that still describe it, and deletes the plain original and index objects after the commit.
4. Indexes follow. A device that sealed its own item publishes its index again, sealed. A device that sealed another device's item seals the index it had downloaded for it and publishes that. A device whose item was sealed by another device, and finds no index for its current metadata, publishes its own.
5. A rename made on one device while another sealed the item is kept: the pull sees a new revision with the same title, so the queued rename is sent against the new revision instead of becoming a conflict.
6. Two things outlive the switch, and the setup screen and the Privacy Policy say so: Azure Blob soft delete and versioning keep the deleted plain objects recoverable for up to 28 days (14 days as a previous version, then 14 days soft-deleted), and the daily database backups (14 kept) hold the old metadata until they age out. Purging Blob versions early is not possible while soft delete is on, so the student is told instead.

A library can also start out encrypted. The include step in Settings has a box, **Encrypt end to end before anything is uploaded**. With it ticked, **Include this device's library** shows the recovery code first, and **Include and encrypt** turns encryption on with the session's epoch and only then includes the library, so its first upload is already sealed and nothing of it is ever uploaded readable. If encryption cannot be turned on (another device already did), the library is not included. A device whose cloud library is already encrypted is told so before it includes anything (`pilot/tests/e2ee-first-upload.test.ts`, and in a browser `pilot/e2e/encryption.spec.ts`).

## Spec statements and tests

The statements are E1 to E8 in [SPEC.md](SPEC.md#end-to-end-encryption-opt-in), each with its tests: no plaintext on the server (E1), another device needs the key (E2), tampered ciphertext is refused (E3), turning encryption on seals what is already there (E4), pairing (E5), bot items (E6), export (E7) and the key never leaving a device in the clear (E8). Existing statements and their tests apply unchanged to plain libraries.

Unit tests cover the envelope library on its own: known-answer vectors, nonce construction, AAD binding and every tamper case. `test-breaker` can break one of E1 to E8 at a time to check the tests notice.

## Plan

| Phase | Work                                                                                                                    | Rough size    |
| ----- | ----------------------------------------------------------------------------------------------------------------------- | ------------- |
| 0     | `pilot/contract`: sealed item types, `ar-e2ee-1` envelope module (seal, open, chunking, AAD), unit tests                | 1 day         |
| 1     | Server: accept and store sealed items, `PUT /vault/e2ee`, ciphertext-only checks for sealed items, pairing endpoints    | 1 to 1.5 days |
| 2     | Client: key storage, seal on upload, open on download and Keep offline, sealed index bundles in `cloudSegments`, rename | 1.5 to 2 days |
| 3     | Setup, recovery code and pairing screens in Settings                                                                    | 1 day         |
| 4     | Migration (`reseal`), bot labelling, bot search limited to plain items, Blob version purge                              | 1 day         |
| 5     | E1–E8 tests on PostgreSQL and Azurite, privacy page, Telegram privacy page, protocol and SPEC updates                   | 1 day         |

About 6 to 8 days for one person, done as one pull request per phase, each with two approvals. Each phase must keep plain vaults passing the full existing pilot suite.

## Open questions

- **Hide sizes?** Pad each original to a 64 KiB boundary and each bundle to 16 KiB. This costs up to about 5% more storage on small files and makes sizes less telling.
- **Hide timestamps?** `createdAt` is already sealed. Upload and change times stay visible to the server; hiding them would need batching, which isn't worth it here.
- **Should Export include bot items?** Yes, as today. They are plain anyway.
- **Recovery code with no paired device.** A student who loses every device and the code loses the cloud library. There is no reset by email or Google, by design, and the setup screen must say this in plain words.
- **WhatsApp.** The same rules as Telegram apply if it is ever turned on: its vaults (`wa:`) are separate and stay plain.

## What to say if asked

"Auto-sync can be end-to-end encrypted because our server never searches app content; it only stores bytes. Each library gets a key that never leaves the student's devices, and a recovery code. Files, indexes and titles are sealed with AES-256-GCM before upload. A second device gets the key through a recovery code or a pairing code with a check number. The bot is the one exception: it has to read what you send it, so those items stay readable by the server and are labelled that way."
