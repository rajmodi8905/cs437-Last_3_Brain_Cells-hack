# Team implementation handoffs

**Current assignments, 28 October 2026:** use [the completion and release plan](release-plan.md). Raj implements all further changes. Nakshatra and Chaitanya find/report bugs and retest fixes; they do not implement their old packages again. Copy-ready AI prompts: [Nakshatra](bug-hunt-nakshatra.md), [Chaitanya](bug-hunt-chaitanya.md). File reports with [the GitHub issue form](../../.github/ISSUE_TEMPLATE/bug-report.yml), available in New issue after it is merged into the default branch.

Current integration, 23 October 2026: Nakshatra’s and Chaitanya’s packages are merged. Raj explicitly requested completing integration on `raj_final` from current `main`, preserving `Raj_setup`. The original member-branch instructions below describe the earlier handoff. Current evidence and release checks are in [verification](../verification/README.md).

Status: the original planning handoffs below are retained for ownership and contract history. The foundation, support documents and Raj’s integration now exist. Use the repository code, current README and verification report for implemented behavior and actual test results.

## Read order

For the current bug-finding round, begin with your executable quickstart: [Nakshatra](nakshatra-quickstart.md) or [Chaitanya](chaitanya-quickstart.md), then use the release plan and your named prompt below.

1. Applicable local/repository instructions.
2. [Current release plan](release-plan.md), then the [historical implementation plan](../../IMPLEMENTATION_PLAN.md) for product context.
3. [SPEC.md](../../SPEC.md).
4. [Shared contracts](contracts.md).
5. [Acceptance design](acceptance.md).
6. Your package: [Nakshatra](nakshatra.md), [Chaitanya](chaitanya.md), or [Raj](raj.md).

## Start only after the planning PR is merged

The plan is published through `plan_setup` into `main` with reviews. Every member then fetches the current repository and bases their branch on merged `origin/main`. Preserve unrelated files; never use a destructive reset/clean to obtain a clean tree.

New member branch, after inspecting status:

```bash
git fetch origin
git switch -c Nakshatra_setup origin/main
```

For Chaitanya, substitute `Chaitanya_setup`. If the branch already exists, inspect it and its upstream instead of recreating it. Incorporate `origin/main` through a normal fast-forward or merge. Do not overwrite the branch or its history.

After commit/publication approval, the first push names the personal branch explicitly, for example `git push --set-upstream origin Nakshatra_setup`. Do not use a push refspec targeting `main`. Set the PR base to `main` and its head to the personal branch.

Raj retains the existing `Raj_setup` and incorporates current `origin/main` normally. Production merge order: Nakshatra → Chaitanya → Raj. The existing repository branch spelling is case-sensitive on GitHub; do not introduce a second branch differing only by case.

## Work ownership

- Nakshatra: scaffold/contracts, persistence, backup/restore, and storage tests. No product UI or AI implementation.
- Chaitanya: policy content, user guide, and verification checklists in `docs/product/`. No components, screens, viewers, routing, PWA integration, or AI implementation.
- Raj: all core UI/UX, viewers, routes, rendered policy pages, PWA behavior, models/embeddings/OCR/speech, retrieval, and final integration. The Emil design/mobile skills apply to Raj's UI package.

Raj can work independently on UI/engine contracts after the plan merges. The runtime depends on Nakshatra's repository; policy-page content depends on Chaitanya's reviewed documents. There is no dependency on a teammate-built interface.

## Historical implementation prompt

Do not use this earlier implementation prompt for the current release bug-finding phase. Use the named bug-finding prompts linked above.

> Read the implementation plan, shared contracts, acceptance design, and my named handoff. Implement only my package on my specified branch after the prerequisite planning/foundation PRs have merged. Preserve existing work. Add meaningful tests before features, run the package checks, and report actual results. Do not substitute mocks for retrieval evidence or silently change contracts. Ask me before staging/committing and obtain publication authorization before unapproved pushes or deployment. Prepare the work and a PR description for review. Do not bypass branch protection or merge without authorization.

## Publication checklist

- Only the approved package's changes are included.
- No local `context.md`, credentials, downloaded model weights, caches, or unrelated research drafts.
- Relevant SPEC IDs, initial test failures, final checks, and remaining limitations are stated.
- Contract changes are agreed and documented before dependent code uses them.
- Required other-member reviews are obtained before merge.
- AI use is recorded in the course lab notes.

App-wide commands are implemented and documented in the root README. Full acceptance requires the explicit model/browser setup described there; a handoff document alone is not evidence of a passing test.
