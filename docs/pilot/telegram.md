# Telegram channel

Status: November 2026, for the 24 November demo. Students open the team's Telegram bot, tap Start and log in with their IITGN Google account. From then on the pilot server stores each supported file or note they send as an ordinary cloud item in that account's own cloud library (the one the app's Auto-sync uses, so the items appear in the app), indexes it with the app's own engine, answers typed searches over the whole library in the chat with result buttons that send the original back, and opens the account in the app from a one-time link. Nothing is stored or searched before login. It runs on the same core as the WhatsApp channel ([whatsapp.md](whatsapp.md)); the statements are T1 to T9 in [SPEC.md](SPEC.md).

The channel is on only when its settings are given (below). Without them the server behaves as before and the Telegram paths answer `NOT_FOUND`. WhatsApp and Telegram can run alone or together; the engine host is started once for both. BotFather setup and a local trial are in [telegram-setup.md](telegram-setup.md), deployment in [deployment.md](deployment.md) and the privacy page the bot links to in [telegram-privacy.md](telegram-privacy.md).

## Code

| Path                               | What it holds                                                                                                                                                                                             |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pilot/server/chat/`               | The channel-neutral core shared with WhatsApp (below)                                                                                                                                                     |
| `pilot/server/telegram/api.ts`     | The Bot API client: updates, files, messages with inline buttons, per-chat spacing; no URL or token ever leaves it in an error                                                                            |
| `pilot/server/telegram/intake.ts`  | Turns an update into a recorded message or button tap, once; private chats only; the allowed-users gate                                                                                                   |
| `pilot/server/telegram/poller.ts`  | Long polling with the offset stored in the bot's state                                                                                                                                                    |
| `pilot/server/telegram/webhook.ts` | `POST /api/v1/telegram/webhook`, checked against the secret token                                                                                                                                         |
| `pilot/server/telegram/plan.ts`    | What one message is: a save (and how), a refusal, a command or a search                                                                                                                                   |
| `pilot/server/telegram/bot.ts`     | The conversation (login gate, commands, buttons), downloads, the worker, the "Linked" message, and Telegram's renderer for the shared parts                                                               |
| `pilot/server/telegram/store.ts`   | Telegram identities and message keys, the polling offset, result buttons, linked accounts, login and app links, Telegram-saved items (`TelegramStateStore`, memory); `postgres.ts` the same on PostgreSQL |
| `pilot/server/telegram/links.ts`   | Login and app links (tokens, the email mask) and their script-free pages                                                                                                                                  |
| `pilot/server/telegram/erase.ts`   | `/logout` (unlink, revoke links) and `/delete` (delete only Telegram-saved items, as `DELETE /items/{id}` does)                                                                                           |
| `pilot/server/app.ts`              | The link routes (`/api/v1/telegram/link/…`, `/api/v1/telegram/open/…`) and Google sign-in's return to a login link                                                                                        |

### The shared core

The parts that do not depend on the chat app moved out of `pilot/server/whatsapp/` into `pilot/server/chat/`, and the WhatsApp channel uses them with unchanged behaviour (its tests are unchanged and pass):

- `jobs.ts`: the job runner (claim, run, retry with a doubling delay, fail for good after six attempts, `PermanentJobError`) and the worker loop with `wake`.
- `items.ts`: which typed text is a note (forwarded, `note `/`save `, a single link), titles, the item's global ID from a message key (a UUID v4 from SHA-256, namespaced per channel), and `storeChatItem`, which stores under the owner's lock exactly as upload completion does and refuses when the job is no longer the current claim or consent was withdrawn meanwhile. Its optional `afterPublish` runs under the same lock right after publishing; Telegram records the item as saved through Telegram there.
- `search.ts`: search over one owner's items, by meaning with the engine host and by title for items still being indexed (W8/T8).
- `send-back.ts`: a picked result sent back (a file, a note's text, or "open it in the app"), then an "Open in app" link. Originals of kinds the chat cannot carry (audio, video, webpages synced from the app) are only checked to exist, not read into memory.
- `batch.ts`: one "Saved N items" confirmation per burst.
- `erase.ts`: WhatsApp's DELETE ALL: the vault reset, the vault's sessions and the bot's records of that person. Telegram does not use it, because a Telegram user's items live in their own account, which `/delete` must not reset (`telegram/erase.ts`, below).
- `channel.ts`: `ChatChannel<To>`, the renderer each channel implements: `sendText`, `sendResults`, `sendFile` and `sendOpenButton`, with its text and caption limits. WhatsApp's (`createWhatsAppChannel` in `whatsapp/conversation.ts`) sends an interactive list, image or document media and a CTA URL message, as before. Telegram's (`createTelegramChannel` in `telegram/bot.ts`) sends a numbered message with one button per result, `sendPhoto` or `sendDocument`, and a URL button.

What stays per channel is what really differs: identities, the transport (Meta's signed webhook; Telegram's long polling or secret-token webhook), downloads and their integrity check, and the conversation's commands and wording (typed words on WhatsApp; slash commands and buttons on Telegram). Button taps are acknowledged with `answerCallbackQuery` in Telegram's gate; WhatsApp list replies need no acknowledgement, so this is not part of the renderer.

## Settings

`loadConfig` (`pilot/server/config.ts`) reads them; tests are in `pilot/tests/telegram-config.test.ts`.

| Setting                                                | Meaning                                                                                                     |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `PILOT_TELEGRAM_BOT_TOKEN_FILE`                        | File with the bot token from BotFather                                                                      |
| `PILOT_TELEGRAM_PRIVACY_URL`                           | HTTPS page that `/privacy` and the notice link to ([telegram-privacy.md](telegram-privacy.md))              |
| `PILOT_TELEGRAM_CONTACT_EMAIL`                         | Address that `/help` gives                                                                                  |
| `PILOT_TELEGRAM_MODE`                                  | Optional: `polling` (default) or `webhook`                                                                  |
| `PILOT_TELEGRAM_WEBHOOK_SECRET_FILE`                   | File with the webhook's secret token (16 to 256 letters, digits, `_` or `-`); required in webhook mode only |
| `PILOT_TELEGRAM_ALLOWED_USERS`                         | Optional: numeric user IDs and @usernames, separated by commas; when set, only they can use the bot         |
| `PILOT_TELEGRAM_NOTICE_VERSION`                        | Optional, `1` by default; stored with the consent given by linking                                          |
| `PILOT_TELEGRAM_LOCAL_TRIAL`                           | `1` for a trial on a laptop ([telegram-setup.md](telegram-setup.md))                                        |
| `PILOT_GOOGLE_CLIENT_ID`, `PILOT_GOOGLE_CLIENT_SECRET` | The pilot's existing Google sign-in, which linking uses; nothing Telegram-specific                          |
| `PILOT_ENGINE_HOST_*`                                  | The same engine host settings as WhatsApp ([whatsapp.md](whatsapp.md)); one engine host serves both         |

The first three come together or not at all, and the optional ones are refused without them. The privacy page and contact are Telegram's own settings rather than shared with WhatsApp, because the two privacy pages differ (who decrypts messages, what is kept for display). The secrets are read from their files by the server itself, so they never enter its environment (which the engine host's Chromium inherits) or a command line; errors name the setting, never a value. The token must look like BotFather's (`<bot ID>:<secret>`).

Webhook mode needs an HTTPS `PILOT_ORIGIN`, because Telegram delivers only to HTTPS. `PILOT_TELEGRAM_LOCAL_TRIAL=1` accepts memory storage (or a local storage connection string) with a local origin or a tunnel's HTTPS origin while `PILOT_HOST` is a loopback address. Google's OAuth client accepts only the pilot domain's callback, so a trial cannot use real Google sign-in: it may use development sign-in (`PILOT_DEV_KEY_FILE`) for linking, which is otherwise refused on any non-local origin. Behind a tunnel that is allowed only with the trial on, a loopback `PILOT_HOST`, no Google client and memory storage, and never for the WhatsApp trial; anyone who has the tunnel's address can then sign in as any IITGN email while the trial runs, so it holds nothing that lasts. Real IITGN login is tried on the Azure pilot. Login and app links need an HTTPS origin: with a local one, `/start`, `/login` and `/open` explain that they need a tunnel, and no link button is sent (Telegram does not accept loopback addresses in buttons, and a phone cannot open them).

Allowed users are for the demo: someone else's message or tap is not recorded at all (no sender row, no message), and they get "Campus Recall on Telegram isn't open to everyone yet, so nothing you send here is saved." once per message. Usernames can change hands; prefer numeric IDs where they are known.

`main.ts` uses `PostgresBotStore` on Telegram's tables and `PostgresTelegramStore` with durable storage, memory stores otherwise; mounts the login and app link routes (and the webhook in webhook mode), with `announceTelegramLink` sending the "Linked" message straight from the link page's handler; starts the engine host once for both channels; starts `startTelegramBot` with `createTelegramIndexer`; then either calls `setWebhook` (webhook mode) or starts long polling. It logs the bot's @username from `getMe`. On `SIGTERM` or `SIGINT` it stops polling, stops the workers (sending waiting confirmations), closes the engine host and exits.

## Transports

**Long polling** (default; no public address needed). The poller first calls `deleteWebhook` (Telegram refuses `getUpdates` while a webhook is set), then repeats `getUpdates` with `timeout` 30 seconds, `allowed_updates: ["message", "callback_query"]` and the stored offset. Each update is recorded, then the offset (the last `update_id` plus one) is stored in `tg_state`, which also confirms the batch to Telegram. A restart continues from the stored offset; a crash after recording but before storing gets the batch again, and dedupe drops it. Failures are logged without the token and retried after 1 second, doubling to 30. Stopping aborts the waiting request.

**Webhook** (`/api/v1/telegram/webhook`, for the VM). At start the server calls `setWebhook` with the pilot URL, the secret token and the same update types. A request without `X-Telegram-Bot-Api-Secret-Token` gets 401 and a wrong one 403 (compared in constant time, through SHA-256 so lengths do not leak), before the body is read; other methods get 404; bodies are at most 1 MB. A valid update is recorded and answered 200 at once; the worker does the rest. A storage failure answers 500, so Telegram retries.

## Identity and storage

A Telegram user is their numeric Telegram user ID (`from.id`, a positive whole number below 2^53; anything else, and bots, are ignored). Only private chats are taken; in a private chat the chat ID is the user ID, so replies go there. The bot files a user's messages and jobs under `tg:<id>`, which is only a bookkeeping key: there is no Telegram vault. Items go into the IITGN account the user linked, whose vault is `google:<sub>` from that account's own Google sign-in (the same owner key, epoch, quota and change feed as the app's Auto-sync). The @username (or, without one, the first name) labels the login page ("Telegram @name") and is cleared on `/logout` and `/delete`.

Bot state uses the same `BotStore` as WhatsApp on Telegram's own tables. Migration 5 added `tg_senders`, `tg_inbound`, `tg_jobs` and `tg_links` (`LIKE` the WhatsApp tables, so the same SQL serves both; in them `wamid` holds the Telegram message key and `wa_id` the username), `tg_state` (the polling offset) and `tg_picks` (result buttons). Migration 6 adds:

- `tg_accounts`: one row per linked Telegram user (`user_id`, the account's `owner_key` and `email`, `linked_at`);
- `tg_links` gains `purpose` (`login` or `open`), `user_id` and `message_id` (the chat message with a login button, so the button can be removed); links from before migration 6 opened a Telegram vault and are dropped;
- `tg_saved`: which items of an account were saved through Telegram (`owner_key`, `global_id`, `user_id`, `saved_at`), so `/delete` erases only those;
- `sessions.via`: `telegram` for a session opened from a Telegram app link.

Backups and restores include all of them. Separate tables were chosen over a `channel` column on the WhatsApp tables because they leave WhatsApp's queries untouched: a WhatsApp worker can never claim a Telegram job without adding a filter to every query. Conformance tests run on memory and PostgreSQL (`pilot/tests/telegram-store.test.ts`).

Linking, opening the app, `/logout` and `/delete` for one Telegram user take a lock on `telegram-user:<id>` (the owner lock mechanism, so on PostgreSQL an advisory lock in one transaction); `/delete` then takes the account's own lock. A save checks again, under the account's lock, that its job is still the current claim, that the user is still linked to that same account and has not sent `/stop`, and records the item as saved through Telegram in the same transaction as publishing it.

## Messages, dedupe and jobs

A message is recorded under `m:<chat ID>:<message ID>` and a button tap under `c:<callback query ID>`; each gets one `ingest` job, exactly as a WhatsApp message under its `wamid`. Telegram sends the same update again with the same message or callback query, so this deduplicates every redelivery. The update ID is used only for the polling offset: Telegram may start it again from a random number after a week without updates, so it is not a lasting key. Each message or tap gets at most one reply (`claimReply` before sending), and the item's global ID is made from the message key, so a retried job finds the item it published. Under the account's lock the worker checks again that its job is still the current claim and that the user is still linked to that account and has not sent `/stop`, so a `/delete` or `/logout` handled by another worker while a file downloaded wins.

The job runner, retries, per-user rate limit (a burst of 30, then 30 a minute) and index jobs are WhatsApp's.

## What is saved

| Message                                                          | Saved as                                       | Limit              |
| ---------------------------------------------------------------- | ---------------------------------------------- | ------------------ |
| `photo` (the largest of its sizes)                               | `image`, `image/jpeg`                          | 20 MB              |
| `document` with `application/pdf`                                | `pdf` (page count is checked by the app later) | 20 MB              |
| `document` with `image/jpeg`, `image/png` or `image/webp`        | `image`                                        | 20 MB              |
| forwarded text (`forward_origin`, or the older `forward_date`)   | `note`                                         | 20,000 code points |
| text starting with `note ` or `save ` (any case; prefix removed) | `note`                                         | 20,000 code points |
| text that is only one `http` or `https` link                     | `note` with `sourceUrl`                        | 20,000 code points |

Telegram compresses photos sent as photos; a photo sent as a file (a document) keeps its original bytes, and `/help` says so. Titles are the caption, else the document's file name, else the first words of a note, else `Telegram photo <date>` or `Telegram PDF <date>`. `createdAt` is the message's `date`.

A file is fetched with `getFile` and then `https://api.telegram.org/file/bot<token>/<file_path>`, which Telegram serves up to 20 MB. A file whose declared `file_size` is over the app's limit (20,000,000 bytes) is refused before `getFile`, as is one Telegram refuses as too big; the download also stops as soon as it passes the limit. Telegram sends no hash, so the downloaded length must equal the declared `file_size` (a mismatch fails the attempt, which is retried) and the item's SHA-256 is computed from the bytes. Voice notes, audio, video (including video notes and GIFs), stickers, other documents (Word, PowerPoint, Excel), locations and contacts are refused with the WhatsApp channel's reasons. Group chats are ignored.

## Conversation

Commands are the bot's menu, exactly: `/start`, `/login`, `/help`, `/open`, `/logout`, `/privacy`, `/stop`, `/resume`, `/delete` (with or without `@<bot>`; `/start <payload>`, as a `t.me/<bot>?start=<payload>` link sends it, behaves as `/start`). A forwarded message is never a command. Unknown commands get a pointer to `/help`.

1. **Stopped** (`/stop`): only `/resume` or `/start` are answered ("Welcome back", or the login notice for someone not linked); anything else is not saved, its content is forgotten, and a tap is only acknowledged.
2. **Not linked** (T1): nothing is saved or searched and the stored update is reduced to its key and type. `/start` and `/login` send the notice with a **Log in with IITGN** URL button (a fresh one-time login link each time). `/help` and `/privacy` are answered, `/stop` pauses, and `/logout` revokes unused login links (and removes their buttons). Any other message, command or tap gets "Log in first with /login."
3. **Linked**: taps (below), commands, or the message goes on to be saved or searched.

The notice covers what is saved (what is sent, and the searches typed), that our server stores and processes files and sees searches, that Telegram keeps bot chats on its servers and chats with bots are not end-to-end encrypted, the 18+ age limit, `/logout`, `/delete` and the privacy link, and that nothing is saved before login.

| Command    | Answer once linked                                                                           |
| ---------- | -------------------------------------------------------------------------------------------- |
| `/start`   | "You're logged in as s•••a@iitgn.ac.in"                                                      |
| `/login`   | "You're already logged in as …; to use another account, send /logout first, then /login"     |
| `/help`    | What the bot does, the commands, that files keep full quality, and the contact email         |
| `/privacy` | The privacy URL                                                                              |
| `/stop`    | Stops saving and replying except to `/resume`; saved data is kept                            |
| `/resume`  | Resumes after `/stop`                                                                        |
| `/open`    | "Open your Campus Recall library in the app…" with an **Open in app** URL button (T6)        |
| `/logout`  | Unlinks this chat and revokes its unused links; what was saved stays in the library (T9)     |
| `/delete`  | Asks to tap **Yes, erase my Telegram items** (callback data `delete`) within 10 minutes (T9) |

Every button tap is answered with `answerCallbackQuery` so the app stops showing it as loading. A button whose one-time action is done is removed from its message with `editMessageReplyMarkup`: the login buttons once the user links (all of the user's outstanding login links are used up then) or sends `/logout`, and the delete button once tapped, whatever the outcome.

Emails in the chat are masked to the first and last letter of the name and the domain (`s•••a@iitgn.ac.in`), as the chat is not end-to-end encrypted.

**/logout.** Under the user's lock: the link to the account is removed, every unused login and app link of the user is revoked (their login buttons removed), and the bot's records of the user (`forgetSender`: message content, open jobs, username, consent, `/stop` and a pending `/delete`) are cleared. What was saved stays in the account's library. Sessions already opened in a browser are the account's own and stay until signed out there.

**/delete (T9).** The button within 10 minutes of `/delete` unlinks as `/logout` does and then, under the account's lock, deletes every item recorded as saved through Telegram into that account, each as `DELETE /items/{id}` does: a tombstone at the next revision in the change feed (so every device removes it, and a stale device cannot bring it back), then its original and index objects. The record of those items and the account's result buttons go too. Items synced from the app, the vault's epoch and its sessions are untouched; the replies say that removing the whole library is **Remove cloud library** in the app's Settings. Message keys stay, so a redelivered update is recognised and an erased item is never recreated. The button without a request says to send `/delete` first; after 10 minutes the request expires.

**Batched confirmations.** As on WhatsApp: "Saved to Campus Recall: <title>", or "Saved 3 items to Campus Recall: …" for a burst (3 seconds apart at most, 10 items at most).

## Search (T8)

Typed text that is not a command or a save is searched with the shared search over the linked account's whole library: items saved through Telegram and items synced from the app, by meaning where they have a usable index (from the server's engine host or a device), by title otherwise. The answer is one message, "Best matches for “<query>”. Tap one to get it back." with the results numbered (title and the page and excerpt, or "still indexing" / "title match"), "Matched by keyword only right now." when search by meaning is off, and one button per result (at most five). Telegram's `callback_data` holds at most 64 bytes, so a button carries `p:` and a 12-character random token (9 random bytes in base64url); `tg_picks` keeps the token with the account, item and place for a day, and removes expired ones as new ones are made. A tap on an expired or unknown token answers "That result has expired. Search again to get it."; another account's token finds nothing in this user's account.

A tapped result is sent back by the shared code: a JPEG or PNG up to 10 MB with `sendPhoto`, other photos and PDFs with `sendDocument` (multipart upload, the title as file name and the title and page as caption), a note as text (cut at Telegram's 4,096 characters with a pointer to the app), and kinds the chat cannot carry with "Open it in the app instead". Then "Open it in Campus Recall. The link works once, for 10 minutes." with an **Open in app** URL button and a fresh link.

## Linking and opening the app (T6)

Both kinds of link use the shared token code: 32 random bytes in the URL path, kept in `tg_links` only as their SHA-256 with their purpose and the Telegram user, valid for 10 minutes, used at most once. A login link is never accepted as an app link, nor the reverse, and neither is a WhatsApp link. Both pages are small HTML pages with no scripts or external resources (`Content-Security-Policy: default-src 'none'; style-src 'sha256-…'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`, `Referrer-Policy: same-origin`, `Cache-Control: no-store`), escape every name and email they show, and are counted toward the sign-in rate limit. Their Continue form posts to the same path; a `POST` whose `Origin` is not the pilot origin gets 403 and leaves the link usable.

**Login link** (`/api/v1/telegram/link/<token>`, from `/start` or `/login`). `GET`:

- with a valid session from the account's own sign-in (owner `google:<sub>`, which only a verified IITGN Google account, or development sign-in on a local server, can get; not a session opened from a Telegram app link): "Link Telegram @name to student@iitgn.ac.in?" with the consent wording (what is saved, server processing and searches, no end-to-end encryption, that whoever has the Telegram account can open the library from the bot's one-time links, 18+, `/logout` and `/delete`, the privacy link) and **Continue**;
- otherwise, on the pilot: a redirect to `/api/v1/auth/google/start?return=/api/v1/telegram/link/<token>`, the existing Google sign-in (state, nonce and PKCE unchanged, `hd=iitgn.ac.in`). `start` accepts as `return` only a login link's own path (anything else is 400) and keeps it in an HttpOnly `recall_return` cookie for `/api/v1/auth`, bound to that sign-in attempt by a hash with the attempt's own cookie; the server never stores the token. The callback sends a successful sign-in back to that link page, and ignores a return cookie that was not made for its attempt. Non-IITGN, personal and failed sign-ins end on Settings with the usual message, and link nothing;
- on a local trial with development sign-in instead of Google: an IITGN email form that posts to the same path (`intent=signin`), signs in through the same identity checks as any token, and comes back to the page.

The Continue `POST` (with that session) takes the link and, under the user's lock, links the user to the session's account (`tg_accounts`), records the consent time and notice version, and uses up the user's other login links. If the user is linked to another account, the page says to send `/logout` first and nothing changes. The page then says "Telegram is linked", and the bot sends "Linked to s•••a@iitgn.ac.in. Forward or send files to save them; type anything to search." and removes the used login buttons. Several Telegram users can link the same account, each only through that account's own sign-in.

**App link** (`/api/v1/telegram/open/<token>`, from `/open` and after a result). `GET` shows "Sign in to Campus Recall as student@iitgn.ac.in on this browser" and Continue. The `POST` takes the link and, while the user is still linked to that account, opens a normal session for it (with the account's email, marked `via: "telegram"`), ends any session the browser had, and redirects to `/?signin=telegram#/settings`.

`GET /session` returns `"via": "telegram"` for such a session and no `kind`: it is the account's own, so the app behaves exactly as after Google sign-in, including P02 (the device's library is uploaded only after "Include this device's library", and the cloud library is listed once the device takes part). In the app, `signin=telegram` counts as an explicit Auto-sync activation only if the server confirms a session with `via: "telegram"` (`pilot/client/autosync.ts`, `confirmBotSignIn`); the parameter alone changes nothing, `signin=whatsapp` does not accept it, and it does not accept a WhatsApp session or the account's own sign-in. A session opened from a Telegram app link cannot itself link another Telegram user: linking always needs the account's own sign-in.

So possession of the linked Telegram account plus a fresh link is a second way into the student's cloud library, besides their Google sign-in. Each link works once, for 10 minutes, and `/logout` (or `/delete`) revokes unused ones; the privacy page says so.

## Rate limits and the token

Telegram allows about one message a second per chat. The client queues messages per chat and spaces them at least a second apart (button acknowledgements are not messages and are not spaced). An HTTP 429 is waited out for Telegram's `retry_after` (up to 60 seconds, twice) and then sent once.

The bot token is part of every Bot API URL. It is read from its file by the server, never put in a command line, the environment or the output, and the client never lets a URL, request options or an underlying network error out: errors carry the method, the HTTP status and Telegram's own description (with the token removed if it ever appeared), and a network failure only its error code. Tests check that no error, log line or description contains the token, whether Telegram refuses a call, the server cannot be reached or the token is wrong.

## Tests

- `pilot/tests/telegram.test.ts`: T1 to T9, commands, allowed users and Google sign-in from a login link (against a stand-in for Google's token endpoint) on a real local API server in webhook mode, with a stand-in Bot API (`pilot/tests/telegram-helpers.ts`), `FakeEngineHost` and test-signed ID tokens; memory stores, and PostgreSQL and Azurite with `npm run test:pilot:storage`.
- `pilot/tests/telegram-transport.test.ts`: polling offset across a restart, `deleteWebhook` first, prompt stop, `setWebhook`, spacing, HTTP 429, the download limit, the token in no error or log, forwarded detection, numeric IDs only.
- `pilot/tests/telegram-store.test.ts` (linked accounts, links, Telegram-saved items, `sessions.via`, backups), `telegram-config.test.ts` (including development sign-in on a trial), `telegram-entry.test.ts` (the app's `signin=telegram`).
- `pilot/e2e/telegram-link.spec.ts` (`npm run test:pilot:e2e`): in Chromium, development sign-in in the app, the bot's login link and Continue, a note sent to the bot listed in the app for that email once the device's library is included (nothing uploaded before), and an app link signing a second browser in as that email.
- `pilot/model-e2e/telegram-search.spec.ts` (`npm run test:pilot:models`): with the real models, the bot linked to an account; its top result equals the app's for the engine host fixtures (on 11 November 2026 on a Mac: the PDF at page 2 and the photo, for both).

## Not done yet

- A demo record on real phones, real IITGN Google sign-in from a login link on the Azure pilot, and measurements on the VM (as for WhatsApp, [2026-11-23-whatsapp-demo.md](2026-11-23-whatsapp-demo.md)).
- Clean-up of old `tg_inbound` rows, finished jobs and expired `tg_links` rows; expired `tg_picks` rows go only when new buttons are made.
- A user removed from `PILOT_TELEGRAM_ALLOWED_USERS` keeps their link and what they saved, but cannot reach the bot to send `/logout` or `/delete`; they can still delete items in the app, or unlink them by hand if asked.
- If the "Linked" message cannot be sent (for example Telegram is down), the link still holds and the login button stays; the next message works as linked.
- Waiting confirmations live in the worker's memory, as on WhatsApp.
- Without an engine host, keyword search matches titles only.
