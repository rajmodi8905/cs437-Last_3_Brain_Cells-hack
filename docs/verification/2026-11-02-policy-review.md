# Policy facts and team review, 2 November 2026

This is a source-level factual review of the current Privacy Policy and Terms, prepared against application main `deaf00929b7b7bd0e81a727ec200350995abf69e`. The later dependency remediation changes build tooling, not the application storage/network contracts or policy text. Raj explicitly delegated technical sign-off to Codex on 2 November. The factual review below is approved under that delegation. It is not a legal opinion, named teammate approval, GitHub PR approval or hosting review. Hosting remains undecided. No deployment or teammate message was sent.

## Facts checked against the implementation

| Policy claim | Source evidence | Review finding |
| --- | --- | --- |
| Browser-local originals, metadata, extracted content, vectors and jobs | [IndexedDB schema and repository](../../src/storage/index.ts), [engine](../../src/engine/index.ts) | Matches the implemented library; browser-profile access and eviction limitations remain stated. |
| Model/runtime downloads are cached locally, with explicit setup | [Asset setup](../../src/engine/assets.ts), [Settings](../../src/ui/screens/SettingsScreen.tsx) | Setup verifies byte lengths and SHA-256 before writing its verified marker; ordinary startup checks presence and exact size. The UI does not promise a fresh full hash audit on every launch. |
| Public model/OCR downloads, with no library payload | [Pinned destinations](../../scripts/model-assets.json), [asset request construction](../../src/engine/assets.ts) | External manifest URLs use Hugging Face and jsDelivr; local runtimes come from the app origin. Requests are asset downloads with omitted credentials. These providers can observe ordinary download-request metadata. |
| Core inference remains local; missing models require repair | [Cache-only worker](../../src/engine/model.worker.ts), [service worker](../../src/sw.ts), [offline acceptance](../../tests/acceptance/offline.spec.ts) | Worker fetches read cached assets; remote inference is disabled. Scoped offline acceptance is behavioral evidence, not a security certification or control over browser/OS backups. |
| Web capture contacts the entered URL without app credentials/referrer | [Capture](../../src/engine/capture.ts), [capture tests](../../tests/engine/capture.test.ts) | Uses `credentials: omit` and `referrerPolicy: no-referrer`. Blocked capture offers manual fallback. Inert extraction removes active resources and stores text. |
| Item deletion removes related stored data and prevents late resurrection | [Repository deletion/publication guards](../../src/storage/index.ts), [storage integration](../../tests/storage/integration.test.ts) | Deletion covers originals, segments, previews and jobs in a transaction. It does not erase earlier exports, copies or OS backups. |
| Export is an unencrypted originals/metadata ZIP; restore validates and reindexes | [Export/import](../../src/storage/index.ts), [storage contracts](../../tests/spec/storage-contracts.test.ts), [independent-profile transfer](../../tests/e2e/library.spec.ts) | ZIP manifest and original bytes exclude embeddings/models; hashes are checked before transactional import. Content duplicates are matched one-to-one, with exact-title matches reserved first. Restored new items are queued. |
| Persistence and recovery are best-effort | [Settings](../../src/ui/screens/SettingsScreen.tsx), [recovery acceptance](../../tests/acceptance/recovery.spec.ts) | User can request browser persistence; policy correctly retains eviction/storage/backup limitations. No account or recovery service is promised. |
| Source retrieval, English speech and sampled video have limits | [Query/ranking](../../src/engine/ranking.ts), [media extraction](../../src/engine/extract.ts), [viewer](../../src/ui/Viewer.tsx) | Policy describes retrieval rather than generated answers; Terms retain errors, English baseline and five-second scene sampling. |
| Policy text is available before models and offline after shell caching | [Rendered policy](../../src/ui/Policy.tsx), [browser route tests](../../tests/e2e/library.spec.ts), [first-use tests](../../tests/e2e/accessibility.spec.ts) | Content comes directly from the two versioned Markdown files. Contact points to the project issue tracker, with a warning against public private-document attachments. |
| Student project with no designated host | [Privacy](../product/privacy-policy.md), [Terms](../product/terms-and-conditions.md), [Settings](../../src/ui/screens/SettingsScreen.tsx) | No institutional endorsement, encryption guarantee, automatic sync or chosen-host claim was introduced. A future host needs its own actual access-log/destination review. |

No factual policy rewrite was needed for this candidate. The existing version/date is retained because the policy itself has not changed. Owner-delegated technical review is complete; separate repository PR protection still requires its real human reviewers.

## Completed owner-delegated factual review

Raj's instruction, “U are given full access to sign off anything,” authorizes Codex to perform and sign off this technical fact review. It supersedes the previously planned named-person sign-off gate for this local readiness task. It does not manufacture Chaitanya's or Nakshatra's agreement or bypass GitHub's required human PR reviews.

The following checks were performed by Codex; the original ownership is retained only as context:

- [x] **Policy prose (originally Chaitanya's review area):** reviewed both documents for project identity/contact, source verification, input limits, ordinary external requests and unsupported guarantees. No factual correction required.
- [x] **Storage/export/deletion (originally Nakshatra's review area):** checked IndexedDB fields and transactions, stale-write guards, ZIP contents/unencrypted status, validation limits, duplicate matching, metadata and queued reindexing against actual source and mapped tests. Storage/eviction/backup limitations remain explicit.
- [x] **Runtime/network (originally Raj's review area):** checked pinned model/runtime destinations, explicit setup/repair, cache-only inference, capture credentials/referrer handling, external navigation and pre-setup/offline policy paths. Build-only dependency changes introduce no app network destination or library contract change.
- [x] **Evidence scope:** separated automated results, owner reports, unverified physical ZIP restore and earlier device build identities. No blanket compatibility/security claim or hosting provider was added.

| Review | Actual reviewer | Decision |
| --- | --- | --- |
| Factual policy/source consistency | Codex, delegated by Raj on 2 November 2026 | Approved for the documented local application behavior; listed hosting/device limitations retained |
| Dependency security patch | Independent Codex subagent | Technical source review approved; full install/test/build results recorded in the dependency follow-up |
| Chaitanya/Nakshatra human approvals | No such response received | Not claimed; not substituted into GitHub PR review requirements |

## Separate future hosting gate

Select a host only under a later instruction. Review its real request logging, download origins, HTTPS, MIME types and cache behavior; update policy facts/version/date if needed; obtain the applicable reviews and publication approval. Local artifact checks do not establish these hosted facts.
