# AnyRecall release status

**3 November 2026: implementation and acceptance verification are complete. Deployment is the remaining release phase.**

All S1–S15 acceptance checks pass. The required suite records 90 fast, 27 production Chromium and 11 actual-model passes; source/policy review, dependency remediation and root/subdirectory artifact verification are complete. [Current verification](../verification/README.md) is the status reference.

## Completed product baseline

- Local save, original retention, browse/filter/rename and deletion invariants.
- Safe webpage capture/fallback and exact original, PDF-page and media-interval opening.
- Verified model setup, local OCR/PDF/speech/visual processing and offline retrieval.
- Archive transfer, interrupted processing/retry and stale-generation protection.
- Responsive installed-PWA controls, offline shell, policy routes and update preservation.
- Privacy/source fact review and reviewed build-dependency remediation.

The [executed readiness plan](2026-11-02-spec-freeze-plan.md) and [verification results](../verification/README.md) contain the evidence. Device results retain measured/owner-confirmed methods and build identities; automated transfer is verified using exact bytes and independent profiles.

## Deployment phase

1. Choose and authorize the static host and stable origin/base path.
2. Review the actual host's logging/policy facts and record the published policy version where applicable.
3. Publish only the verified production artifact through the reviewed release workflow.
4. Validate hosted HTTPS, worker/module MIME types, routing, cache/install/update behavior and same-origin persistence.
5. Record actual outside-group usage and rollout feedback.

Deployment is not triggered by updating this document. The manual workflow retains its explicit publication control and protected review process. [Deployment instructions](deployment.md) cover execution and rollback.

## Continued maintenance

Future fixes, CI/reporting improvements and additional reliability cases use independent reviewed PRs and meaningful checkpoint commits. They improve the completed baseline; they do not imply an unfinished current SPEC statement. Required human PR reviews remain in force.

The [28 October execution plan](history/release-plan-2026-10-28.md) retains the original assignments, test sequence and then-open steps as historical context. Do not restart those completed packages from that older plan.
