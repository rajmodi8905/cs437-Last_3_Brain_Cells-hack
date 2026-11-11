# Telegram channel

Status: November 2026, for the 24 November demo. Students open the team's Telegram bot and tap Start. After they agree to a short notice, the pilot server stores each supported file or note as an ordinary cloud item in a vault for that Telegram user, indexes it with the app's own engine, answers typed searches in the chat with result buttons that send the original back, and opens the vault in the app from a one-time link. It does what the WhatsApp channel ([whatsapp.md](whatsapp.md)) does, on the same core; the statements are T1 to T9 in [SPEC.md](SPEC.md).

The channel is on only when its settings are given (below). Without them the server behaves as before and the Telegram paths answer `NOT_FOUND`. WhatsApp and Telegram can run alone or together; the engine host is started once for both. BotFather setup and a local trial are in [telegram-setup.md](telegram-setup.md), deployment in [deployment.md](deployment.md) and the privacy page the bot links to in [telegram-privacy.md](telegram-privacy.md).

## Code

| Path                               | What it holds                                                                                                                      |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `pilot/server/chat/`               | The channel-neutral core shared with WhatsApp (below)                                                                              |
| `pilot/server/telegram/api.ts`     | The Bot API client: updates, files, messages with inline buttons, per-chat spacing; no URL or token ever leaves it in an error     |
| `pilot/server/telegram/intake.ts`  | Turns an update into a recorded message or button tap, once; private chats only; the allowed-users gate                            |
| `pilot/server/telegram/poller.ts`  | Long polling with the offset stored in the bot's state                                                                             |
| `pilot/server/telegram/webhook.ts` | `POST /api/v1/telegram/webhook`, checked against the secret token                                                                  |
| `pilot/server/telegram/plan.ts`    | What one message is: a save (and how), a refusal, a command or a search                                                            |
| `pilot/server/telegram/bot.ts`     | The conversation (consent, commands, buttons), downloads, the worker, and Telegram's renderer for the shared parts                 |
| `pilot/server/telegram/store.ts`   | Telegram identities and message keys, the polling offset and result buttons (`TelegramStateStore`, memory); `postgres.ts` the same on PostgreSQL |
| `pilot/server/telegram/links.ts`   | One-time app links on Telegram's own path and link table                                                                           |

### The shared core

The parts that do not depend on the chat app moved out of `pilot/server/whatsapp/` into `pilot/server/chat/`, and the WhatsApp channel uses them with unchanged behaviour (its tests are unchanged and pass):

