# Separate one-month deployment pilot

Status 6 November 2026: pilot implementation and container packaging are complete locally; the [Azure app](https://campusrecall.indiasouthcentral.cloudapp.azure.com) is live. Real Google sign-in with the owner’s IITGN account, hosted recovery and PWA browser checks passed. See the [release record](2026-11-06-release.md) and [7 November owner phone check and publication scope](2026-11-07-phone-check.md). The completed 3 November submission and its S1–S15 evidence remain separate and unchanged.

Export deadline and compute cutoff: **6 December 2026, 17:47 IST (12:17 UTC)**. Users can export cloud originals and metadata through Settings. See the [deployment runbook](deployment.md), [pilot privacy policy](privacy-policy.md) and [terms](terms-and-conditions.md).

Read in this order:

1. [Implementation plan, dependencies, user flows and access](2026-11-04-implementation-plan.md) — original ordered plan; dated implementation records and the deployment runbook describe executed work.
2. [Confirmed one-month scope](2026-11-04-one-month-scope.md) — local-only/account auto-sync, Azure storage, local processing/search, selective offline downloads.
3. [Earlier INSIIT and hosting options](../implementation/2026-11-04-insiit-sync-options.md) — research/history; later confirmed decisions above supersede unresolved choices and narrower initial-slice proposals.

5 November: sign-in is Google-based and run by the pilot server itself (no Firebase), independent of INSIIT (INSIIT integration is future scope); Phase 0 and 1 started on branch `pilot/auto-sync`. See the plan's "Decisions on 5 November".

Private account storage is selected; E2EE/native clients/cloud inference are outside this pilot. The one-time model download is accepted. Actual provisioned resources, source identities, tests and pilot dates must be recorded as work proceeds; none are implied by this index. No automatic deployment or resource creation follows from reading the plan.

Progress, 6 November: Phases 0 to 7 are implemented locally on `pilot/auto-sync`, with PostgreSQL and Azure Blob storage (in-memory only for local development); the implementation status and what is not yet verified are at the end of [protocol.md](protocol.md). Run the pilot locally with `npm run pilot:server` (settings: `PILOT_ORIGIN`, `PILOT_PORT`, `PILOT_QUOTA_BYTES`, `PILOT_GOOGLE_CLIENT_ID` with `PILOT_GOOGLE_CLIENT_SECRET` for Google sign-in; `PILOT_DATABASE_URL` with `PILOT_BLOB_ACCOUNT_URL` for durable storage, `PILOT_BACKUP_CONTAINER`, `PILOT_BACKUP_EVERY_HOURS`, `PILOT_BACKUP_KEEP` for database backups (operator command: `node .cache/pilot-server/backup.mjs`); `PILOT_DEV_KEY_FILE` for local development sign-in only). Tests: `npm run test:pilot`, `npm run test:pilot:storage` (needs Docker) and `npm run test:pilot:e2e`.

Real-model cross-device validation has a separate entrypoint, `npm run test:pilot:models`, after model assets are available. The quick pilot browser suite does not stand in for real retrieval or Azure/Google evidence.

CI runs the pilot durable storage, quick browser and real-model browser suites in a separate job, without production Azure/Google credentials, and includes that job in the final checks gate.
