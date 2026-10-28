# Chaitanya: policy content, user documentation, and review checklists

**Historical implementation handoff.** For the current release phase, use [the release plan](release-plan.md) and [Chaitanya's bug-finding prompt](bug-hunt-chaitanya.md). Chaitanya now finds/reports defects and retests fixes; Raj implements all further changes, including policy corrections. Do not restart this old package.

Branch: `Chaitanya_setup`. Read [team instructions](README.md), [plan](../../IMPLEMENTATION_PLAN.md), [SPEC](../../SPEC.md), [contracts](contracts.md), and [acceptance design](acceptance.md). Start drafting after the planning PR merges; use Nakshatra's merged foundation to verify available setup instructions. Ask before staging/committing.

## Goal and ownership

Deliver accurate content and repeatable verification instructions that Raj can integrate into the application. Own Markdown content in `docs/product/`. Raj owns the entire product UI/UX, components, screens, viewers, routing, PWA integration, and all AI/embeddings. Nakshatra owns foundation/storage.

Do not edit `src/ui/`, `src/app/`, `src/engine/`, service workers, styles, manifests, or application routing. Do not build page components for the policies. Your handoff is content, not a visual design or a competing runtime implementation.

## Deliverables

Create these four content documents in your implementation PR, not in the current planning PR:

| File | Content |
| --- | --- |
| `docs/product/privacy-policy.md` | Project-specific Privacy Policy draft |
| `docs/product/terms-and-conditions.md` | Project-specific Terms and Conditions draft |
| `docs/product/user-guide.md` | Save/search/source/backup guidance and tested troubleshooting |
| `docs/product/verification-checklist.md` | Repeatable manual review scenarios and evidence template |

Use ordinary Markdown with clear headings. Raj will render the reviewed policy content at `#/privacy` and `#/terms` and connect it to Settings/first use. Raj implements direct reload/offline behavior, styling, accessibility, and page tests.

## Checkpoint 1: factual policy drafts

Privacy Policy must explain:

- Local originals, extracted text, transcripts, embeddings, and browser storage.
- No content/query uploads for inference and no app advertising/analytics.
- Explicit initial model/runtime downloads and their actual hosts.
- Explicit website requests when capturing or opening a URL.
- Static hosting request logs where applicable to the selected deployment.
- Deletion, manual unencrypted export, restore, and separate device libraries.
- Browser eviction, cleared storage, and browser/OS behavior outside app control.
- Policy version and actual publication/update date once published.

Terms and Conditions must explain:

- The student project without suggesting official IITGN endorsement.
- Intended personal retrieval use and responsibility for imported material.
- User ownership, extraction/transcription/ranking errors, and checking originals.
- Device storage/backups, third-party websites and open-source components.
- Project updates and reporting problems through [the project repository](https://github.com/rajmodi8905/cs437-Last_3_Brain_Cells-hack).

Do not invent a company, email, address, jurisdiction clause, legal certification, release date, institutional endorsement, or enforceability guarantee. Do not claim at-rest encryption, OS backup exclusion, “nothing ever leaves your device”, or “100% secure”. No generic marketing copy, fake testimonials/metrics, or em dashes in product-authored policy copy. Do not alter interview quotes or imported user text to apply a copy rule.

While the application is incomplete, mark documents Draft and distinguish planned behavior from verified implementation in a separate review note. Do not describe unimplemented features as tested. Before release, Raj reviews the content against actual requests, storage, permissions, and deletion/export behavior and sets the actual effective date. Policy text is not privacy-test evidence.

## Checkpoint 2: user guide

Write concrete instructions covering:

1. Supported formats, sizes, durations, and conversion guidance.
2. Saving files/notes and the direct-webpage/manual-content fallback.
3. The distinction between Saved locally, Queued, Processing, Ready, and Failed.
4. Explicit model download, real progress, and offline readiness.
5. Descriptive queries, result previews/excerpts, PDF pages, and media timestamps.
6. Separate local device libraries and manual archive transfer.
7. Retry, missing sources, storage/quota issues, and cache repair.
8. Browser data retention and why a manual backup matters.

Use the published contracts and actual foundation README. Commands or UI steps not yet available are pending, not reported as verified. Do not independently change the app's labels, interaction design, dependency versions, or core README setup contract. Send discrepancies to the relevant owner.

## Checkpoint 3: verification checklist

Provide exact actions, expected outcomes, and evidence fields for another person to run after Raj integrates the product:

- Save, restart, recent items, rename/filter/delete, and storage failures.
- Query by remembered meaning and open the correct original, page, or timestamp.
- Failed processing/retry, incomplete setup, no results, and missing sources.
- Manual export/import and separate libraries on different devices.
- Direct policy-route reload, before-setup access, and cached offline access.
- Phone keyboard open, landscape, zoom, safe areas, and long filenames.
- The plan's prohibited UI/copy patterns, reviewed without changing interface code.

Record tested commit, device/OS/browser, date, steps, expected/actual result, and screenshots where appropriate. Leave unperformed checks explicitly untested. Separate automated checks, emulation, and real hardware; do not fabricate measurements or screenshots. Raj owns automated UI/engine acceptance tests and the final release evidence.

## Checks and handoff

Validate your Markdown links, factual consistency, draft status, absence of placeholders/invented contact details, and policy coverage. Where the foundation runs, report actual command checks; do not claim application tests pass when the engine/UI is absent.

Handoff to Raj includes the four content files, a short factual-claims review, unresolved questions grounded in actual implementation, and an unfilled or honestly recorded verification checklist. No page layout or UI components are required. Prepare a focused content-only PR after approval; obtain required reviews and merge authorization before Raj's final production PRs.

Do not implement UI/UX, original viewers, PWA behavior, models, OCR, embeddings, transcription, ranking, or storage. Reviewing another member's PR is allowed; writing their runtime package is outside this handoff.
