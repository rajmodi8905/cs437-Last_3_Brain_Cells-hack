# AI-assisted development notes

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
