# Prompt for Nakshatra's AI

After the release-plan/issue-form PR is merged, give Nakshatra this whole prompt. It assigns investigation and reporting, not implementation. The teammate sending it supplies authorization for verified issue publication under their own account.

```text
I am Nakshatra. Help me find and report real defects in Campus Recall. Raj owns all implementation and fixes; do not implement fixes or redesign anything.

Repository: https://github.com/rajmodi8905/cs437-Last_3_Brain_Cells-hack
Start with docs/implementation/nakshatra-quickstart.md. Prepare the checked-in synthetic kit using npm run qa:prepare; it includes library-30.zip, invalid cases, expected.json and a blank run ledger. Manual browser setup downloads are separate from CLI model assets. Laptop testing can start before the physical phone session.
Read the current merged main version of SPEC.md, README.md, docs/implementation/release-plan.md, docs/implementation/acceptance.md, docs/architecture.md and .github/ISSUE_TEMPLATE/bug-report.yml. Follow applicable local instructions. The release plan supersedes my old foundation implementation handoff.

Use current main, not an old personal branch. Inspect git status and preserve all existing work. Fetch main and record the exact tested commit. If the checkout has unrelated changes or cannot safely run main, use a separate fresh clone without overwriting existing folders. Follow the README's Node 24, dependency, browser and model setup. Use a production build for offline/PWA behavior. Do not change production source, dependencies, models, thresholds, expected retrieval answers or SPEC. Temporary reproduction files belong in a disposable local area and must be identified in the report.

My primary focus is:
1. Save all six supported types before model setup; reopen and compare exact originals, metadata and queued/failed/ready visibility.
2. Duplicate titles and duplicate content; rename, type/status filters and recent order; ensure the correct original always opens.
3. Delete queued/processing/ready items. Interrupt/reopen processing and retry failures. Look for lost originals, duplicate jobs/segments or resurrection after deletion.
4. Export a mixed library, restore into a separate profile/device, compare originals/hashes/titles/times/URLs, restore again and inspect duplicate handling. Try malformed archives without risking a real library.
5. Corrupt/encrypted/unsupported/over-limit files and recoverable storage errors. Use only synthetic data in disposable profiles for quota/destructive experiments. Never call a quota test passed if I could not induce the condition.
6. Actual OCR/PDF page mapping, text paraphrases, visual-only images, speech/media intervals, silent video and weak/unrelated queries. Compare against independently recorded originals and locations. Existing corpus passes are consumed regression evidence, not general accuracy.
7. On available physical reference phones, measure agreed small S8 image/PDF fixtures against the 120-second target. Record exact device/OS/browser, fixture bytes, cold/warm state, model backend and elapsed time. Ask me to perform phone actions you cannot access; otherwise mark the scenario blocked or not run.

You may investigate other observed problems too. Do not manufacture issues to meet a quota. Keep one dated ledger of pass/fail/blocked/not-run scenarios, tested SHA, environment, fixtures, actual evidence and issue links. Note when a restart/new profile/setup download changes the preconditions.

For a candidate defect, reproduce where feasible, identify its SPEC ID, and search open/closed issues for duplicates. Distinguish observed runtime behavior from an automated test failure or an unverified static-code concern. A static concern needs exact file/line reasoning and must not pretend execution occurred. Record expected/actual behavior and occurrence count; unknown measurements stay unknown. New features are suggestions, not bugs.

I authorize opening verified, nonduplicate issues in this repository under my own verified GitHub account. Verify the active publishing identity belongs to me, not Raj or another user. If it does not, prepare the issue text and report the account mismatch instead of publishing. If the issue already exists, report its link in the ledger rather than posting a duplicate comment. Use the GitHub Bug report form; if publishing through CLI/API, use the same field headings and content. Do not submit an empty or knowingly incomplete observed-bug report. Clearly label static concerns as unverified.

Include the tested SHA/build URL, device/OS/browser, browser versus installed mode, network/cache state, synthetic fixtures, numbered reproduction steps, expected/actual result, frequency, impact and sanitized evidence. Never upload private chats, documents, exports, identifiers or credentials. Review evidence for privacy before publishing. Use one issue per defect. Severity is a proposal supported by actual impact.

For each Raj fix supplied for retest, run the original reproduction on the named candidate and then merged main when available. Record the exact commit and result; do not assume an issue is fixed because it was closed. Do not close issues, stage, commit, push, approve/merge PRs, deploy, or send messages to others under this prompt. Report findings to me with issue links and untested areas. Record AI use truthfully in the course-required notes, without claiming human/device work that did not happen.
```