- `jobs.ts`: the job runner (claim, run, retry with a doubling delay, fail for good after six attempts, `PermanentJobError`) and the worker loop with `wake`.
- `items.ts`: which typed text is a note (forwarded, `note `/`save `, a single link), titles, the item's global ID from a message key (a UUID v4 from SHA-256, namespaced per channel), and `storeChatItem`, which stores under the owner's lock exactly as upload completion does and refuses when the job is no longer the current claim or consent was withdrawn meanwhile.
- `search.ts`: search over one owner's items, by meaning with the engine host and by title for items still being indexed (W8/T8).
- `send-back.ts`: a picked result sent back (a file, a note's text, or "open it in the app"), then an "Open in app" link.
- `batch.ts`: one "Saved N items" confirmation per burst.
- `erase.ts`: DELETE ALL and `/delete`: the vault reset, the vault's sessions, the bot's records of that person, plus anything the channel adds.
- `channel.ts`: `ChatChannel<To>`, the renderer each channel implements: `sendText`, `sendResults`, `sendFile` and `sendOpenButton`, with its text and caption limits. WhatsApp's (`createWhatsAppChannel` in `whatsapp/conversation.ts`) sends an interactive list, image or document media and a CTA URL message, as before. Telegram's (`createTelegramChannel` in `telegram/bot.ts`) sends a numbered message with one button per result, `sendPhoto` or `sendDocument`, and a URL button.

What stays per channel is what really differs: identities, the transport (Meta's signed webhook; Telegram's long polling or secret-token webhook), downloads and their integrity check, and the conversation's commands and wording (typed words on WhatsApp; slash commands and buttons on Telegram). Button taps are acknowledged with `answerCallbackQuery` in Telegram's gate; WhatsApp list replies need no acknowledgement, so this is not part of the renderer.

## Settings

`loadConfig` (`pilot/server/config.ts`) reads them; tests are in `pilot/tests/telegram-config.test.ts`.

| Setting                              | Meaning                                                                                                    |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `PILOT_TELEGRAM_BOT_TOKEN_FILE`      | File with the bot token from BotFather                                                                     |
| `PILOT_TELEGRAM_PRIVACY_URL`         | HTTPS page that `/privacy` and the notice link to ([telegram-privacy.md](telegram-privacy.md))             |
| `PILOT_TELEGRAM_CONTACT_EMAIL`       | Address that `/help` gives                                                                                 |
| `PILOT_TELEGRAM_MODE`                | Optional: `polling` (default) or `webhook`                                                                 |
| `PILOT_TELEGRAM_WEBHOOK_SECRET_FILE` | File with the webhook's secret token (16 to 256 letters, digits, `_` or `-`); required in webhook mode only |
| `PILOT_TELEGRAM_ALLOWED_USERS`       | Optional: numeric user IDs and @usernames, separated by commas; when set, only they can use the bot       |
| `PILOT_TELEGRAM_NOTICE_VERSION`      | Optional, `1` by default; stored with each consent                                                         |
| `PILOT_TELEGRAM_LOCAL_TRIAL`         | `1` for a trial on a laptop ([telegram-setup.md](telegram-setup.md))                                       |
| `PILOT_ENGINE_HOST_*`                | The same engine host settings as WhatsApp ([whatsapp.md](whatsapp.md)); one engine host serves both       |

The first three come together or not at all, and the optional ones are refused without them. The privacy page and contact are Telegram's own settings rather than shared with WhatsApp, because the two privacy pages differ (who decrypts messages, what is kept for display). The secrets are read from their files by the server itself, so they never enter its environment (which the engine host's Chromium inherits) or a command line; errors name the setting, never a value. The token must look like BotFather's (`<bot ID>:<secret>`).

Webhook mode needs an HTTPS `PILOT_ORIGIN`, because Telegram delivers only to HTTPS. `PILOT_TELEGRAM_LOCAL_TRIAL=1` accepts memory storage (or a local storage connection string) with a local origin or a tunnel's HTTPS origin while `PILOT_HOST` is a loopback address, and never with development sign-in. App links need an HTTPS origin: with a local one, `/open` explains that they need a tunnel, and no "Open in app" button is sent (Telegram does not accept loopback addresses in buttons, and a phone cannot open them).

Allowed users are for the demo: someone else's message or tap is not recorded at all (no sender row, no message), and they get "Campus Recall on Telegram isn't open to everyone yet, so nothing you send here is saved." once per message. Usernames can change hands; prefer numeric IDs where they are known.

`main.ts` uses `PostgresBotStore` on Telegram's tables and `PostgresTelegramStore` with durable storage, memory stores otherwise; mounts the open-link routes (and the webhook in webhook mode); starts the engine host once for both channels; starts `startTelegramBot` with `createTelegramIndexer`; then either calls `setWebhook` (webhook mode) or starts long polling. It logs the bot's @username from `getMe`. On `SIGTERM` or `SIGINT` it stops polling, stops the workers (sending waiting confirmations), closes the engine host and exits.

## Transports

**Long polling** (default; no public address needed). The poller first calls `deleteWebhook` (Telegram refuses `getUpdates` while a webhook is set), then repeats `getUpdates` with `timeout` 30 seconds, `allowed_updates: ["message", "callback_query"]` and the stored offset. Each update is recorded, then the offset (the last `update_id` plus one) is stored in `tg_state`, which also confirms the batch to Telegram. A restart continues from the stored offset; a crash after recording but before storing gets the batch again, and dedupe drops it. Failures are logged without the token and retried after 1 second, doubling to 30. Stopping aborts the waiting request.

