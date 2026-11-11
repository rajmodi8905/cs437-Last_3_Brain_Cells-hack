# Campus Recall

**Find what you saved, from what you remember.**

Campus Recall turns your screenshots, PDFs, notes, saved webpages and short recordings into a personal library you can search by meaning. Find a matching original, jump to the right PDF page or media interval, and keep processing on your own device.

https://github.com/user-attachments/assets/2947f113-1e72-4074-8d47-2b43daa21dfe

[Try Campus Recall](https://campusrecall.indiasouthcentral.cloudapp.azure.com) · [Install on your phone](#use-on-your-phone) · [Run locally](#run-locally)

- **Save the original.** Keep supported files and notes together, with a visible save confirmation and recent-saves library.
- **Search from memory.** Describe the topic or visual appearance; results lead back to the saved source.
- **Work offline.** After the one-time search setup, processing and retrieval run locally without inference API keys.
- **Choose how to store it.** Local only needs no account. Optional IITGN Google sign-in enables account Auto-sync through Azure.

Built by **Raj Modi, Chaitanya and Nakshatra**. A student project, not an official IIT Gandhinagar service. The hosted pilot runs until **6 December 2026, 17:47 IST**; export cloud originals before then.

---

## Course requirements and reproducibility

Developed for the **CS437 Vibe Coding Hackathon, IIT Gandhinagar, 2026–27 Semester 1**. The [course rules](https://anup.github.io/courses/cs437-2026-27-sem1/hackathon/) require a named real user, a testable specification, reviewed contributions and reproducible run/test commands.

| Requirement                                 | Project evidence                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Real users and interview-based requirements | [SPEC.md](SPEC.md), [Suhani's interview](docs/user/U01.md), [Bhavya's interview](docs/user/U02.md)                                                                                                                                                                                                                           |
| Independently testable behavior             | Frozen local-only **S1–S15** specification and [test coverage registry](tests/spec/coverage.json)                                                                                                                                                                                                                            |
| One command to run, one to test             | Docker commands below; no host Node/npm or cloud credentials needed                                                                                                                                                                                                                                                          |
| Integration history                         | [Original integration PR #6](https://github.com/rajmodi8905/cs437-Last_3_Brain_Cells-hack/pull/6), [pilot PR #35](https://github.com/rajmodi8905/cs437-Last_3_Brain_Cells-hack/pull/35) and [Docker/README PR #36](https://github.com/rajmodi8905/cs437-Last_3_Brain_Cells-hack/pull/36); PRs #35 and #36 merged 8 November. |
| Recorded AI assistance                      | [Project AI-use notes](docs/ai-use.md); members also keep their course lab notes                                                                                                                                                                                                                                             |
| Deployed usability and user evidence        | [Azure release](docs/pilot/2026-11-06-release.md), [owner phone report and limits](docs/pilot/2026-11-07-phone-check.md)                                                                                                                                                                                                     |

The optional account-sync extension has its own [P01–P15 pilot specification](docs/pilot/SPEC.md). The original coursework specification, model pins, fixtures and acceptance assertions retain their scope. Local development identities and automated browser tests do not count as real Google sign-ins or outside-group users.

### Run locally

**Prerequisites:** Git and a running Docker Desktop, or Docker Engine with Compose v2.24 or newer. Initial builds need internet access and several GB of free disk space. The full test command additionally needs **10 GB allocated to Docker**; this is a test-browser requirement, not a phone/PWA requirement.

Clone once:

```bash
git clone https://github.com/rajmodi8905/cs437-Last_3_Brain_Cells-hack.git
cd cs437-Last_3_Brain_Cells-hack
```

**One command to run:**

```bash
docker compose up --build --wait
```

Open **http://localhost:4600**. Docker builds the app and starts its API, PostgreSQL database and Azurite storage emulator. No `.env`, Azure account, Google secret or domain configuration is required.

For a quick check:

1. Save a note or supported file in the local library; reopen its original.
2. For semantic search, choose **Settings → Download offline search** and finish the accepted one-time download (about 445 MB per browser). Keep the app open while processing.
3. To try sync, choose **Set up Auto-sync**, use a synthetic address such as `checker@iitgn.ac.in` under **Sign in (development)**, then **Include this device's library**.
4. Open a second browser profile and use the same development address to check shared files, or another address to check isolation.

This local stack is bound to `127.0.0.1` and uses development authentication. It does not contact or change the deployed Azure pilot. Real Google sign-in, HTTPS and managed-identity storage are configured separately through the [production deployment runbook](docs/pilot/deployment.md).

Stop with `docker compose down`. Named volumes preserve server data and the signing key for the next start. A deliberate `docker compose down --volumes` resets the checker server and test-model cache; it does not clear a browser's local library. If port 4600 is busy, use `CAMPUS_RECALL_PORT=4601 docker compose up --build --wait` and open http://localhost:4601. Inspect startup failures with `docker compose logs`.

### Test

**One command to test:**

```bash
./test.sh
```

Run this from the clone; starting the app first is unnecessary. Use a POSIX shell on macOS/Linux, or Git Bash/WSL on Windows. Docker Desktop users should allocate **10 GB of memory** under **Settings → Resources** before the full test run. The script checks this requirement and gives a clear error if it is unmet. Chromium's isolated test profiles need enough storage budget to cache the unchanged model assets; no storage-quota bypass is enabled.

The command builds the test image, installs Chromium and its Linux dependencies, downloads and verifies the pinned models, and runs:

- TypeScript, ESLint, formatting and specification mapping checks.
- The existing **`npm test`** suites: fast, production browser and real-model acceptance.
- All pilot unit/storage tests against real local PostgreSQL and Azurite.
- Pilot browser flows and real-model cross-device retrieval.
- Production artifact validation.

Failures exit nonzero; skipped or flaky suite results are rejected. Repeated runs reuse the model download cache. Reports, screenshots, earlier-run history and a source snapshot manifest go to ignored **`test-evidence/docker/`**. The wrapper supplies only the clone's actual shallow HEAD metadata and a fresh index to existing provenance checks; it excludes personal Git configuration, hooks and earlier history. Modified container files remain recorded as dirty. CI retains the existing commit-specific S1–S15 gate.

The wrapper needs no host Node, browser installation or Docker socket. Stop its database/emulator afterward with `docker compose down`.

### Recorded verification

The [8 November Docker checker run](docs/verification/2026-11-08-checker.md) passed on Linux ARM64 in Docker Desktop, with **zero skips and flaky retries**:

| Suite                                | Passed |
| ------------------------------------ | -----: |
| Root fast tests                      |    107 |
| Root Chromium browser tests          |     37 |
| Root actual-model acceptance         |     11 |
| Pilot unit/storage tests             |    216 |
| Pilot Chromium browser tests         |     13 |
| Pilot actual-model cross-device test |      1 |

The [main CI run at `29e8c03`](https://github.com/rajmodi8905/cs437-Last_3_Brain_Cells-hack/actions/runs/42470954898) passed all five jobs after the pilot and Docker/README PRs merged. These commit-specific CI results are separate from the dated Docker run above and subsequent working changes. Merging source does not replace the deployed pilot image.

The [verification index](docs/verification/README.md) retains the original S1–S15, dependency and device evidence. The [7 November phone checkpoint](docs/pilot/2026-11-07-phone-check.md) labels the owner's report separately from instrumented observations. Full installed-phone pilot checks, a second genuine IITGN account and outside-group usage still need specific evidence. Retrieval fixtures are consumed regression data, not a general accuracy estimate.

## Use on your phone

Open the [live app](https://campusrecall.indiasouthcentral.cloudapp.azure.com), then install it from the browser:

- **iPhone:** Safari → Share → Add to Home Screen → enable **Open as Web App** if shown → Add. [Apple's instructions](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios).
- **Android:** Chrome → three-dot menu → Install app, or Install and create shortcut → Install. [Google's instructions](https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DAndroid&hl=en).

Open the installed icon before setup, then choose **Download offline search** in Settings. Saving and viewing originals work before setup. Optional sync requires IITGN Google sign-in and explicit inclusion of each device's library.

Saved originals and completed model downloads normally survive reopening the same installed app. Interrupted processing may restart; complete setup files are reused, while an incomplete file downloads again. Processing and sync make progress while the app is open. Browser storage is best-effort: keep important originals backed up and confirm uploads show as synced.

## Save from WhatsApp (demo)

For the pilot demo, a few allow-listed phones can also save to Campus Recall from WhatsApp, through Meta's test number. It is opt-in and separate from the app's local-only default:

- Message the bot and reply **AGREE** to its notice. Nothing is stored before that.
- Forward photos, PDFs and notes to save them; start a message with `note ` to save it as a note. Type anything else to search what you sent, and pick a result to get the original back.
- Send **OPEN** for a one-time link that opens your WhatsApp library in the app. **HELP**, **PRIVACY**, **STOP** / **START** and **DELETE ALL** do what they say.

Unlike the app, the bot indexes and searches on the pilot server, and WhatsApp (Meta) decrypts messages to the bot and keeps them for up to 30 days. Read [the bot's privacy page](docs/pilot/whatsapp-privacy.md) first. How it works: [whatsapp.md](docs/pilot/whatsapp.md); Meta setup and a local trial: [whatsapp-setup.md](docs/pilot/whatsapp-setup.md); deployment: the WhatsApp section of [deployment.md](docs/pilot/deployment.md).

## Supported content

| Input                       | Limit                       | Searchable content                                   |
| --------------------------- | --------------------------- | ---------------------------------------------------- |
| JPEG / PNG / WebP           | 20 MB                       | OCR text and visual embedding                        |
| Unencrypted PDF             | 20 MB, 50 pages             | Page text or scanned-page OCR                        |
| Note                        | 20,000 Unicode characters   | Saved text                                           |
| Public webpage              | 20,000 extracted characters | Captured or pasted plain text                        |
| MP3 / WAV / M4A             | 50 MB, five minutes         | English speech with timestamps                       |
| H.264 MP4 with optional AAC | 100 MB, two minutes         | English speech and a visual frame every five seconds |

Convert HEIC, HEVC and MOV before import. Failed processing keeps the saved original and exposes Retry. Web capture offers pasted text or inert HTML/PDF when direct fetch is blocked. Results are original sources and extracted excerpts; no generated answers or confidence percentages are presented. A missing match does not prove the item was never saved.

## Storage and privacy

Local only is the default. Each browser/device keeps its own IndexedDB library and cached models. After explicit setup, core extraction, embeddings and search stay local. Webpage capture, external links, sign-in and opted-in sync use the network.

Auto-sync stores included originals, metadata and compatible search indexes in private Azure account storage. It is not end-to-end encrypted; authorized operators can access stored content. Browser clearing, storage eviction or device failure can remove local data. Export important originals through Settings; ZIP backups are unencrypted and omit models/embeddings.

The hosted pilot's export deadline is **6 December 2026, 17:47 IST (12:17 UTC)**. Automatic VM deallocation stops compute; final storage/disk/IP cleanup follows the disclosed retention process. Read the [pilot Privacy Policy](docs/pilot/privacy-policy.md), [Terms](docs/pilot/terms-and-conditions.md) and [third-party notices](THIRD_PARTY_NOTICES.md).

## Developer guide

The production server stack has three containers: the built PWA/Node API, PostgreSQL and Caddy for HTTPS. Private Azure Blob storage and Google OAuth are external services. AI inference runs in the user's browser. The root Compose file substitutes local Azurite and development identities for checking.

| Area                                             | Location              |
| ------------------------------------------------ | --------------------- |
| Local library, originals and queue               | `src/storage/`        |
| Extraction, local inference and ranking          | `src/engine/`         |
| Application services and UI                      | `src/app/`, `src/ui/` |
| Account sync, API, durable stores and deployment | `pilot/`              |
| PWA caching                                      | `src/sw.ts`           |

For frontend-only development with **Node 24**, run `npm ci` and `npm run dev`. This does not start the account API. `npm run build` produces `dist/`; `npm run preview` serves it locally. A subdirectory build uses `APP_BASE=/campus-recall/ npm run build`.

Native test entrypoints remain `npm test`, `npm run test:pilot:storage` (requires Docker), `npm run test:pilot:e2e` and `npm run test:pilot:models`. Native browser/model runs need the existing Chromium install, `npm run models:download` and production build; `./test.sh` automates those prerequisites.

Further documentation: [architecture](docs/architecture.md), [pilot protocol](docs/pilot/protocol.md), [deployment](docs/pilot/deployment.md), [test evidence](docs/implementation/test-evidence.md), [team workflow](docs/implementation/README.md), [physical-device preparation](docs/implementation/device-session.md) and [milestone history](docs/verification/milestones-2026-10.md). Changes reach `main` through reviewed pull requests; preserve frozen assertions and record material assistance in [AI-use notes](docs/ai-use.md).
