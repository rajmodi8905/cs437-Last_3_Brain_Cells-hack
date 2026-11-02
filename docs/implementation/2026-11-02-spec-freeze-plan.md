# Campus Recall: final readiness plan

**Prepared:** 2 November 2026, Asia/Kolkata

**Target:** 3 November specification freeze, per the recorded course checkpoint

**Status:** Raj authorized local execution on 2 November 2026, excluding deployment. All planned local verification completed successfully; see the [checkpoint results](../verification/2026-11-03-spec-freeze.md). Owner-delegated [policy fact review](../verification/2026-11-02-policy-review.md) and independently reviewed [dependency remediation](../verification/2026-11-02-dependency-remediation.md) are complete. This does not claim named teammate or human GitHub PR approvals. Later commits/publication still require their applicable authorization.

## 1. Goal and boundaries

Prepare a reviewable local release candidate from reviewed, merged main. The planning baseline is `deaf00929b7b7bd0e81a727ec200350995abf69e`, containing PRs #24 and #25. Reconfirm the actual main SHA when execution is approved.

- Leave hosting undecided. Do not deploy, change hosting settings or dispatch release workflows.
- Treat phone validation as complete for planning. Preserve actual measurements and owner-confirmed results; keep unverified checks, including the phone ZIP restore, explicitly unverified. Do not restart phone testing under this plan.
- Preserve existing work, libraries, historical results and private handovers. Keep WebKit investigation outside this work.
- No public API, storage schema, model, threshold, index or product-scope change is planned.

## 2. Final verification, after approval

1. Confirm the current main commit, completed CI outcome and any open defects. Record one candidate SHA for the round.
2. Create an isolated fresh checkout at that SHA, without copying existing dependencies or model caches. An existing machine/browser installation is not a new operating-system or physical-laptop claim.
3. Follow the README's installation and startup instructions. Verify a meaningful first screen and working controls, stop the temporary server, and record any undocumented prerequisite.
4. Use Node 24 and the pinned lockfile. Run:

   ```bash
   npm ci
   npx playwright install chromium
   npm run models:download
   npm run check
   npm run format:check
   npm run build
   npm test
   npm run release:check
   ```

   On Linux, install Chromium with `--with-deps`. Preserve command outcomes, failures/skips, environment and source identities. Do not count the coverage-registry check as behavioral evidence.

5. Preserve the root artifact and its identity before building the repository-subdirectory configuration:

   ```bash
   APP_BASE=/cs437-Last_3_Brain_Cells-hack/ npm run build
   npm run release:check -- dist /cs437-Last_3_Brain_Cells-hack/
   ```

   This tests existing subdirectory support; it does not select a hosting provider. Retain both inventories/hashes and exclude QA files, certificates, model weights and test harnesses from release artifacts.

6. If a required check fails, reproduce it, add a meaningful regression when appropriate and fix the existing promised behavior. Rerun affected checks and the final candidate suite after relevant source changes. Ask before changing scope, contracts, models, thresholds or acceptance expectations.

## 3. Evidence and policy review

- Produce `docs/verification/2026-11-03-spec-freeze.md` with an S1-S15 table: requirement, test references, candidate SHA, actual automated outcome, manual evidence, evidence limitations and unresolved gates. Retain raw logs outside public source and link only sanitized supporting artifacts.
- Keep automated results, owner reports and planning assumptions separate. Preserve earlier failures and the consumed-corpus limitation; do not claim general retrieval accuracy from fixed regression queries.
- Use the independent-profile export/restore tests for automated S6 coverage. They do not verify the missing physical phone archive. Keep phone transfer unverified unless actual evidence becomes available under separately authorized work.
- Compare Privacy and Terms with implemented storage, setup downloads, capture, deletion, exports, external links and project contact information. Preserve the truthful statement that no hosting provider has been designated. Re-review hosting facts after a later host decision.
- Prepare the factual review checklist for Raj, Chaitanya and Nakshatra: Chaitanya reviews policy prose, Nakshatra reviews storage/export/delete claims, and Raj reviews application behavior and network destinations. Record approvals only when received. Do not message teammates automatically.
- Update stale coverage/report summaries only where supported by the collected evidence. Do not remove an unresolved gate to make the checklist green.

## 4. Deliverables and approval gates

Deliver the fresh-checkout command results, S1-S15 evidence table, policy-review checklist, root/subdirectory artifact hashes, source commit, rollback reference and a concise freeze recommendation with any remaining blockers.

Declare the specification ready to freeze only when its requirements have sufficient passing evidence and policy review is complete. Otherwise, report the exact outstanding gates without weakening the specification or backdating results. No public or hosted release is included.

**Approval sequence:** Raj explicitly approves starting this plan; local execution produces concrete reviewable results; staging, commits, pushes, PR publication and merge then require their applicable later authorization and required human reviews. The separate authorization to commit this plan and update the README applies only to those documentation changes.
