
https://github.com/user-attachments/assets/341df4a2-4a50-4d52-a05d-58924ae9cf13
# AnyRecall

**Find what you saved, from what you remember.**

AnyRecall turns your screenshots, PDFs, notes, saved webpages and short recordings into a personal library you can search by meaning. Find a matching original, jump to the right PDF page or media interval, and keep processing on your own device.

AnyRecall was called Campus Recall until 12 November 2026; older records keep that name.





https://github.com/user-attachments/assets/69bf0032-89fb-40a4-a01a-e86cb54648ef





[Try AnyRecall](https://campusrecall.indiasouthcentral.cloudapp.azure.com) · [Telegram bot](#telegram-bot) · [Install on your phone](#use-on-your-phone) · [Run locally](#run-locally)

- **Save the original.** Keep supported files and notes together, with a visible save confirmation and recent-saves library.
- **Search from memory.** Describe the topic or visual appearance; results lead back to the saved source.
- **Work offline.** After the one-time search setup, processing and retrieval run locally without inference API keys.
- **Choose how to store it.** Local only needs no account. Optional IITGN Google sign-in turns on Auto-sync through Azure, and the Telegram bot saves into the same account.

Built by **Raj Modi, Chaitanya and Nakshatra**. A student project, not an official IIT Gandhinagar service. The hosted pilot runs until **6 December 2026, 17:47 IST**; export cloud originals before then.

## Three ways to use it

| Way                               | What it does                                                                                                                          | Account                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| [The app](#the-app)               | Saves originals in the browser on your device and searches them there by meaning, also offline                                        | None                   |
| [Auto-sync](#auto-sync-optional)  | Keeps the library of each device you include in one private cloud library, so your other devices list, search and open it             | IITGN Google sign-in   |
| [The Telegram bot](#telegram-bot) | Saves what you send or forward in a chat into that same cloud library, searches it by meaning in the chat and sends the original back | The same IITGN account |

### The app

Open the [live app](https://campusrecall.indiasouthcentral.cloudapp.azure.com) or [run it locally](#run-locally). Local only is the default: nothing leaves the device, and no account is needed.

1. **Save.** Add a file, a note or a webpage. The original is stored at once and can be opened again exactly as saved.
2. **Set up search once.** In Settings choose **Download offline search** (about 445 MB per browser). Keep the app open while items are processed.
3. **Search.** Describe what you remember. Each result opens the saved original at the matching PDF page or media time.

| Input                       | Limit                       | Searchable content                                   |
| --------------------------- | --------------------------- | ---------------------------------------------------- |
| JPEG / PNG / WebP           | 20 MB                       | OCR text and visual embedding                        |
| Unencrypted PDF             | 20 MB, 50 pages             | Page text or scanned-page OCR                        |
| Note                        | 20,000 Unicode characters   | Saved text                                           |
| Public webpage              | 20,000 extracted characters | Captured or pasted plain text                        |
| MP3 / WAV / M4A             | 50 MB, five minutes         | English speech with timestamps                       |
| H.264 MP4 with optional AAC | 100 MB, two minutes         | English speech and a visual frame every five seconds |

Convert HEIC, HEVC and MOV before import. Failed processing keeps the saved original and offers Retry. Web capture offers pasted text or inert HTML/PDF when direct fetch is blocked. Results are original sources and extracted excerpts; no generated answers or confidence percentages are shown. A missing match does not prove the item was never saved.

### Auto-sync (optional)

In Settings choose **Set up Auto-sync**, then **Sign in with Google** with an IITGN account, then **Include this device's library**. Nothing is uploaded before that last step. Included originals, their details and their search indexes go to a private cloud library (200 MB per account); every other signed-in device lists them, searches them on the device and opens or downloads the original. Extraction, embeddings and search stay on the device.

You can keep an item offline, remove a download, pause sync on one device, delete an item from the cloud library, export the cloud originals, or remove the cloud library altogether. How it works: [pilot specification P01–P15](docs/pilot/SPEC.md) and [sync protocol](docs/pilot/protocol.md).

## Telegram bot

The Telegram bot saves into your AnyRecall cloud library from a chat, and searches it there. It is opt-in and separate from the app's local-only default. The pilot's bot is [@ANYRECALLBOT](https://t.me/ANYRECALLBOT). Read [the bot's privacy page](docs/pilot/telegram-privacy.md) first.

**1. Log in.** Open [@ANYRECALLBOT](https://t.me/ANYRECALLBOT) in Telegram and tap **Start** (or send `/start` or `/login`). Read the notice and tap **Log in with IITGN**. Sign in with the same IITGN Google account you use in the app, then press **Continue** to link the chat to it. The chat says "Linked to …". Nothing is stored or searched before that, and the login link works once, for 10 minutes.

**2. Save.** Send or forward any of these. Several sent together get one "Saved … items" confirmation.

| Send                                                                         | Saved as            | Limit                                 |
| ---------------------------------------------------------------------------- | ------------------- | ------------------------------------- |
| A photo, or a JPEG, PNG or WebP file                                         | Photo               | 20 MB                                 |
| A PDF                                                                        | PDF                 | 20 MB; up to 50 pages can be searched |
| A forwarded text message                                                     | Note                | 20,000 characters                     |
| A message that starts with `note ` (for example `note Mess timings 8 to 10`) | Note                | 20,000 characters                     |
| A message that is only one link                                              | Note with that link | 20,000 characters                     |

Send a photo as a file to keep its full quality. Everything goes into the same cloud library that Auto-sync uses (200 MB per account), and the server indexes it with the app's own search model, so the app finds it too.

**3. Search.** Type anything else. The bot searches your whole cloud library by meaning, both what you saved in the chat and what your devices synced, and answers "Best matches for …" with up to five results as buttons. While it works the chat shows "typing…"; if a file you just sent is still being processed, it first says so.

**4. Get the original back.** Tap a result. The photo or PDF comes back in the chat, or the note as text. Result buttons work for a day.

**5. Open it in the browser.** After a result, and with `/open`, the bot sends an **Open in browser** button. The link signs that browser in to your library, works once and lasts 10 minutes.

**Home-screen app.** A link from the chat always opens in the browser, never in the app you added to your home screen, which keeps its own sign-in. Sign in there once with the same IITGN account and turn on Auto-sync (**Include this device's library**); from then on everything you save in the chat shows up there.

| Command            | What it does                                                                                                                                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/start`, `/login` | Shows the notice and the login button                                                                                                                                                                                   |
| `/open`            | Sends a one-time link that opens your library in your browser                                                                                                                                                           |
| `/logout`          | Unlinks the chat and cancels unused links. What you saved stays in your library                                                                                                                                         |
| `/delete`          | After you confirm within 10 minutes, erases only what you saved through Telegram, on every device, and unlinks the chat. Items added in the app stay; **Remove cloud library** in the app's Settings removes everything |
| `/stop`, `/resume` | Pauses the bot (nothing is saved or answered) and turns it on again                                                                                                                                                     |
| `/help`            | Lists what the bot can do                                                                                                                                                                                               |
| `/privacy`         | Sends the link to the privacy page                                                                                                                                                                                      |

**When something cannot be saved or searched**, the bot says what happened, names the file and says what to do next:

| Case                                | The bot says                                                                                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Voice, audio, video, GIF or sticker | For a video: "Can't save videos. I can save photos, PDFs, text notes and links."                                                                             |
| Word, PowerPoint or Excel file      | "Can't save .docx files. Export it as a PDF and send that instead."                                                                                          |
| A file over 20 MB                   | ""Big notes.pdf" is 31.3 MB, over the 20 MB limit for PDFs, so it wasn't saved. Compress it or split it into smaller PDFs, then send them again."            |
| A note over 20,000 characters       | "This note is 23,456 characters, over the 20,000-character limit for notes, so it wasn't saved. Split it into shorter notes and send them one by one."       |
| The cloud library is full           | "Your AnyRecall cloud library has reached its 200 MB limit, so "Mess menu.pdf" wasn't saved. Delete some items in the app to make room, then send it again." |
| A PDF with more than 50 pages       | ""Lecture.pdf" has 71 pages — search works on PDFs up to 50 pages. It's still saved; split it into smaller PDFs to make it searchable."                      |
| A password-protected or damaged PDF | It is still saved, and the bot says to remove the password, or to export it to a new PDF, and send it again                                                  |
| Nothing matches a search            | "Nothing matched “…” in your AnyRecall library. Try other words."                                                                                            |
| A message before login              | "Log in first with /login."                                                                                                                                  |

Every reply is listed in [telegram.md](docs/pilot/telegram.md#messages).

**What is different from the app.** The bot stores and indexes on the pilot server, and the server sees your searches. Telegram keeps bot chats on its own servers, and chats with bots are not end-to-end encrypted. Whoever has your Telegram account can open your cloud library through the bot's one-time links; `/logout` or `/delete` ends that. The bot is for people 18 or older.

**Checked on the pilot.** On 12 November 2026 the bot was deployed on the Azure pilot and the owner checked it on an iPhone: IITGN login and linking, saving PDFs, search by meaning, getting the original back, the browser link, and Google sign-in inside the home-screen app. This is the owner's report from one phone. The automated tests below cover login and linking, saving, search, sending the original back and the browser link against stand-ins for Telegram and Google.

How it works: [telegram.md](docs/pilot/telegram.md). Creating a bot and trying it on a laptop (`npm run pilot:telegram-local`): [telegram-setup.md](docs/pilot/telegram-setup.md). Running it on the server: the Telegram section of [deployment.md](docs/pilot/deployment.md).

### WhatsApp

A WhatsApp channel is built on the same core: agree to its notice, forward photos, PDFs and notes, type to search, pick a result to get the original back, and `OPEN` for a one-time link. It is off by default. Opening it to students needs a verified WhatsApp Business account; Meta's free test number reaches at most five listed phones. See [whatsapp.md](docs/pilot/whatsapp.md), [whatsapp-setup.md](docs/pilot/whatsapp-setup.md) and [its privacy page](docs/pilot/whatsapp-privacy.md).

## Use on your phone

Open the [live app](https://campusrecall.indiasouthcentral.cloudapp.azure.com), then install it from the browser:

- **iPhone:** Safari → Share → Add to Home Screen → enable **Open as Web App** if shown → Add. [Apple's instructions](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios).
- **Android:** Chrome → three-dot menu → Install app, or Install and create shortcut → Install. [Google's instructions](https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DAndroid&hl=en).

The home-screen label is **AnyRecall**. Open the installed icon before setup, then choose **Download offline search** in Settings. Saving and viewing originals work before setup. Auto-sync needs IITGN Google sign-in and **Include this device's library** on each device.

Saved originals and completed model downloads normally survive reopening the same installed app. Interrupted processing may restart; complete setup files are reused, while an incomplete file downloads again. Processing and sync make progress while the app is open. Browser storage is best-effort: keep important originals backed up and confirm uploads show as synced.

A device that used the app under its earlier name starts with an empty library: the old library and search download are not carried over, the app deletes them from the device at its next start, and a backup made by the earlier version cannot be restored.

## Run locally

**Prerequisites:** Git and a running Docker Desktop, or Docker Engine with Compose v2.24 or newer. Initial builds need internet access and several GB of free disk space.

```bash
git clone https://github.com/rajmodi8905/cs437-Last_3_Brain_Cells-hack.git
cd cs437-Last_3_Brain_Cells-hack
docker compose up --build --wait
```

Open **http://localhost:4600**. Docker builds the app and starts its API, PostgreSQL database and Azurite storage emulator. No `.env`, Azure account, Google secret or domain configuration is required.

For a quick check:

1. Save a note or supported file in the local library; reopen its original.
2. For semantic search, choose **Settings → Download offline search** and finish the one-time download (about 445 MB per browser). Keep the app open while processing.
3. To try sync, choose **Set up Auto-sync**, use a synthetic address such as `checker@iitgn.ac.in` under **Sign in (development)**, then **Include this device's library**.
4. Open a second browser profile and use the same development address to check shared files, or another address to check isolation.

This local stack is bound to `127.0.0.1` and uses development sign-in. It does not contact or change the deployed Azure pilot, and the Telegram and WhatsApp channels are off in it. Real Google sign-in, HTTPS and managed-identity storage are set up through the [deployment runbook](docs/pilot/deployment.md).

Stop with `docker compose down`. Named volumes keep server data and the signing key for the next start. `docker compose down --volumes` resets the checker server and test-model cache; it does not clear a browser's local library. If port 4600 is busy, use `ANYRECALL_PORT=4601 docker compose up --build --wait` and open http://localhost:4601. Inspect startup failures with `docker compose logs`.

For frontend-only development with **Node 24**, run `npm ci` and `npm run dev`. This does not start the account API. `npm run build` produces `dist/`; `npm run preview` serves it locally. A subdirectory build uses `APP_BASE=/anyrecall/ npm run build`.

## Tests

**One command:**

```bash
./test.sh
```

Run it from the clone; starting the app first is unnecessary. Use a POSIX shell on macOS/Linux, or Git Bash/WSL on Windows. Docker needs **10 GB of memory** (Docker Desktop: **Settings → Resources**) for the isolated test browser that caches the 445 MB models; the script checks this and says so if it is unmet.

The command builds the test image, installs Chromium, downloads and verifies the pinned models, and runs:

- TypeScript, ESLint, formatting and specification mapping checks.
- The **`npm test`** suites: fast, production browser and real-model acceptance.
- All pilot unit and storage tests against local PostgreSQL and Azurite, including the Telegram and WhatsApp channels against stand-ins for their APIs.
- Pilot browser flows and real-model tests: cross-device retrieval, the engine host, and the bots' search and indexing replies.
- Production artifact validation.

Failures exit nonzero; skipped or flaky suite results are rejected. Repeated runs reuse the model download cache. Reports, screenshots and earlier-run history go to the ignored **`test-evidence/docker/`**. The wrapper needs no host Node, browser installation or Docker socket. Stop its database and emulator afterward with `docker compose down`.

**Native commands** (Node 24, `npm ci`, Playwright's Chromium, `npm run models:download`), with their latest results:

| Command                                      | What it runs                                                                       |                                                    Result |
| -------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------: |
| `npm run check`, `npm run format:check`      | TypeScript, ESLint, product copy rules, specification registry, Prettier           |                                                      pass |
| `npm run test:fast`                          | Root unit and component tests (Vitest)                                             |                                                205 passed |
| `npm run build`, then `npm run test:browser` | Root Chromium tests of the production build                                        |                                                 66 passed |
| `npm run test:acceptance`                    | Root acceptance with the real models                                               |                                                 12 passed |
| `npm run test:pilot`                         | Pilot server, sync, Telegram and WhatsApp tests on memory stores                   | 511 passed, 30 skipped (they need PostgreSQL and Azurite) |
| `npm run test:pilot:storage`                 | The same pilot tests on memory stores and on PostgreSQL and Azurite (needs Docker) |                                                720 passed |
| `npm run test:pilot:e2e`                     | Pilot Chromium flows, including the Telegram and WhatsApp links                    |                                                 22 passed |
| `npm run test:pilot:models`                  | Pilot tests with the real models (builds the engine host)                          |                                                  7 passed |
| `node scripts/check-release.mjs dist /`      | Validates the built `dist/` as a release artifact                                  |                                                      pass |

The results are from a native run on 12 November 2026 on an Apple Silicon Mac with Node 26.11.1 (CI and the Docker image use Node 24), with no failures.

`npm test` runs the fast, browser and acceptance suites in turn. The specification is [SPEC.md](SPEC.md), statements S1 to S16; [tests/spec/coverage.json](tests/spec/coverage.json) maps each statement to its tests, and `npm run spec:summary` reports S1 to S15 from the latest run. Earlier dated runs are in the [verification index](docs/verification/README.md), including the [8 November Docker checker run](docs/verification/2026-11-08-checker.md). Retrieval fixtures are consumed regression data, not a general accuracy estimate. Automated tests use development sign-in and stand-ins for Google, Telegram and Meta; results on real phones are the owner's reports in the [7 November phone check](docs/pilot/2026-11-07-phone-check.md) and the 12 November Telegram check above.

## Privacy

Local only is the default. Each browser and device keeps its own IndexedDB library and cached models. After setup, extraction, embeddings and search stay on the device. Webpage capture, external links, sign-in and opted-in sync use the network.

Auto-sync stores included originals, their details and search indexes in private Azure account storage. It is not end-to-end encrypted; authorized operators can access stored content. The Telegram and WhatsApp bots store and index on the pilot server, and chats with them are not end-to-end encrypted. Browser clearing, storage eviction or device failure can remove local data. Export important originals through Settings; ZIP backups are unencrypted and omit models and embeddings.

The hosted pilot's export deadline is **6 December 2026, 17:47 IST (12:17 UTC)**. Automatic VM deallocation stops compute then; storage, disk and IP cleanup follow the disclosed retention process. Read the [pilot Privacy Policy](docs/pilot/privacy-policy.md), [Terms](docs/pilot/terms-and-conditions.md), the [Telegram](docs/pilot/telegram-privacy.md) and [WhatsApp](docs/pilot/whatsapp-privacy.md) privacy pages and the [third-party notices](THIRD_PARTY_NOTICES.md).

## Architecture

The app is a React, Vite and TypeScript PWA. Its library is an IndexedDB database on the device, and extraction, embeddings and ranking run in the browser with pinned models, so search needs no server. The pilot server adds accounts: a Node API with PostgreSQL, private Azure Blob storage and Caddy for HTTPS, with Google sign-in for IITGN accounts. For the bots, the server runs the app's own engine in headless Chromium (the engine host), so an item saved in a chat gets the same index a device would make. The root Compose file replaces Azure and Google with local Azurite and development sign-in for checking.

| Area                                              | Location                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------ |
| Local library, originals and queue                | `src/storage/`                                                           |
| Extraction, local inference and ranking           | `src/engine/`                                                            |
| Application services and UI                       | `src/app/`, `src/ui/`                                                    |
| PWA caching                                       | `src/sw.ts`                                                              |
| Account sync client and its screens               | `pilot/client/`, `pilot/ui/`                                             |
| Account API, durable stores, backups              | `pilot/server/`                                                          |
| Telegram and WhatsApp channels, their shared core | `pilot/server/telegram/`, `pilot/server/whatsapp/`, `pilot/server/chat/` |
| Engine host page for server indexing              | `pilot/engine-host/`                                                     |
| Containers and Azure deployment                   | `pilot/deploy/`, `pilot/azure/`                                          |

The site address, the container image and the server's paths keep the earlier name (`campusrecall…`, `campus-recall…`); they are deployment names, not the product's.

## Course requirements

Developed for the **CS437 Vibe Coding Hackathon, IIT Gandhinagar, 2026–27 Semester 1**. The [course rules](https://anup.github.io/courses/cs437-2026-27-sem1/hackathon/) require a named real user, a testable specification, reviewed contributions and reproducible run/test commands.

| Requirement                                 | Project evidence                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Real users and interview-based requirements | [SPEC.md](SPEC.md), [Suhani's interview](docs/user/U01.md), [Bhavya's interview](docs/user/U02.md)                                                                                                                                                                                                                           |
| Independently testable behavior             | Local-only **S1–S16** specification and [test coverage registry](tests/spec/coverage.json); pilot [P01–P15, W1–W9 and T1–T9](docs/pilot/SPEC.md)                                                                                                                                                                             |
| One command to run, one to test             | `docker compose up --build --wait` and `./test.sh`; no host Node/npm or cloud credentials needed                                                                                                                                                                                                                             |
| Integration history                         | [Original integration PR #6](https://github.com/rajmodi8905/cs437-Last_3_Brain_Cells-hack/pull/6), [pilot PR #35](https://github.com/rajmodi8905/cs437-Last_3_Brain_Cells-hack/pull/35) and [Docker/README PR #36](https://github.com/rajmodi8905/cs437-Last_3_Brain_Cells-hack/pull/36); PRs #35 and #36 merged 8 November. |
| Recorded AI assistance                      | [Project AI-use notes](docs/ai-use.md); members also keep their course lab notes                                                                                                                                                                                                                                             |
| Deployed usability and user evidence        | [Azure release](docs/pilot/2026-11-06-release.md), [owner phone report](docs/pilot/2026-11-07-phone-check.md), the 12 November Telegram check [above](#telegram-bot)                                                                                                                                                         |

The original coursework specification, model pins, fixtures and acceptance assertions keep their scope. Local development identities and automated browser tests do not count as real Google sign-ins or outside-group users.

## Links

- Product: [SPEC.md](SPEC.md), [user guide](docs/product/user-guide.md), [product context](PRODUCT.md), [design context](DESIGN.md)
- Pilot: [overview](docs/pilot/README.md), [specification](docs/pilot/SPEC.md), [sync protocol](docs/pilot/protocol.md), [Telegram](docs/pilot/telegram.md), [WhatsApp](docs/pilot/whatsapp.md), [deployment](docs/pilot/deployment.md), [automated deployment](auto_deployment.md)
- Code: [architecture](docs/architecture.md), [test evidence](docs/implementation/test-evidence.md), [team workflow](docs/implementation/README.md), [physical-device preparation](docs/implementation/device-session.md)
- Records: [verification index](docs/verification/README.md), [milestone history](docs/verification/milestones-2026-10.md), [AI-use notes](docs/ai-use.md)

Changes reach `main` through reviewed pull requests; frozen assertions are preserved and material assistance is recorded in the AI-use notes.
