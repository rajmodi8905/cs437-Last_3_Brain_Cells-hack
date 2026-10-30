# AI-assisted development notes

## Release integration and Android preparation, 31 October 2026

At Raj's request, Codex preserved the local working files and updated `raj_all_fixes` normally to Chaitanya's merged main. The pending landing accessibility fixes and earlier device/release tooling were reconciled without conflicts. The assistant prepared Android Chrome/installed-app steps for the confirmed iQOO Neo9 Pro and ran the combined candidate's validation. [The dated checkpoint](verification/2026-10-31-integration.md) records actual results and remaining gates. Nakshatra's still-open PR was not treated as merged or modified. Existing iPhone evidence was retained; no new iOS/Android result, WebKit rerun, human approval or deployment is claimed.

## Local device-session preparation, 28 October 2026

Raj requested starting the remaining 28 October work on a new branch while teammates find bugs, then chose to connect the iPhone after preparation. Codex created `raj_oct28_device_setup` from merged main and added the identified production snapshot, synthetic download bundle, temporary local HTTPS preparation/verification, owner runbook and physical-test record. Tests were added before implementation. A certificate-chain failure was corrected before preparing the retained bundle; all five new integration cases and 67 fast tests passed. An isolated laptop browser verified HTTPS save/reload/offline exact-source/policy behavior, with process-local TLS handling and a separate strict CA client check. [Evidence](verification/2026-10-28-device-preparation.md) distinguishes those checks from unperformed phone work. No private library was read, no device trust was changed, no speculative bug report was filed and no commit/deployment was performed for this task.

## Chaitanya's testing prerequisites, 28 October 2026

Raj requested the same complete testing handoff for Chaitanya. Codex reused PR #8's common kit on a separate branch, added the focused quickstart/prompt, UI boundary/source-content inputs, an unfilled C1–C15 ledger and a loopback-only synthetic webpage helper. New tests first recorded the missing prerequisite failures; subsequent checks passed 62 fast and eleven production browser cases. An initial browser locator incorrectly expected an old captured title; the test was corrected to explicitly name the manual fallback and the full rerun passed. [Handoff evidence](verification/2026-10-28-chaitanya-handoff.md) records results and limits. Chaitanya retains bug discovery/reporting/retests; Raj retains all implementation. No phone result, new model-accuracy claim, teammate message or deployment was fabricated.

## Nakshatra's testing prerequisites, 28 October 2026

Raj authorized completing the bug-finding handoff and opening its PR. Codex added a synthetic QA-kit generator, existing-certificate HTTPS preview command and executable tester quickstart alongside the pending release plan/prompts/issue form. Regression tests were added before the generator; the initial suite failed setup for the absent script, then eight actual storage/toolkit cases passed. Full fast checks passed 58 tests; production browser checks passed nine cases, including the generated kit's real import/view/duplicate/rejection flow. A local TLS transport smoke used an explicitly trusted test certificate in one Python client without changing device trust. Actual commands and limits are recorded in [handoff verification](verification/2026-10-28-qa-handoff.md). No exploratory bug hunt was assigned to Raj, no teammate was messaged and no phone/semantic accuracy result was invented.

## Release planning and issue intake, 28 October 2026

Raj requested a complete release plan with all further implementation assigned to him and all exploratory bug finding/reporting assigned to Nakshatra and Chaitanya. Codex wrote the [release plan](implementation/release-plan.md), separate copy-ready prompts and a repository GitHub issue form. Earlier handoffs now point to the current assignments so an AI does not restart the completed packages. The assistant checked local document links and issue-form YAML structure/formatting. No new bug findings, phone results, runtime test passes, GitHub form rendering or deployment are claimed by this documentation work.

## October checkpoint audit and setup repair, 26 October 2026

Raj asked Codex to complete the earlier specification/test artifacts and the 27 October checkpoint, authorizing a commit and PR. The assistant checked dated Git history, actual GitHub reviews and completed main CI rather than relying on earlier completion reports. The audit records that the 9/16 October requirements were not fully met on time. It conservatively counts eight statements already tested and merged through reviewed PRs for the 27 October minimum.

The assistant added executable storage-contract, independent-profile transfer and real interrupted-indexing/retry checks, plus a registry mapping all fifteen statements to test suites. The registry checker only verifies completeness; it does not certify behavior. A reproduced fresh-install model-download failure led to a manifest-generation lifecycle fix and a CI ordering guard. No application code under `src/` changed.

A new remote clone with the candidate patch completed dependency/model setup, checks, production build, 50 fast tests, 8 browser tests and 10 actual-model tests. Input hashes and reports are in [dated verification evidence](verification/2026-10-26/README.md). No phone result, human review or historical deadline success was fabricated. New work uses `raj_final` because main requires two approvals; this task does not bypass review or merge the follow-up.

