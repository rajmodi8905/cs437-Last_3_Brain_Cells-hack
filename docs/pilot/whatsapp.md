# WhatsApp channel

Status: third slice, November 2026. Students message the bot's WhatsApp number (Meta WhatsApp Cloud API). After they agree to a short notice, the pilot server stores each supported file or note as an ordinary cloud item in a vault for that sender, so it appears in that vault's change feed like any upload, and indexes it with the app's own engine so the app's cloud search finds it. Typed text is a search answered in the chat, a picked result sends the original back, and a one-time link opens the vault in the app. The statements are W1 to W9 in [SPEC.md](SPEC.md); the design and its sources are in `research/2026-11-10-technical-whatsapp-bot.md`.

The code is in `pilot/server/whatsapp/`. Nothing is enabled until the next slice (#58) wires settings into `config.ts` and `main.ts`.

## Webhook

`createPilotHandler` mounts `/api/v1/whatsapp/webhook` only when it is given the `whatsapp` option (`verifyToken`, `appSecret`, a `BotStore`, optionally `phoneNumberId` and `onRecorded`). Without it the path answers `NOT_FOUND` like any unknown endpoint.

- `GET` is Meta's subscription check: with `hub.mode=subscribe` and a `hub.verify_token` equal to the configured token (compared in constant time), the server answers 200 with `hub.challenge` as plain text; anything else gets 403.
- `POST` reads the raw body (at most 3 MB, Meta's maximum; larger gets 413) and checks `X-Hub-Signature-256: sha256=<hex>`, the HMAC-SHA256 of those exact bytes with the app secret, in constant time, before parsing anything. No header gets 401, a wrong one 403; nothing is stored either way.
- A valid delivery is parsed and every `entry[].changes[].value.messages[]` is recorded with its ingest job. Status updates (`statuses[]`) and messages to another business number are ignored. The answer is 200 once the messages are recorded, so a crash after that loses nothing, and the work happens in the worker.
- The webhook does not use sessions, CSRF or the per-address rate limit: Meta calls from a few shared addresses and authenticates with the signature. The worker limits each sender instead (a burst of 30, then 30 a minute); messages over the limit wait, they are not dropped.

## Identity

A sender is identified by the business-scoped user ID (BSUID): `messages[].from_user_id`, or the matching contact's `user_id`. Meta has sent BSUIDs since April 2026 and says to identify users by them, because a user with a username may arrive without a phone number. The vault owner key is `wa:<BSUID>`. The phone number (`from` / `wa_id`) is kept only for display and for replies when there is no BSUID.

Older payloads with only a phone number get the ID `phone-<first 32 hex digits of SHA-256 of the number>` and owner key `wa:phone-…`, so the number never appears in storage keys. Such a vault is not merged with a later BSUID vault for the same number, because numbers can change hands. The hash only keeps the number out of keys and paths; it is not a secret, since phone numbers can be enumerated.

## Tables

Migration 3 in `pilot/server/postgres.ts` adds three tables to the pilot schema, and migration 4 adds the conversation state and app links; backups and restores include them.

| Table        | Key                         | Holds                                                                                      |
| ------------ | --------------------------- | ------------------------------------------------------------------------------------------ |
| `wa_senders` | `user_id` (BSUID)           | owner key, last known `wa_id` (nullable), first and last seen                              |
| `wa_inbound` | `wamid` (Meta's message ID) | sender, owner key, time received, the message JSON, whether it has been answered           |
| `wa_jobs`    | `<kind>:<wamid>`            | kind (`ingest`, `index`), state, attempts, `run_after`, lease (`locked_until`), last error |
| `wa_links`   | `token_hash` (SHA-256)      | owner key, masked label, created and expiry times (migration 4)                            |

Migration 4 also adds to `wa_senders` the times the notice was sent (`notice_sent_at`) and consent given (`consented_at`), the agreed `notice_version`, `stopped_at` while the sender has sent STOP, and `delete_requested_at` for a pending DELETE ALL, plus indexes on `wa_inbound.owner_key`, `wa_links.owner_key` and `sessions.owner_key`.

`BotStore` (`whatsapp/store.ts`) is the interface; `MemoryBotStore` backs tests and local development and `PostgresBotStore` (`whatsapp/postgres.ts`) the hosted pilot. The PostgreSQL store shares the `PostgresPilotStore` connection pool, so its writes join an open owner-lock transaction. The same conformance tests run on both (`pilot/tests/whatsapp-store.test.ts`).

## Job flow

1. The webhook inserts the message into `wa_inbound` with `ON CONFLICT DO NOTHING`; only a new row adds an `ingest` job, in the same transaction. A repeated or concurrent delivery of the same `wamid` changes nothing.
2. The worker claims the next due job with `SELECT … FOR UPDATE SKIP LOCKED`, counting an attempt and taking a five-minute lease. Several workers or processes never take the same job; a job whose worker stopped is taken again when its lease runs out.
3. Media is downloaded at once (WhatsApp's URLs last five minutes): from the webhook's `url` when present, otherwise from a URL looked up by media ID. A 404 means the URL expired, so a fresh one is looked up once. The download stops as soon as it passes the kind's limit.
4. The bytes' SHA-256 must equal WhatsApp's `sha256`. Webhooks send it as base64 (Meta's example: `SfInY0gGKTsJlUWbwxC1k+FAD0FZHvzwfpvO0zX0GUI=`); media lookups are read as hex. Both forms are accepted; anything else, or a mismatch, fails the attempt.
5. Under the owner's lock, as in upload completion, the account quota is checked against stored bytes, the original is written to `${ownerKey}/${epoch}/${globalId}/original`, the item is published at revision 1, an `index` job is queued and the ingest job is marked done. `globalId` is a UUID v4 made from the SHA-256 of the `wamid`, so a retry finds the item it already published and never makes a second one. A deleted item is not recreated.
6. Failed attempts are retried after 30 seconds, doubling up to an hour; after the sixth the job is `failed` and the student is told once. Refusals (unsupported, too large, quota) are not retried.

Each message gets at most one reply: the reply is marked in `wa_inbound` before it is sent. A crash or a failed send right after can lose a confirmation, but no retry or second worker can send it twice.

## What is saved

| Message                                                                 | Saved as                                        | Limit              |
| ----------------------------------------------------------------------- | ----------------------------------------------- | ------------------ |
| `image` with `image/jpeg`, `image/png` or `image/webp`                  | `image`                                         | 20 MB              |
| `document` with `application/pdf`                                       | `pdf` (page count is checked by the app later)  | 20 MB              |
| `document` with one of the image types above                            | `image`                                         | 20 MB              |
| text that was forwarded (`context.forwarded` or `frequently_forwarded`) | `note`, `text/plain;charset=utf-8`              | 20,000 code points |
| text starting with `note ` or `save ` (any case; the prefix is removed) | `note`                                          | 20,000 code points |
| text that is only one `http` or `https` link                            | `note` whose text is the link, with `sourceUrl` | 20,000 code points |

The limits are the app's `LIMITS`, and items pass the same `validateCloudItem` check as uploads. The title is the caption, else the document's file name, else the first words of the note (cut at a word within 60 code points), else `WhatsApp photo <date>` or `WhatsApp PDF <date>`; titles are at most 120 code points. `createdAt` is the message timestamp in milliseconds.

Nothing else is saved, and the bot says why in one short line: voice notes and other audio, video, stickers, other documents (Word, PowerPoint, Excel), locations, contacts, and files WhatsApp could not deliver (error 131052, over its 100 MB limit). Reactions and system notices get no answer. A saved item is confirmed with "Saved to Campus Recall: <title>"; with the conversation (below), a burst is confirmed in one message. Without the conversation, typed text that is not saved gets "Forward things here to save them, or start a message with 'note ' to save it as a note."; with it, typed text is a search.

## Conversation

`createWhatsAppConversation(options)` (`whatsapp/conversation.ts`) returns the worker hooks `gate`, `onText` and `onSaved` (as `hooks`), plus `flush()` and `search()`. `startWhatsAppBot(options)` runs the worker with them; its `stop()` also sends waiting confirmations. The options are the stores, the Graph client, an optional `engine` (`EngineHost`), and `origin`, `privacyUrl`, `contactEmail` and `noticeVersion`; settings for them come with #58. Without the hooks the worker behaves as before, so W2 to W5 and W7 hold either way.

`gate` sees every message before the worker handles it and decides, in this order:

1. **Stopped** (`STOP` was sent): only `START` is answered; anything else is not saved, its content is forgotten and nothing is sent back.
2. **No consent yet** (W1): nothing is saved and the message's stored JSON is reduced to its ID and type (`forgetMessage`), which is all that dedupe needs. The first message from a sender gets the notice (claimed once with `claimNotice`, so two workers never send it twice); later messages before `AGREE` get no answer. Once the notice was sent, `AGREE` records the consent time and `noticeVersion` and answers "You're all set. Anything you sent before this wasn't saved, so please send it again."; `HELP`, `PRIVACY` and `STOP` are answered, and `DELETE ALL` gets "Nothing is saved for you yet." An `AGREE` before the notice only gets the notice.
3. **A list reply** (`interactive.list_reply`): the picked result is sent back (below).
4. **A command**. Anything else goes on to the worker: saved as before, or a search through `onText`.

The notice covers what is saved, that WhatsApp (Meta) decrypts messages to deliver them and may keep them up to 30 days, that our server stores and processes files and searches, the 18+ age limit, `DELETE ALL` and the privacy link, and it ends "Reply AGREE to start."

### Commands

A command is the whole typed message, ignoring case, extra spaces and a final full stop. Forwarded text is never a command: a forwarded "HELP" is saved as a note.

| Command          | Answer                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------- |
| `HELP`           | What the bot does, the commands and the contact email                                                               |
| `PRIVACY`        | The privacy URL                                                                                                     |
| `STOP`           | Stops saving and replying except to `START`; says saved data is kept until `DELETE ALL` (sent after `START`)        |
| `START`          | Resumes after `STOP` ("I'm already on." otherwise)                                                                  |
| `OPEN`           | "Open your WhatsApp library in Campus Recall: <link>", and that the link works once, for 10 minutes                 |
| `DELETE ALL`     | Asks for `CONFIRM DELETE` within 10 minutes                                                                         |
| `CONFIRM DELETE` | Erases everything (W9) when `DELETE ALL` came within 10 minutes; otherwise says the request expired or was not made |
| `AGREE`          | Consent (above); afterwards "You're already set up."                                                                |

### DELETE ALL (W9)

On a confirmed request, under the owner's lock:

1. `resetOwnerVault` (`pilot/server/vault-reset.ts`, the same code as `DELETE /vault`): items, change feed, saved results and unfinished uploads are forgotten; originals, index bundles and staged chunks are deleted; the epoch moves.
2. `deleteOwnerSessions` ends every session of the vault.
3. `forgetSender` reduces every message of the vault to its ID and type, marks its open jobs done, deletes its app links, and clears the sender's phone number, consent, STOP and request.

The sender and message IDs stay, so a repeated webhook delivery is still recognised and an erased item is never recreated. The next message gets the consent notice again. Other senders are not touched. Devices signed in to the vault see the reset like any other (`VAULT_RESET` / `RESYNC_REQUIRED`).

### Batched confirmations

With `onSaved`, each saved message's reply is claimed (`claimReply`) and its title waits in memory for that sender. The confirmation goes out when no other save arrives for `batchMs` (3 seconds), or at once when `batchMax` (10) titles are waiting. One title keeps "Saved to Campus Recall: <title>"; several give "Saved 3 items to Campus Recall: <title>, <title>, <title>", each title cut to 40 code points. Because the reply is claimed before it waits, a crash can lose a confirmation but never sends one twice. Refusals are still answered at once.

### Search (W8)

Every typed message that is not saved or a command is a search of the sender's own items:

1. With an engine host, `ownerSearchItems` lists the vault's usable bundles and `engine.search` ranks them exactly as the app does (at most five hits).
2. Live items without a usable bundle (still being indexed) are matched by keyword on their title (words of three or more letters, or numbers, matching the start of a title word) and marked "still indexing".
3. Without an engine host, or when its search fails, every item is matched that way and the reply says "Matched by keyword only right now."

The reply is an interactive list, within Meta's limits (`research/2026-11-10-technical-whatsapp-bot/cloud-api-mechanics.md`):

| Part        | Content                                                                                                | Limit          |
| ----------- | ------------------------------------------------------------------------------------------------------ | -------------- |
| body        | Best matches for “<query>”. Pick one to get it back.                                                   | 4,096          |
| footer      | Keyword search only: "Matched by keyword only right now."                                              | 60             |
| button      | See results                                                                                            | 20             |
| rows        | Best first                                                                                             | 5 (Meta: 10)   |
| row ID      | The global ID and the hit's location: `<globalId>`, a bar, then `w`, `p<page>` or `t<startMs>-<endMs>` | 200            |
| row title   | The item's title                                                                                       | 24 code points |
| row details | `p. 2 · <excerpt>`, or the kind and `still indexing` or `title match`                                  | 72 code points |

Longer texts are cut and end in "…". With no result the answer is "Nothing matched “<query>” (only things you sent here are searched).", adding that only titles were matched when search by meaning is off.

A `list_reply` names a row. The item is read from the sender's own vault only; another vault's ID, a deleted item or a malformed ID get "That item isn't in your library any more." Then:

- A JPEG or PNG photo up to 5 MB is uploaded with `POST /{phone-number-id}/media` and sent as an image with its title as the caption.
- Other photos (WebP, larger ones) and PDFs are sent as a document, with the title (and page, for example "Guest rules.pdf (p. 2)") as the caption and the title as the file name.
- A note is sent as its text, cut at 4,096 code points with a pointer to the app.

A CTA URL message follows: "Open it in Campus Recall. The link works once, for 10 minutes.", with the button "Open in app" and a fresh link. The pick is answered once, like any message.

## Opening the app (W6)

`OPEN` and the CTA above create a link with `createOpenLink` (`whatsapp/links.ts`): 32 random bytes in base64url, stored in `wa_links` only as their SHA-256, valid for 10 minutes, for the sender's vault, and labelled with the masked number ("WhatsApp ••••1234", or "your WhatsApp account" when no number is known). The URL is `<origin>/api/v1/whatsapp/open/<token>`; the token is in the path because the app strips `token` from query strings. The endpoints are in [protocol.md](protocol.md):

- `GET` shows a small server-rendered page with the masked identity and a Continue button: no scripts or external resources, a strict CSP with a hash for its one style block, and a `same-origin` referrer policy. It uses nothing up, so link previews cannot spend the link. The referrer policy is not `no-referrer` because browsers then send `Origin: null` on the form's POST.
- Continue posts to the same path. The server checks `Origin`, takes the link in one step (`takeLink`), replaces any session the browser had, opens a normal session for `wa:<BSUID>` with the label as `email`, and redirects to `/?signin=whatsapp#/settings`. Cookie, CSRF and expiry rules are those of every session.
- An expired, used or unknown token gets a plain error page that says to send OPEN again, and opens nothing.

In the app, `signin=whatsapp` is removed from the address and counts as an explicit Auto-sync activation, as returning from Google does; Settings shows "Signed in as WhatsApp ••••1234". The session body has `kind: "whatsapp"`. For such a session the app runs a read-only pass (`SyncEngine.browse`: the change feed and the usable index bundles, only `GET` requests), so the vault's items are listed under "In your cloud library" and found by the app's search before, and without, "Include this device's library". Including the device library is still the explicit choice of P02; after it, sync works as for any account.

## Graph API client

`whatsapp/graph.ts` defines `GraphClient` and a `fetch`-based implementation: `getMediaUrl(mediaId)`, `download(url, maxBytes)` with the bearer token, `sendText(to, text)`, `uploadMedia(bytes, mimeType, filename)` returning a media ID, `sendMedia(to, { type: 'image' | 'document', mediaId, caption?, filename? })`, and `sendInteractive(to, interactive)` for list and CTA URL messages. The base URL and API version are options; the default version is `v27.0`. Replies go to the BSUID (`recipient`, which Meta accepts since July 2026) when there is one, else to the phone number (`to`). Tests run the real client against a local stand-in for the Graph API (`pilot/tests/whatsapp-helpers.ts`).

## Server indexing (engine host)

Every stored item has an `index:<wamid>` job. `createWhatsAppIndexer({ store, objects, engine, quotaBytes })` (`whatsapp/indexer.ts`) returns the worker's `onIndexJob`; without it the jobs stay pending. The indexer produces the same bundle a device would: the app's own built engine runs in headless Chromium, so extraction, OCR, chunking, the pinned default EmbeddingGemma model and `INDEX_VERSION` are the app's, not a Node port of `src/engine/extract.ts` (which needs DOM canvas, `createImageBitmap` and workers).

### The page

`pilot/engine-host/index.html` and `main.ts` are built on their own with `npm run build:engine-host` (`ENGINE_HOST_BUILD=1`), into `.cache/engine-host-dist/`, from the same engine source as the app. The published app build in `dist/` is unchanged: it does not contain the page, so the release check still passes and the pilot site never serves it, and the service worker precache is as before.

The page (`pilot/engine-host/host.ts`) opens its own library database, `campus-recall-engine-host`, never the app's `campus-recall`, removes anything an interrupted run left there, sets the default model (`saveSearchModel(GEMMA)`; a student's own S16 model is never used, because custom-model indexes never sync) and runs the app's `setupModels`, which fetches every pinned file once, checks its SHA-256 and keeps it in the asset cache the model worker reads. It then exposes `window.engineHost`:

- `ready()` resolves with `{ indexVersion }` once models are set up.
- `index({ bytesBase64, kind, mimeType, title, createdAt, sourceUrl? })` saves the original with `DexieLibraryRepository.save` exactly as the Add screen does (a file, or a note's text), runs `engine.indexItem`, waits for `ready` or `failed`, reads the segments the way Auto-sync reads a device's before publishing them, deletes the temporary item and returns `{ ok: true, indexVersion, contentSha256, segments, ms }` with segments in `IndexBundle.segments` form, or `{ ok: false, error: { code, message } }` when the engine or the library refused the original. A note keeps no `sourceUrl`, as in the app; the index does not depend on it.
- `search(query, items, kind?)` maps each `{ globalId, kind, indexVersion, segments }` exactly as `SyncEngine.cloudSegments` maps synced bundles (`cloud:<globalId>:<n>`, item `cloud:<globalId>`), sets them as `engine.extraSegments`, runs the app's `engine.search` (query embedding, frozen thresholds, ranking, five-result cap) and returns `{ globalId, itemId, segmentId, location, matchKind, excerpt?, score }[]`. Segments of another index version are skipped by the engine, as in the app.

### The Node side

`whatsapp/engine-host.ts` defines `EngineHost` (`index(input)`, `search(query, items, kind?)`, `close()`), `PlaywrightEngineHost` and `FakeEngineHost` for tests. `PlaywrightEngineHost({ distDir, modelsDir, profileDir?, jobTimeoutMs?, setupTimeoutMs?, maxJobsPerBrowser?, headless? })`:

- Loads Playwright with a dynamic `import('@playwright/test')` on first use, so the API server needs neither Playwright nor Chromium while indexing is off.
- Serves the page itself from a small HTTP server on `127.0.0.1` and a random port: `distDir` as built, plus `/__models/<sha256>` for the pinned files in `modelsDir` (only names listed in the built `asset-manifest.json`). This needs nothing from the pilot origin, sessions or the service worker. The app's service worker normally answers `runtime/ocr/eng.traineddata.gz` from the asset cache; the page has no service worker, so the local server answers it with the same pinned file.
- Launches Chromium with a persistent profile (a temporary directory by default, removed on close; pass `profileDir` to keep the asset cache across process restarts) and blocks service workers.
- Keeps nothing on the network: every request is routed. The page's own origin goes through; a pinned asset's public URL (Hugging Face, jsDelivr) is redirected to the local copy during setup only, as the real-model tests do; everything else is refused and recorded in `blockedRequests`. Chromium also gets `--host-resolver-rules` that resolve no host but `127.0.0.1`.
- Keeps one warm page and runs one job (index or search) at a time; `start()` warms it up before the first job.
- Gives each job `jobTimeoutMs` (3 minutes). A timeout, a page crash or any other failure closes the browser, and the next job starts a fresh one; these errors are `EngineHostUnavailableError`, which the worker retries. The browser is also replaced after `maxJobsPerBrowser` jobs (50) to give back memory. Setup has its own limit, `setupTimeoutMs` (10 minutes).
- An original the engine refuses comes back as `EngineIndexError` (code and the app's own message); the page stays up.

### Publishing

`PUT /items/{id}/index` and the indexer share `publishIndexBundle` (`pilot/server/index-publish.ts`): the item must exist and not be deleted, the bundle must pass `validateIndexBundle` against the current original, title digest and supported versions, the account quota counts the new bundle minus any earlier one, the bundle goes to `${ownerKey}/${epoch}/${globalId}/index`, and the item is published with its index descriptor at the same revision. The route only maps refusals to its error responses.

For each job the indexer:

1. Reads the current item. A deleted item, or one gone with a vault reset, is skipped. An item that already has a bundle for its current original, title and a supported version is done (a retry after a crash).
2. Reads the original from the object store and calls `engine.index` with the item's kind, MIME type, title and capture time. The engine's `contentSha256` must equal the item's.
3. Builds the bundle (`globalId`, `contentSha256`, `searchMetadataDigest` of the title it indexed with, the engine's `indexVersion`, dimension 768, segments) and, under the owner's lock, reads the item again. Deleted meanwhile: nothing is published. Renamed meanwhile: search embeds the title, so it indexes again with the new title (up to three passes, then the job is retried). Otherwise it publishes through `publishIndexBundle`.

Failures follow the job queue: an engine host failure or timeout is retried after 30 seconds, doubling up to an hour; after the sixth attempt the job is `failed`. An original the engine refuses, or a bundle that cannot fit the quota, fails at once (`PermanentJobError`). When an index job fails for good the student is told once: "Couldn't make "<title>" searchable, but it is still saved in Campus Recall.", or for the quota "Your Campus Recall library is full, so "<title>" was saved but can't be searched yet." The message's "Saved" reply was already sent, so "once" comes from the job: only the claim that moved it to `failed` answers. Nothing re-queues a quota failure when space is freed yet.

### Measurements

`pilot/model-e2e/engine-host.spec.ts` (run with `npm run test:pilot:models`) measured on an Apple Silicon Mac (darwin arm64), Chromium from Playwright 1.64.1, WASM backend, one thread, over three runs:

| Step                                                               | Time      |
| ------------------------------------------------------------------ | --------- |
| Start Chromium and set up models (445 MB, hash-checked, from disk) | 1.6–1.9 s |
| Index `sample-03.pdf` (3 pages, 3 segments)                        | 2.0–2.5 s |
| Index `sample-01.jpg` (OCR and picture, 2 segments)                | 5.6 s     |
| Search two bundles (warm page)                                     | 0.3 s     |
| Search right after a browser restart (includes setup)              | 1.8 s     |

Peak resident memory, summed over Chromium's processes (which counts shared pages more than once, so it overstates): about 0.9 GB after setup, 1.7–2.1 GB while indexing, and 1.9–2.2 GB at the highest over three runs, once both the text and picture models were loaded. The Node test process stayed at about 0.25 GB, so Chromium plus Node peaked at 2.1–2.4 GB. The vectors equal the app's own for the same files exactly (the same count and locations, largest difference 0, cosine 1.0), and indexing the PDF again on a restarted browser gave identical numbers. Production numbers on the 2-vCPU Linux VM still need measuring.

## Seams

- `startWhatsAppWorker(options)` runs the worker in the server process and returns `{ runOnce, drain, reply, wake, stop }`; pass `wake` as the webhook's `onRecorded` so new messages start at once. `createWhatsAppIngest(options)` gives the same functions without the loop.
- Indexing: pass `onIndexJob: createWhatsAppIndexer({ store, objects, engine, quotaBytes })` with a started `PlaywrightEngineHost({ distDir: '.cache/engine-host-dist', modelsDir: '.models' })`; close the host on shutdown. The deploy image needs Playwright's Chromium, the `.models` files and the engine host build (`npm run build:engine-host`).
- Search: `engineHost.search(query, ownerItems, kind?)` returns `EngineSearchHit[]` (`{ globalId, itemId, segmentId, location, matchKind, excerpt?, score }`, best first, at most five), where `ownerItems = await ownerSearchItems(store, objects, ownerKey)` (`whatsapp/indexer.ts`) lists one `{ globalId, kind, indexVersion, segments }` per live item whose stored bundle still matches its original, title and a supported index version, as the app checks before it uses a synced bundle.
- Worker hooks: `gate({ sender, wamid, message, plan })` sees every message first and returns true when it dealt with it; `onText(sender, text, message)` gets typed text that is not saved; `onSaved(sender, title)` replaces the "Saved" reply after the reply was claimed. The conversation sets all three.
- Running the bot: `startWhatsAppBot({ ...workerOptions, engine?, origin, privacyUrl, contactEmail, noticeVersion })`, with `wake` as the webhook's `onRecorded`; the open-link routes are mounted whenever `createPilotHandler` has the `whatsapp` option.
- Replies: `reply(sender, text)` sends one plain text message.

Tests: `pilot/tests/whatsapp-conversation.test.ts` (W1, commands, W9, batching, W8 with `FakeEngineHost`, W6 links; memory stores, and PostgreSQL and Azurite with `npm run test:pilot:storage`), `pilot/tests/whatsapp-entry.test.ts` (the app's `signin=whatsapp` handling), `pilot/e2e/whatsapp-link.spec.ts` (opening the app from a link in Chromium) and `pilot/model-e2e/whatsapp-search.spec.ts` (W8 with the real models: the bot's and the app's top result agree). The two Playwright specs run their own in-process pilot server with the channel, because the shared test servers do not run it until #58.

## Not done yet

- Settings in `config.ts` and `main.ts` (including starting the engine host and the bot), the engine host in the deploy image, and the privacy policy text (#58).
- Clean-up of old `wa_inbound` rows, finished jobs and expired `wa_links` rows (expired links cannot be used, but stay until then).
- A new notice version does not ask senders who agreed to an older one to agree again; the version is only stored.
- Waiting confirmations live in the worker's memory: a crash or restart can lose one (never send it twice).
- With several workers, a save from the same sender that is already running when `CONFIRM DELETE` is handled can still store that one item in the new, empty vault. One worker handles jobs one at a time, so this cannot happen there.
- Without an engine host, keyword search matches titles only, not note text.
