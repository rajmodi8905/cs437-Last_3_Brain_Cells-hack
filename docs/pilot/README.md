# Separate one-month deployment pilot

Status 8 November 2026: the pilot was deployed on 6 November, and [PR #35](https://github.com/rajmodi8905/cs437-Last_3_Brain_Cells-hack/pull/35) merged its implementation, packaging and deployment tests into `main` on 8 November. Real Google sign-in with the owner’s IITGN account, hosted recovery and PWA browser checks passed. See the [release record](2026-11-06-release.md) and [7 November owner phone check and evidence limits](2026-11-07-phone-check.md). The completed 3 November submission and its S1–S15 evidence retain their original scope. Merging the source does not replace the deployed immutable image.

Export deadline and compute cutoff: **6 December 2026, 17:47 IST (12:17 UTC)**. Users can export cloud originals and metadata through Settings. See the [deployment runbook](deployment.md), [pilot privacy policy](privacy-policy.md) and [terms](terms-and-conditions.md).

For a fresh-laptop local check, run `docker compose up --build --wait` at the repository root and open http://localhost:4600. Run all checker tests with `./test.sh` (10 GB allocated to Docker for the isolated real-model test browser). The root Compose stack uses persistent local PostgreSQL/Azurite and visibly labelled development sign-in, without Azure/Google credentials; it does not deploy or modify the live pilot. See the [root quickstart](../../README.md#run-locally).

Read in this order:

1. [Implementation plan, dependencies, user flows and access](2026-11-04-implementation-plan.md) — original ordered plan; dated implementation records and the deployment runbook describe executed work.
2. [Confirmed one-month scope](2026-11-04-one-month-scope.md) — local-only/account auto-sync, Azure storage, local processing/search, selective offline downloads.
3. [Earlier INSIIT and hosting options](../implementation/2026-11-04-insiit-sync-options.md) — research/history; later confirmed decisions above supersede unresolved choices and narrower initial-slice proposals.

5 November: sign-in is Google-based and run by the pilot server itself (no Firebase), independent of INSIIT (INSIIT integration is future scope); Phase 0 and 1 started on branch `pilot/auto-sync`. See the plan's "Decisions on 5 November".

Private account storage is selected; E2EE/native clients/cloud inference are outside this pilot. The one-time model download is accepted. Actual provisioned resources, source identities, tests and pilot dates must be recorded as work proceeds; none are implied by this index. No automatic deployment or resource creation follows from reading the plan.

Implementation now on `main` includes PostgreSQL and Azure Blob storage (in-memory storage is only for local development), production containers and Azure deployment infrastructure. The implementation status and remaining limits are at the end of [protocol.md](protocol.md). Build the frontend with `npm run build`, then run the pilot locally with `npm run pilot:server` (settings: `PILOT_ORIGIN`, `PILOT_PORT`, `PILOT_QUOTA_BYTES`, `PILOT_GOOGLE_CLIENT_ID` with `PILOT_GOOGLE_CLIENT_SECRET` for Google sign-in; `PILOT_DATABASE_URL` with `PILOT_BLOB_ACCOUNT_URL` for durable storage, `PILOT_BACKUP_CONTAINER`, `PILOT_BACKUP_EVERY_HOURS`, `PILOT_BACKUP_KEEP` for database backups (operator command: `node .cache/pilot-server/backup.mjs`); `PILOT_DEV_KEY_FILE` for local development sign-in only). Tests: `npm run test:pilot`, `npm run test:pilot:storage` (needs Docker) and `npm run test:pilot:e2e`.

Real-model cross-device validation has a separate entrypoint, `npm run test:pilot:models`, after model assets are available. The quick pilot browser suite does not stand in for real retrieval or Azure/Google evidence.

CI runs the pilot durable storage, quick browser and real-model browser suites in a separate job, without production Azure/Google credentials, and includes that job in the final checks gate. [PR #35 CI run 42392708779](https://github.com/rajmodi8905/cs437-Last_3_Brain_Cells-hack/actions/runs/42392708779) passed 216 pilot storage tests, 13 browser tests and one actual-model cross-device test alongside the root S1–S15 suites. Physical installed-phone pilot checks, a second genuine IITGN account, outside-group feedback and end-of-pilot export/retention/resource teardown remain follow-ups.