## Raj integration and pre-PR verification, 23–25 October 2026

Tool: Codex coding assistant. Raj supplied the approved product scope, branch/publication instructions, UI restrictions and later request for a replaceable frontend. The assistant inspected the two merged teammate packages and implemented Raj’s interface, local processing/retrieval, PWA wiring, integration fixes, tests and supporting documentation on `raj_final`.

The existing storage/schema and shared contracts came from Nakshatra’s merged foundation. Policy and support-document inputs came from Chaitanya’s merged package; integration revised their current behavior descriptions. Interview material remains the team-supplied Suhani and Bhavya evidence. Synthetic corpus material is labelled test data and is not an interview or official campus announcement.

The assistant used the Emil Design Engineering/Mobile Native sources, React guidance and frontend testing guidance. The Browser plugin was unavailable, so browser testing used Playwright. Images and icons use authored code/SVG; speech fixtures use the local macOS voice. No generated stock imagery or invented reviews/counts were added.

Important corrections during implementation:

- The pinned quantized model used an ONNX operator unsupported by the browser WASM kernel. A standard-operator lowering was checked against an independent native reference and actual browser execution.
- The first fixed-corpus evaluation missed a note. Duplicate input from an automatically derived note title was removed; the failure remains in the evidence. Query variants explored along the way were not retained.
- A spoken-video result initially pointed before the relevant speech after leading silence. Trimming now preserves the original-sample offset in timestamps.
- The pre-PR UI review extracted service contracts, a controller, separate view modules and ordered feature styles for the planned redesign. A contract-only UI test is separate from real-model retrieval evidence.
- A temporary Node launcher passed an npm option into a nested command and prevented test-server startup. The verification rerun used the Node 24 executable directly.

Actual commands, raw outcomes and remaining manual checks are in [verification evidence](verification/README.md). That report preserves failures and distinguishes consumed-corpus regression from independent evaluation. Physical-device tests and team policy review must be completed by the team; the assistant has not represented them as passed. This note records assistance, not an independent human approval or course peer review.


28 October physical-device follow-up: AI assistance diagnosed the failed local HTTPS preview, implemented/tested an HTTP/1.1 TLS QA server and optional reuse of the still-valid local certificate, and exercised the production app on the owner's connected iPhone through Safari Web Inspector. The owner performed certificate trust, downloads and networking changes. Actual processing times, SHA-256/original checks, normalized vectors, offline reload/search and their limits are recorded in [device evidence](verification/2026-10-28-device-preparation.md#physical-iphone-session-28-october-following-preparation). The initial media-seek discrepancy, simulator-only iOS 26.5 render and remaining installed-PWA/playback checks are retained. This is measured device evidence, not a fabricated all-statements-green claim or a human review.


28–29 October continuation without the phone: assistance added static artifact validation, a manual-only deployment workflow/runbook, service-worker update preservation coverage, portable WebKit setup fixtures, explicit real-model WASM checks and bounded model-client cleanup. Native development-WebKit GPU crashes and unsuccessful experiments are retained in [release evidence](verification/2026-10-29-release-preparation.md); the model-worker experiment was removed rather than presented as a fix. Existing frozen retrieval inputs are unchanged. No human policy approval, complete physical compatibility, remote publication or independent new accuracy is claimed.

29 October continuation with the phone: assistance reduced the native WebKit crash to plain GPU workers and compared it with an upstream fix, ran real shipping-Safari inference/processing/source opening, and used a self-running compiled harness for actual iOS 26.5 simulator WASM inference and retrieval. Raj performed the installed-iPhone physical checks and explicitly reported their outcomes; those reports are labelled separately from captured diagnostics. Remote mobile inspectors opened blank windows, so no exact installed-client fingerprint or new phone timing is claimed. Only a standalone diagnostic and evidence were added; application/model inputs remain unchanged. See the [continuation record](verification/2026-10-29-release-preparation.md#29-october-continuation-with-the-iphone-available).

29 October UI audit follow-up: at Raj's request, Codex created `raj_all_fixes` from the Claude UI revamp and implemented three local fixes: route-aware onboarding/policy access, user-controlled demo animation and sticky-header section offsets. Five regressions were recorded failing before the fix. Visual inspection caught and corrected a reveal-class interaction introduced during implementation; the final run passed 78 fast tests and 19 Chromium UI tests, checks/format/build, and inspected desktop/phone screenshots. The current Swiss design is retained. Teammate issues and WebKit were left outside this fix scope; no physical retest, commit or publication is claimed. See the [UI checkpoint](verification/ui-review.md#landing-audit-fixes-on-raj_all_fixes-29-october-2026).
