# WhatsApp channel: receive and store

Status: first slice, 10 November 2026. Students message the bot's WhatsApp number (Meta WhatsApp Cloud API); the pilot server stores each supported file or note as an ordinary cloud item in a vault for that sender, so it appears in that vault's change feed like any upload. Consent, commands, server indexing, search replies and signing in to the app with a WhatsApp vault come in later slices. The statements are W2 to W5 in [SPEC.md](SPEC.md); the design and its sources are in `research/2026-11-10-technical-whatsapp-bot.md`.

The code is in `pilot/server/whatsapp/`. Nothing is enabled until a later slice wires settings into `config.ts` and `main.ts`.

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

Migration 3 in `pilot/server/postgres.ts` adds three tables to the pilot schema; backups and restores include them.

| Table        | Key                         | Holds                                                                                      |
| ------------ | --------------------------- | ------------------------------------------------------------------------------------------ |
| `wa_senders` | `user_id` (BSUID)           | owner key, last known `wa_id` (nullable), first and last seen                              |
| `wa_inbound` | `wamid` (Meta's message ID) | sender, owner key, time received, the message JSON, whether it has been answered           |
| `wa_jobs`    | `<kind>:<wamid>`            | kind (`ingest`, `index`), state, attempts, `run_after`, lease (`locked_until`), last error |

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

Nothing else is saved, and the bot says why in one short line: voice notes and other audio, video, stickers, other documents (Word, PowerPoint, Excel), locations, contacts, and files WhatsApp could not deliver (error 131052, over its 100 MB limit). Reactions, system notices and button or list replies get no answer. Saved items are confirmed with "Saved to Campus Recall: <title>". Typed text that is not saved gets "Forward things here to save them, or start a message with 'note ' to save it as a note."

## Graph API client

`whatsapp/graph.ts` defines `GraphClient` (`getMediaUrl(mediaId)`, `download(url, maxBytes)` with the bearer token, `sendText(to, text)`) and a `fetch`-based implementation. The base URL and API version are options; the default version is `v27.0`. Replies go to the BSUID (`recipient`, which Meta accepts since July 2026) when there is one, else to the phone number (`to`). Tests run the real client against a local stand-in for the Graph API (`pilot/tests/whatsapp-helpers.ts`).

## Seams for later slices

- `startWhatsAppWorker(options)` runs the worker in the server process and returns `{ runOnce, drain, reply, wake, stop }`; pass `wake` as the webhook's `onRecorded` so new messages start at once. `createWhatsAppIngest(options)` gives the same functions without the loop.
- Indexing: every stored item has an `index:<wamid>` job. Without `onIndexJob(job)` the worker leaves these jobs pending; the engine-host slice supplies the handler.
- Text: typed text that is not saved goes to `onText(sender, text, message)` when it is set, and then gets no help reply; the search slice answers there.
- Replies: `reply(sender, text)` sends one plain text message; `GraphClient` leaves room for `sendInteractive`, `uploadMedia` and `sendMedia`.

## Not done yet

Consent before storing (W1), commands (`HELP`, `PRIVACY`, `STOP`, `DELETE ALL`), batched confirmations for bursts, signing in to the app with a WhatsApp vault, server indexing and search (W6 to W9), settings in `config.ts` and `main.ts`, deployment, and clean-up of old `wa_inbound` rows and finished jobs. Until consent exists the channel must not be switched on for anyone outside the team.
