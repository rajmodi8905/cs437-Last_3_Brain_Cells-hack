# AnyRecall regression reference

**Current baseline:** S1–S15 acceptance checks pass. Implementation and verification are complete; deployment is the release phase described in the [release status](../implementation/release-plan.md). See [current results](../verification/README.md) for executed outcomes and source identities.

This is a reusable regression reference for future changes. The rows define behavior to preserve; they are not an unexecuted release checklist.

| SPEC | Regression behavior |
| --- | --- |
| S1 | Save supported originals before models; retain exact bytes and metadata across reopen; storage failure creates no successful save. |
| S2 | Filter/order/rename without changing identity or original content. |
| S3 | Delete original and related records; reject late/stale publication. |
| S4 | Capture permitted public text or use an inert manual fallback; never execute imported HTML. |
| S5 | Open the exact saved source with correct page/time provenance; never substitute a different original. |
| S6 | Preserve original bytes, hashes and metadata through export/restore; report duplicates and queue new originals. |
| S7 | Verify explicit setup assets; expose repair for damaged/missing assets. |
| S8 | Extract supported image/PDF text locally with page provenance and preserved originals on failure. |
| S9 | Retrieve frozen text targets and reject fixed weak/unrelated queries. |
| S10 | Retrieve text-free images and sampled video scenes through actual visual embeddings. |
| S11 | Retrieve supported English speech with source media intervals; retain silent-video visual search. |
| S12 | Recover/retry a current generation without duplicate or stale publication. |
| S13 | Preserve responsive controls, installation, offline shell and originals through updates. |
| S14 | Keep core processing/search local after setup; separate explicit external requests. |
| S15 | Provide readable pre-setup/direct/offline policies consistent with implemented facts. |

Future regression runs record actual source SHA, environment, action, observed outcome and supporting evidence. Their results do not retroactively alter earlier execution records. A template is not a claim that a future run has already happened.

The [22 October foundation handoff](../verification/history/chaitanya-foundation-2026-10-22.md) preserves the original foundation-only review and blank manual scenarios. Those findings describe the earlier scaffold rather than the completed application.
