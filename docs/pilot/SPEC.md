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

## WhatsApp channel (opt-in)

These statements cover the optional WhatsApp channel ([whatsapp.md](whatsapp.md)): students message the bot's number, agree to its notice, and the pilot server stores what they send in a vault for that sender, indexes it, answers searches in the chat and opens that vault in the app from a one-time link. A student who never messages the bot sees no change, and P01 to P15 are unchanged. Tests run against a stand-in for Meta's Graph API with webhook deliveries in Meta's documented format; claims about the real Meta number need their own evidence.

### W1 — Consent before anything is stored

**Statement:** Nothing a sender sends is stored, in their vault or as message content, until they reply `AGREE` to the consent notice. The notice is sent once, and the consent time and notice version are recorded.

**Test:** A new sender's forwarded note, photo and `note ` message store no item, download no media and keep only each message's ID and type; they get the notice once (it names what is saved, Meta's decryption and 30-day retention, server processing, the 18+ age limit, `DELETE ALL` and the privacy link, and ends "Reply AGREE to start."), and a later message gets no second notice. An `AGREE` before the notice only gets the notice, a notice that could not be sent goes out with the next message, and a `START` after a `STOP` before consent asks for `AGREE`. A save still downloading when `DELETE ALL` is confirmed by another worker stores nothing and sends no confirmation. After `AGREE` the consent time and version are stored, the student is asked to send earlier things again, and a note is saved. `HELP` and `PRIVACY` work before consent, and each sender consents for themselves.

### W2 — Exact original

**Statement:** A file saved from WhatsApp is stored byte for byte: its SHA-256 equals the `sha256` WhatsApp sent with it, and downloading it through `GET /items/{globalId}/original` returns identical bytes.

**Test:** Send a photo (base64 `sha256`, direct URL) and a PDF (looked up by media ID, hex `sha256`); compare the stored item's hash and the downloaded bytes with the source. Bytes that do not match are never stored.

### W3 — No duplicates from retries

**Statement:** A webhook delivered more than once, delivered concurrently, or a job retried after a crash or a lapsed lease never creates a second item or sends a second confirmation.

**Test:** Deliver the same webhook twice and three times at once, run two workers together, crash a job after it published its item, and let a stalled worker finish after another took over its job; assert one item and one confirmation each time.

### W4 — Signed deliveries only

**Statement:** A webhook request with a missing or wrong `X-Hub-Signature-256` is rejected before its body is parsed, and nothing from it is stored or answered.

**Test:** Send deliveries with no signature, a signature made with another secret, a malformed header and a body changed after signing; assert 401 or 403, no recorded message, no job, no item and no reply.

### W5 — One vault per sender

**Statement:** Each sender's items are stored only in that sender's vault (`wa:<business-scoped user ID>`), and cannot be read with another sender's session or a Google account's session.

**Test:** Two senders each save a note; each vault holds only its own item and storage key; reading the first sender's original with the second sender's or a Google account's session returns `NOT_FOUND`, and their change feeds do not list it.

### W6 — Open the app from WhatsApp

**Statement:** `OPEN` (and the link after a search result) gives a one-time link, valid for 10 minutes and stored only as a hash, whose confirmation page opens a normal session for that sender's `wa:` vault after a same-origin `POST`. The app then lists and searches the vault's items without uploading the device's own library (P02). An expired, used or unknown link opens nothing.

**Test:** The link's 32-byte token is in the path and only its SHA-256 is stored. `GET` shows a page with a strict CSP, no scripts or external resources and the masked identity, and uses nothing up; `POST` from the pilot origin redirects to `/?signin=whatsapp#/settings` with a session cookie like other sessions, whose `/session` shows the masked label and whose writes still need CSRF. A second use, a use after 10 minutes, another or no `Origin`, and unknown or malformed tokens get the error page and no cookie (a refused origin leaves the link usable). The session cannot read another sender's original. In the app (Playwright), following the link shows "Signed in as WhatsApp ••••3210" and lists the WhatsApp item while "Include this device's library" is still offered and nothing is uploaded; a client test checks that listing the vault sends only `GET` requests.

### W7 — Server indexing with the app's engine

**Statement:** The server indexes an opted-in WhatsApp item with the app's own engine and default model and publishes a bundle with the current `INDEX_VERSION` that passes the P05 checks; the app's cloud search then finds it.

**Test:** With pinned real models, the engine host indexes `sample-03.pdf` and `sample-01.jpg`; both bundles pass `validateIndexBundle` with the app's `INDEX_VERSION`, their segments equal what the app stores for the same files, and the app's search over them returns the PDF at page 2 for its fixture question. With a stand-in engine, a stored item's bundle is published like `PUT /items/{id}/index` (same checks, quota, object key and change feed); a deleted item gets none, a renamed one is indexed with its new title, failures are retried with the job backoff, and a refused original or full quota fails the job once and tells the student once.

### W8 — Search in WhatsApp

**Statement:** Typed text that is not a command or a save is a search of only the sender's items, answered with a list of at most five results within Meta's limits; picking one sends the original back with a link to open the app. For a fixture library, the bot's top result is the same item and location the app's own search returns.

**Test:** With pinned real models, the bot indexes `sample-03.pdf` and `sample-01.jpg` sent over WhatsApp; for the queries of the W7 test its top rows are the PDF at page 2 and the photo, and the app, signed in through the bot's link, returns the same item and location first. With a stand-in engine: the list has at most five rows, titles of at most 24 code points, descriptions of at most 72 with the page and an excerpt, a 20-character button and row IDs of the global ID and location; items still being indexed match by title and say so; without an engine, or when it fails, search is by keyword and says so; no match says "only things you sent here are searched"; another sender's items are never found. A picked PDF is uploaded byte for byte and sent as a document with its title and page, a photo as an image, a note as text, each followed by an "Open in app" link that works; another vault's or a deleted item is reported as gone, and a pick is answered once.

### W9 — DELETE ALL

**Statement:** `DELETE ALL` followed by `CONFIRM DELETE` within 10 minutes erases the sender's vault through the same reset as `DELETE /vault` (objects deleted, epoch moves), revokes that vault's app links and sessions, and keeps only what dedupe needs. Nothing is erased without confirmation, and other senders are untouched.

**Test:** Without `CONFIRM DELETE`, with it before any request, or 601 seconds after the request, items stay. Confirmed within 10 minutes: no live items, the epoch moves, the original and index objects are gone, a link-opened session and another session for the vault get 401, an unused link no longer opens, the stored message keeps only its ID and type, the sender's number and consent are cleared, a repeated delivery of an erased message does not bring it back and the next message gets the consent notice again; the other sender's items, session and consent are unchanged.

## Telegram channel (opt-in)

These statements cover the optional Telegram channel ([telegram.md](telegram.md)): students open the bot in Telegram, agree to its notice, and the pilot server stores what they send in a vault for that Telegram user, indexes it, answers searches in the chat and opens that vault in the app from a one-time link. It reuses the WhatsApp channel's core, so W1 to W9 and P01 to P15 are unchanged, and a student who never opens the bot sees no change. Tests run against a stand-in for the Telegram Bot API with updates in Telegram's documented format; claims about the real bot need their own evidence.

### T1 — Consent before anything is stored

**Statement:** Nothing a Telegram user sends is stored, in their vault or as message content, until they tap Agree on the consent notice (or reply `AGREE`). The notice is sent once unasked, and the consent time and notice version are recorded.

**Test:** A new user's forwarded text, photo and `note ` message store no item, fetch no file and keep only each message's key and type; they get the notice once, with an Agree button (it names what is saved, that our server stores and processes files and sees searches, that Telegram keeps bot chats on its servers and they are not end-to-end encrypted, the 18+ age limit, `/delete` and the privacy link), and a later message gets no second notice. `/start` sends the notice again, `AGREE` before any notice only gets the notice, a notice that could not be sent goes out with the next message, and other buttons before consent are only acknowledged. A save still downloading when `/delete` is confirmed by another worker stores nothing and sends no confirmation. After Agree (button or typed) the consent time and version are stored and a note is saved; `/help` and `/privacy` work before consent, `/stop` pauses until `/resume`, and each user consents for themselves.

### T2 — Exact original

**Statement:** A file saved from Telegram is stored byte for byte: its size equals the size Telegram declared, its SHA-256 is computed by the server from the downloaded bytes, and `GET /items/{globalId}/original` returns identical bytes. Of a photo's sizes the largest is saved. Files over the app's limits are refused before they are downloaded.

**Test:** Send a photo in two sizes and a PDF document; only the largest size and the PDF are fetched, and the stored hash, size and downloaded bytes equal the source. A download one byte short is not stored and the job is retried, then stored correctly. A PDF or photo declared over 20 MB, or one Telegram refuses as too big, is refused with the app's message and nothing is downloaded. Voice notes, audio, video, stickers, Office documents and locations are refused with the same reasons as WhatsApp. Forwarded text (`forward_origin` or `forward_date`), `note ` and `save ` messages and a single link are saved as notes, a forwarded `/help` is saved rather than answered, and other typed text is a search.

### T3 — No duplicates from redelivery

**Statement:** An update delivered more than once or concurrently, worked by two workers, or a job retried after a crash never creates a second item or sends a second reply. Messages are deduplicated by chat and message ID and button taps by callback query ID.

**Test:** Deliver the same update twice and three times at once, run two workers together, crash a job after it published its item and retry it, and deliver it again later; assert one item and one confirmation. A redelivered button tap is answered once. Long polling stores the next offset after each batch, so a restarted poller asks from it; an update seen by two pollers before an offset was stored is recorded once.

### T4 — Webhook secret token

**Statement:** In webhook mode, a request to `/api/v1/telegram/webhook` whose `X-Telegram-Bot-Api-Secret-Token` is missing or does not match the configured secret (compared in constant time) is rejected before its body is read, and nothing from it is stored or answered.

**Test:** Post an update with no header, a wrong one and one with an extra character; assert 401 or 403, no recorded update, no job and no reply. `setWebhook` is called with the secret token and only `message` and `callback_query` updates; long polling calls `deleteWebhook` before polling. Group chats, other bots and malformed updates are ignored.

### T5 — One vault per Telegram user

**Statement:** Each Telegram user's items are stored only in that user's vault (`tg:<numeric user ID>`), and cannot be read with another user's session; another user's result button finds nothing.

**Test:** Two users each save a note; each vault holds only its own item and storage key; reading the first user's original with the second user's session returns `NOT_FOUND`; the first user's result button tapped by the second answers that the item is not in their library. User IDs that are not positive whole numbers, and bots, are refused.

### T6 — Open the app from Telegram

**Statement:** `/open` (and the button after a search result) gives a one-time link, valid for 10 minutes and stored only as a hash, whose confirmation page opens a normal session for that user's `tg:` vault after a same-origin `POST`, labelled "Telegram @username" (or "your Telegram account"). The app then lists the vault's items without uploading the device's own library (P02). An expired, used or unknown link opens nothing, and a Telegram link is not a WhatsApp link.

**Test:** The link's 32-byte token is in the path and only its SHA-256 is stored. `GET` shows the Telegram page with a strict CSP and no scripts and uses nothing up; `POST` from the pilot origin redirects to `/?signin=telegram#/settings` with a session whose `/session` has `kind: "telegram"` and the label. A second use, a use after 10 minutes, another or no `Origin`, a malformed token and the WhatsApp path get the error page. Without an HTTPS origin, `/open` says app links need the tunnel. In the app, `signin=telegram` activates Auto-sync only with a Telegram session (not a WhatsApp or Google one), and `signin=whatsapp` not with a Telegram session; in Chromium (Playwright), following the link shows "Signed in as Telegram @student_a" and lists the item while nothing is uploaded.

### T7 — Server indexing with the app's engine

**Statement:** The server indexes an opted-in Telegram item with the same engine host and indexer as WhatsApp items (W7) and publishes its bundle like `PUT /items/{id}/index`.

**Test:** With a stand-in engine, a saved PDF gets a published bundle for its current original under the vault's epoch, made from its title and bytes. The real-model checks of W7 cover the engine host itself.

### T8 — Search in Telegram

**Statement:** Typed text that is not a command or a save is a search of only the user's items, answered with at most five results and one button per result; each button's data is a short random token (within Telegram's 64 bytes) stored with the item, place and owner and valid for a day. Tapping one sends the original back with an "Open in app" button, and every tap is acknowledged. For a fixture library, the bot's top result is the same item and location the app's own search returns.

**Test:** With pinned real models, the bot indexes `sample-03.pdf` and `sample-01.jpg` sent as files; for the queries of the W7 test its top buttons are the PDF at page 2 and the photo, and the app, signed in through the bot's link, returns the same item and location first. With a stand-in engine: seven notes give five buttons of `p:` and 12 characters; a picked photo is sent with `sendPhoto` and a PDF with `sendDocument`, both byte for byte with the title (and page) as caption, a note as text, each followed by a working "Open in app" link; items still being indexed match by title and keyword-only search says so; no match says so; an expired or unknown button says the result expired; every tap is answered with `answerCallbackQuery`.

### T9 — /delete

**Statement:** `/delete` followed by its "Yes, erase everything" button within 10 minutes erases the user's vault through the same reset as `DELETE /vault`, revokes that vault's app links, sessions and result buttons, and keeps only what dedupe needs. Nothing is erased without the button, and other users are untouched.

**Test:** The button without `/delete`, or 601 seconds after it, erases nothing. Within 10 minutes: no live items, the epoch moves, the original and index objects are gone, a link-opened session and another session get 401, an unused link and the result buttons no longer work, the stored message keeps only its key and type, the username and consent are cleared, a redelivered update does not bring the item back and the next message gets the notice again; the other user's items, session and consent are unchanged.

### Telegram transport and safety checks

Beyond T1 to T9: replies to one chat are spaced at least a second apart (Telegram allows about one message a second per chat) and HTTP 429 is waited out for Telegram's `retry_after`; downloads stop as soon as they pass the limit; the bot token appears in no error, log line or description, whether Telegram refuses a call, the server cannot be reached or the token is wrong; with `PILOT_TELEGRAM_ALLOWED_USERS` set, anyone else gets a "not open yet" reply once and nothing of theirs is stored; settings are all or none and errors name the setting, never a value (`pilot/tests/telegram-transport.test.ts`, `telegram-config.test.ts`, `telegram-store.test.ts`).