**Webhook** (`/api/v1/telegram/webhook`, for the VM). At start the server calls `setWebhook` with the pilot URL, the secret token and the same update types. A request without `X-Telegram-Bot-Api-Secret-Token` gets 401 and a wrong one 403 (compared in constant time, through SHA-256 so lengths do not leak), before the body is read; other methods get 404; bodies are at most 1 MB. A valid update is recorded and answered 200 at once; the worker does the rest. A storage failure answers 500, so Telegram retries.

## Identity and storage

A user is their numeric Telegram user ID (`from.id`, a positive whole number below 2^53; anything else, and bots, are ignored). The vault owner key is `tg:<id>`. The @username is kept only to label app links ("Telegram @name", else "your Telegram account") and is cleared on `/delete`. Only private chats are taken; in a private chat the chat ID is the user ID, so replies go there.

Bot state uses the same `BotStore` as WhatsApp on Telegram's own tables. Migration 5 adds `tg_senders`, `tg_inbound`, `tg_jobs` and `tg_links` (`LIKE` the WhatsApp tables, so the same SQL serves both; in them `wamid` holds the Telegram message key and `wa_id` the username), plus `tg_state` (the polling offset) and `tg_picks` (result buttons). Backups and restores include all six. Separate tables were chosen over a `channel` column on the WhatsApp tables because they leave WhatsApp's queries untouched: a WhatsApp worker can never claim a Telegram job, and a Telegram link can never be taken on the WhatsApp path, without adding a filter to every query. The cost is a second set of tables and a `PostgresBotStore` that takes its table names (WhatsApp's by default). Conformance tests run on memory and PostgreSQL (`pilot/tests/telegram-store.test.ts`).

## Messages, dedupe and jobs

A message is recorded under `m:<chat ID>:<message ID>` and a button tap under `c:<callback query ID>`; each gets one `ingest` job, exactly as a WhatsApp message under its `wamid`. Telegram sends the same update again with the same message or callback query, so this deduplicates every redelivery. The update ID is used only for the polling offset: Telegram may start it again from a random number after a week without updates, so it is not a lasting key. Each message or tap gets at most one reply (`claimReply` before sending), and the item's global ID is made from the message key, so a retried job finds the item it published. Under the owner's lock the worker checks again that its job is still the current claim and that the user has consent and has not sent `/stop`, so a `/delete` confirmed by another worker while a file downloaded wins.

The job runner, retries, per-user rate limit (a burst of 30, then 30 a minute) and index jobs are WhatsApp's.

## What is saved

| Message                                                           | Saved as                                    | Limit              |
| ----------------------------------------------------------------- | ------------------------------------------- | ------------------ |
| `photo` (the largest of its sizes)                                | `image`, `image/jpeg`                       | 20 MB              |
| `document` with `application/pdf`                                | `pdf` (page count is checked by the app later) | 20 MB           |
| `document` with `image/jpeg`, `image/png` or `image/webp`         | `image`                                     | 20 MB              |
| forwarded text (`forward_origin`, or the older `forward_date`)    | `note`                                      | 20,000 code points |
| text starting with `note ` or `save ` (any case; prefix removed)  | `note`                                      | 20,000 code points |
| text that is only one `http` or `https` link                      | `note` with `sourceUrl`                     | 20,000 code points |

Telegram compresses photos sent as photos; a photo sent as a file (a document) keeps its original bytes, and `/help` says so. Titles are the caption, else the document's file name, else the first words of a note, else `Telegram photo <date>` or `Telegram PDF <date>`. `createdAt` is the message's `date`.

A file is fetched with `getFile` and then `https://api.telegram.org/file/bot<token>/<file_path>`, which Telegram serves up to 20 MB. A file whose declared `file_size` is over the app's limit (20,000,000 bytes) is refused before `getFile`, as is one Telegram refuses as too big; the download also stops as soon as it passes the limit. Telegram sends no hash, so the downloaded length must equal the declared `file_size` (a mismatch fails the attempt, which is retried) and the item's SHA-256 is computed from the bytes. Voice notes, audio, video (including video notes and GIFs), stickers, other documents (Word, PowerPoint, Excel), locations and contacts are refused with the WhatsApp channel's reasons. Group chats are ignored.

## Conversation

Commands are the bot's menu, exactly: `/start`, `/help`, `/open`, `/privacy`, `/stop`, `/resume`, `/delete` (with or without `@<bot>`; `/start <payload>`, as a `t.me/<bot>?start=<payload>` link sends it, behaves as `/start`). A forwarded message is never a command. Unknown commands get a pointer to `/help`.

1. **Stopped** (`/stop`): only `/resume` or `/start` are answered ("Welcome back", or the notice again for someone who stopped before agreeing); anything else is not saved, its content is forgotten, and a tap is only acknowledged.
2. **No consent yet** (T1): nothing is saved and the stored update is reduced to its key and type. The first message gets the notice, once, with an **Agree** button (callback data `agree`); later messages get no answer, except that `/start` (and `/resume`) send the notice again because they ask for it. Tapping Agree, or replying `AGREE`, once the notice was sent records the consent time and notice version and answers "You're all set…". `/help` and `/privacy` are answered, `/delete` gets "Nothing is saved for you yet.", `/stop` pauses, and other taps are acknowledged with "Tap Agree on the notice first."
3. **Agreed**: taps (below), commands, or the message goes on to be saved or searched.

The notice covers what is saved and the searches typed, that our server stores and processes files and sees searches, that Telegram keeps bot chats on its servers and chats with bots are not end-to-end encrypted, the 18+ age limit, `/delete` and the privacy link.

| Command    | Answer                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------- |
| `/start`   | The notice (before consent); "I'm already on" (after)                                             |
| `/help`    | What the bot does, the commands, that files keep full quality, and the contact email              |
| `/privacy` | The privacy URL                                                                                   |
| `/stop`    | Stops saving and replying except to `/resume`; saved data is kept                                 |
| `/resume`  | Resumes after `/stop`                                                                             |
| `/open`    | "Open your Telegram library in Campus Recall…" with an **Open in app** URL button (T6)            |
| `/delete`  | Asks to tap **Yes, erase everything** (callback data `delete`) within 10 minutes                  |

Every button tap is answered with `answerCallbackQuery` so the app stops showing it as loading.

**/delete (T9).** The button within 10 minutes of `/delete` erases, under the owner's lock: the vault reset (`resetOwnerVault`, as `DELETE /vault`), every session of the vault, the bot's records (`forgetSender`: message content, open jobs, app links, username, consent, `/stop` and the request) and the user's result buttons. Message keys stay, so a redelivered update is recognised and an erased item is never recreated. The button without a request says to send `/delete` first; after 10 minutes the request expires.

**Batched confirmations.** As on WhatsApp: "Saved to Campus Recall: <title>", or "Saved 3 items to Campus Recall: …" for a burst (3 seconds apart at most, 10 items at most).

## Search (T8)

Typed text that is not a command or a save is searched with the shared search. The answer is one message, "Best matches for “<query>”. Tap one to get it back." with the results numbered (title and the page and excerpt, or "still indexing" / "title match"), "Matched by keyword only right now." when search by meaning is off, and one button per result (at most five). Telegram's `callback_data` holds at most 64 bytes, so a button carries `p:` and a 12-character random token (9 random bytes in base64url); `tg_picks` keeps the token with the owner, item and place for a day, and removes expired ones as new ones are made. A tap on an expired or unknown token answers "That result has expired. Search again to get it."; another user's token finds nothing in this user's vault.

A tapped result is sent back by the shared code: a JPEG or PNG up to 10 MB with `sendPhoto`, other photos and PDFs with `sendDocument` (multipart upload, the title as file name and the title and page as caption), a note as text (cut at Telegram's 4,096 characters with a pointer to the app), and kinds the chat cannot carry with "Open it in the app instead". Then "Open it in Campus Recall. The link works once, for 10 minutes." with an **Open in app** URL button and a fresh link.

## Opening the app (T6)

`/open` and the button after a result create a link with the shared link code: 32 random bytes, kept in `tg_links` only as their SHA-256, valid for 10 minutes, labelled "Telegram @username" or "your Telegram account". The URL is `<origin>/api/v1/telegram/open/<token>`. The confirmation page and the Continue `POST` are the WhatsApp ones ([protocol.md](protocol.md)), with Telegram's wording, its own link table, and a redirect to `/?signin=telegram#/settings`. A Telegram token is never accepted on the WhatsApp path, nor the reverse.

`GET /session` returns `kind: "telegram"` for a `tg:` vault. In the app, `signin=telegram` counts as an explicit Auto-sync activation only if the server confirms a Telegram session, exactly as `signin=whatsapp` needs a WhatsApp session (`pilot/client/autosync.ts`, `confirmBotSignIn`); the parameter alone changes nothing, and neither channel's parameter accepts the other channel's session. A Telegram session runs the same read-only pass as a WhatsApp one, so the vault's items are listed and searchable before, and without, "Include this device's library".

## Rate limits and the token

Telegram allows about one message a second per chat. The client queues messages per chat and spaces them at least a second apart (button acknowledgements are not messages and are not spaced). An HTTP 429 is waited out for Telegram's `retry_after` (up to 60 seconds, twice) and then sent once.

The bot token is part of every Bot API URL. It is read from its file by the server, never put in a command line, the environment or the output, and the client never lets a URL, request options or an underlying network error out: errors carry the method, the HTTP status and Telegram's own description (with the token removed if it ever appeared), and a network failure only its error code. Tests check that no error, log line or description contains the token, whether Telegram refuses a call, the server cannot be reached or the token is wrong.

## Tests

- `pilot/tests/telegram.test.ts`: T1 to T9, commands and allowed users against a real local API server in webhook mode, a stand-in Bot API (`pilot/tests/telegram-helpers.ts`) and `FakeEngineHost`; memory stores, and PostgreSQL and Azurite with `npm run test:pilot:storage`.
- `pilot/tests/telegram-transport.test.ts`: polling offset across a restart, `deleteWebhook` first, prompt stop, `setWebhook`, spacing, HTTP 429, the download limit, the token in no error or log, forwarded detection, numeric IDs only.
- `pilot/tests/telegram-store.test.ts`, `telegram-config.test.ts`, `telegram-entry.test.ts` (the app's `signin=telegram`).
- `pilot/e2e/telegram-link.spec.ts` (`npm run test:pilot:e2e`): the app opened from a `/open` link in Chromium.
- `pilot/model-e2e/telegram-search.spec.ts` (`npm run test:pilot:models`): with the real models, the bot's top result equals the app's for the engine host fixtures (on 11 November 2026 on a Mac: the PDF at page 2 and the photo, for both).

## Not done yet

- A demo record on real phones, and measurements on the VM (as for WhatsApp, [2026-11-23-whatsapp-demo.md](2026-11-23-whatsapp-demo.md)).
- Clean-up of old `tg_inbound` rows, finished jobs and expired `tg_links` rows; expired `tg_picks` rows go only when new buttons are made.
- A user removed from `PILOT_TELEGRAM_ALLOWED_USERS` keeps what they saved until `/delete` or the pilot's end, but cannot reach the bot to send `/delete`; erase such a vault by hand if asked.
- Waiting confirmations live in the worker's memory, as on WhatsApp.
- Without an engine host, keyword search matches titles only.
