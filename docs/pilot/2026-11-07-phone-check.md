# Phone check and publication checkpoint — 7 November 2026

Raj reported: “I checked it on phone everything is working,” then authorized committing the deployment work/tests, pushing the pilot branch and opening the final PR. This is an owner-reported phone check, separate from the instrumented automated and hosted evidence in the [release record](2026-11-06-release.md).

## Independently observed during preparation

- The connected physical device was an iPhone 17 running iOS 27.2, build 24B119. USB metadata reported wired, paired and connected; Developer Mode remained disabled.
- Remote Web Inspector identified the actual deployed HTTPS origin in Safari 27.2, secure and online, with a 402 × 754 CSS-pixel viewport. The inspected session was Safari, not standalone Home Screen mode.
- The phone's deployed-origin library was empty before test preparation. Its Library and Settings screens rendered; no existing private library was cleared or enrolled by the assistant.
- In the separate laptop browser, all 445.2 MB of offline assets were verified. Google sign-in was refreshed, a synthetic note was indexed by the real local model, and “Where is our adviser appointment?” retrieved its original mentor/library-entrance text. Explicitly including this one-item synthetic laptop library then displayed “1 item synced.”

Mac native inspection encountered screen-capture failures. Raj authorized a temporary direct USB debugger; its default network listener was stopped immediately and an isolated build was restricted to loopback before use. The debugger was stopped at the end of the session. Private connection metadata, debugger source/build output, credentials and raw device logs remain outside this repository.

## Evidence limits

The owner's general phone result is not expanded into unreported individual steps. This session did not independently measure phone processing time, compare a phone-downloaded original's hash, capture installed-PWA behavior, prove an offline phone reload, or test a second genuine IITGN user's isolation. Those specific observations remain unrecorded rather than failed. The earlier automated sync, byte/hash, offline, real-model, storage and recovery results retain their documented scopes.

## Tests included in the PR

The pilot suite covers identity/ownership, durable original/index sync, resumable uploads, deletion/conflicts, concurrent writers and quota/idempotency, backup/restore, explicit opt-in, cloud export and offline controls. A separate actual-model browser test checks synced PDF retrieval on a fresh receiver without its original. CI now runs the pilot storage, browser and actual-model suites and requires their job to pass alongside the unchanged root S1–S15 checks.

The PR proposes the separate pilot work for review; opening it does not merge it into the original coursework baseline or replace the already deployed immutable image. End-of-pilot export/retention/resource teardown and actual usage feedback remain operational follow-ups.
