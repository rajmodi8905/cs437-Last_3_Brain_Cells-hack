# Separate one-month deployment pilot

The pilot is the hosted side of AnyRecall (called Campus Recall until 12 November 2026): optional Auto-sync with IITGN Google sign-in, and the Telegram bot. It was deployed on 6 November 2026, and [PR #35](https://github.com/rajmodi8905/cs437-Last_3_Brain_Cells-hack/pull/35) merged its implementation, packaging and deployment tests into `main` on 8 November. Real Google sign-in with the owner’s IITGN account, hosted recovery and PWA browser checks passed. See the [release record](2026-11-06-release.md) and [7 November owner phone check and evidence limits](2026-11-07-phone-check.md). The completed 3 November submission and its S1–S15 evidence retain their original scope. Merging the source does not replace the deployed immutable image.

Export deadline and compute cutoff: **6 December 2026, 17:47 IST (12:17 UTC)**. Users can export cloud originals and metadata through Settings. See the [deployment runbook](deployment.md), [pilot privacy policy](privacy-policy.md) and [terms](terms-and-conditions.md).

The opt-in Telegram channel ([telegram.md](telegram.md)) lets a student link the team's bot to their IITGN account; it then saves what they send into that account's own cloud library, searches it by meaning in the chat and sends originals back. It was deployed on the pilot on 12 November 2026, when the owner checked it on an iPhone ([record](telegram.md#checked-on-the-pilot)). See its [BotFather setup and local trial](telegram-setup.md), [privacy page](telegram-privacy.md) and the Telegram section of the [runbook](deployment.md). It is off unless its settings are given; the local checker stack keeps it off.

The opt-in WhatsApp channel ([whatsapp.md](whatsapp.md)) is built on the same core, with its [Meta setup and local trial](whatsapp-setup.md), [privacy page](whatsapp-privacy.md) and deployment section in the [runbook](deployment.md). It is off by default and can run alongside Telegram; opening it to students needs a verified WhatsApp Business account.

For a fresh-laptop local check, run `docker compose up --build --wait` at the repository root and open http://localhost:4600. Run all checker tests with `./test.sh` (10 GB allocated to Docker for the isolated real-model test browser). The root Compose stack uses persistent local PostgreSQL/Azurite and visibly labelled development sign-in, without Azure/Google credentials; it does not deploy or modify the live pilot. See the [root quickstart](../../README.md#run-locally).

Read in this order:

1. [Implementation plan, dependencies, user flows and access](2026-11-04-implementation-plan.md) — original ordered plan; dated implementation records and the deployment runbook describe executed work.
2. [Confirmed one-month scope](2026-11-04-one-month-scope.md) — local-only/account auto-sync, Azure storage, local processing/search, selective offline downloads.
3. [Earlier INSIIT and hosting options](../implementation/2026-11-04-insiit-sync-options.md) — research/history; later confirmed decisions above supersede unresolved choices and narrower initial-slice proposals.

Sign-in is Google-based and run by the pilot server itself (no Firebase), independent of INSIIT; an INSIIT link only opens the site. See the plan's "Decisions on 5 November".

Private account storage is selected; E2EE/native clients/cloud inference are outside this pilot. The one-time model download is accepted. Provisioned resources, source identities, tests and pilot dates are in the dated records and the runbook; none are implied by this index.

The implementation on `main` includes PostgreSQL and Azure Blob storage (in-memory storage is only for local development), production containers and Azure deployment infrastructure. Implementation notes and limits are at the end of [protocol.md](protocol.md). Build the frontend with `npm run build`, then run the pilot locally with `npm run pilot:server` (settings: `PILOT_ORIGIN`, `PILOT_PORT`, `PILOT_QUOTA_BYTES`, `PILOT_GOOGLE_CLIENT_ID` with `PILOT_GOOGLE_CLIENT_SECRET` for Google sign-in; `PILOT_DATABASE_URL` with `PILOT_BLOB_ACCOUNT_URL` for durable storage, `PILOT_BACKUP_CONTAINER`, `PILOT_BACKUP_EVERY_HOURS`, `PILOT_BACKUP_KEEP` for database backups (operator command: `node .cache/pilot-server/backup.mjs`); `PILOT_DEV_KEY_FILE` for local development sign-in only). Tests: `npm run test:pilot`, `npm run test:pilot:storage` (needs Docker) and `npm run test:pilot:e2e`.

Real-model cross-device validation has a separate entrypoint, `npm run test:pilot:models`, after model assets are available. The quick pilot browser suite does not stand in for real retrieval or Azure/Google evidence.

CI runs the pilot durable storage, quick browser and real-model browser suites in a separate job, without production Azure/Google credentials, and includes that job in the final checks gate. [PR #35 CI run 42392708779](https://github.com/rajmodi8905/cs437-Last_3_Brain_Cells-hack/actions/runs/42392708779) passed 216 pilot storage tests, 13 browser tests and one actual-model cross-device test alongside the root S1–S15 suites. Results on real phones are the owner's reports: the [7 November phone check](2026-11-07-phone-check.md) and the 12 November checks of the Telegram bot and of Google sign-in inside the home-screen app.
