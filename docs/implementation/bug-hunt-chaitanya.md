# Prompt for Chaitanya's AI

After the release-plan/issue-form PR is merged, give Chaitanya this whole prompt. It assigns investigation and reporting, not implementation. The teammate sending it supplies authorization for verified issue publication under their own account.

```text
I am Chaitanya. Help me find and report real defects in Campus Recall. Raj owns all implementation, important UI work and fixes; do not implement fixes, edit policies or redesign anything.

Repository: https://github.com/rajmodi8905/cs437-Last_3_Brain_Cells-hack
Use docs/implementation/nakshatra-quickstart.md for the shared production preview and synthetic test kit. Follow my own focus areas below; Raj implements all fixes.
Read the current merged main version of SPEC.md, README.md, docs/implementation/release-plan.md, docs/implementation/acceptance.md, docs/architecture.md and .github/ISSUE_TEMPLATE/bug-report.yml. Read docs/product/privacy-policy.md and docs/product/terms-and-conditions.md for the policy review. Follow applicable local instructions. The release plan supersedes my old content implementation handoff.

Use current main, not an old personal branch. Inspect git status and preserve existing work. Fetch main and record the exact tested commit. If the checkout has unrelated changes or cannot safely run main, use a separate fresh clone without overwriting existing folders. Follow README setup with Node 24 and the actual dependencies/models. Use a production build for offline/PWA checks; a development server is not enough. Do not modify source, dependencies, fixtures, models, thresholds, policies or SPEC. No invented passes, screenshots, device versions or measurements.

My primary focus is:
1. First use, saving before model setup, understandable queued/failed/ready feedback, actual setup progress, repeated download clicks, interrupted setup and missing-asset repair.
2. Library, Search, Add, Settings, Privacy and Terms; widths 390/768/1440; empty/loading/error states; long filenames/titles; keyboard focus, Escape/close, reduced motion and readable controls.
3. Real iPhone/Android touch, keyboard-open forms, portrait/landscape, safe areas, pinch zoom, installation, file selection, audio/video controls and offline reopening. Browser emulation is separate evidence. Ask me for physical actions when needed and leave unavailable-device checks blocked/not run.
4. Duplicate-title search results, exact saved originals, unavailable-source behavior, PDF matching pages and media seek locations. A generated-looking result must not substitute for the actual source.
5. Allowed public webpage capture, blocked fetch and manual-text fallback, inert HTML import and visible truncation. CORS restrictions are expected; a broken or misleading fallback is reportable.
6. Safari/browser versus installed PWA, setup/cache behavior, interrupted foreground/background sessions, direct routes, update notifications and preservation of saved originals across updates. Do not assume a new origin or installed app shares a previous cache/library.
7. Policy links before setup and offline, and factual agreement with actual host requests, local storage, model download hosts, export/delete and lack of accounts/analytics. Report discrepancies; do not silently rewrite text. Unknown host facts stay unresolved.
8. UI/copy restrictions: no purple/decorative gradients, pill buttons, fake metrics/reviews/counters, vague marketing, emoji icons, authored em dashes, AI stock imagery, cursor effects or decorative scroll animations. Preserve imported/quoted source content. Check accessible labels, contrast, focus and mobile touch targets. After the revamp, record Before | After | Why for actual findings.

You may investigate other observed problems too. Do not manufacture issues to meet a quota. Keep a dated ledger of pass/fail/blocked/not-run scenarios, SHA, environment, actual evidence and issue links. An empty automated accessibility report is not proof of complete accessibility or physical-phone correctness.

For a candidate defect, reproduce where feasible, identify its SPEC ID, and search open/closed issues for duplicates. Distinguish observed runtime behavior, reproduced automated failure and an unverified static-code concern. Static concerns need exact file/line reasoning and must not pretend execution occurred. A visual preference or new feature is a suggestion unless it violates a requirement or causes an observed usability failure.

I authorize opening verified, nonduplicate issues in this repository under my own verified GitHub account. Verify the active publishing identity belongs to me, not Raj or another user. If it does not, prepare the issue text and report the mismatch instead of publishing. If an issue exists, report its link in the ledger rather than posting a duplicate comment. Use the GitHub Bug report form; CLI/API reports must use the same field headings and content. Clearly label static concerns as unverified.

Include the exact SHA/build URL, device/OS/browser, browser versus installed mode, network/cache/model state, synthetic fixtures, numbered steps, expected/actual behavior, frequency, impact and sanitized evidence. Do not attach private chats/files/exports or credentials. Review screenshots/logs for privacy before publishing. One defect per issue, with a proposed severity grounded in actual impact.

Retest each supplied Raj fix using the original environment/steps on the named candidate and merged main when available. Repeat affected scenarios after the UI revamp. Record exact commits and actual outcomes; a closed issue alone proves nothing. Do not close issues, stage, commit, push, approve/merge PRs, deploy or message others under this prompt. Finish with findings, issue links, important usability observations and untested areas. Record AI use truthfully in course-required notes.
```
