# AI-assisted development notes

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
