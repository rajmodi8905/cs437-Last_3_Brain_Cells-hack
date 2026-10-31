# Android release validation

Prepared 31 October 2026. The planned reference device is the iQOO Neo9 Pro / 8 GB; record the actual phone, Android build and Chrome version before testing. This is a runbook, not a device pass. Existing iPhone measurements and owner-confirmed checks remain in the [iOS evidence](../verification/2026-10-29-release-preparation.md#physical-installed-iphone-app-owner-confirmed-checks).

## Candidate and connection

Use the exact reviewed candidate named for the round. A pending teammate PR is not treated as merged. After another merge changes storage, extraction or runtime inputs, prepare a new snapshot and retest affected scenarios. Keep the earlier results with their original commit identities.

From Node 24 with the pinned dependencies installed:

```bash
ipconfig getifaddr en0
npm run qa:device:prepare -- --address ACTUAL_LAN_IP --directory .cache/android-session-round-1
npm run qa:device:serve -- --directory .cache/android-session-round-1 --host 0.0.0.0
```

Replace the address and session name with the actual values. The preparation command refuses to overwrite an existing session. Follow the [device-session runbook](device-session.md) for source hashes, certificate fingerprints and expiry, synthetic downloads, and server checks. Preparation creates no phone result and changes no trust settings.

The phone must reach the printed HTTPS origin. When using local HTTPS, the owner deliberately installs only the generated public `app/__qa/root-ca.crt` through the phone's certificate settings and verifies its fingerprint. OEM menu names vary. Never transfer `private/`, bypass a certificate warning, or use an insecure-origin override to claim installation/offline success. An authorized hosted HTTPS candidate is an alternative; no hosting is supplied by this runbook.

For optional USB diagnostics, the owner enables Developer options and USB debugging, connects a data cable and accepts the debugging prompt. On Mac Chrome, open `chrome://inspect/#devices` and enable Discover USB devices. Open the app in Android Chrome and inspect its listed tab. This is [Chrome's documented remote-debugging workflow](https://developer.chrome.com/docs/devtools/remote-debugging/). The USB cable alone does not make the LAN origin reachable or trusted. Android Studio and a native APK are unnecessary for this PWA test.

## Record before testing

- Operator/date; device model/RAM; Android build; Chrome version; browser versus installed mode.
- App URL; `/__qa/session.json` source commit, input hash, asset manifest and index version; clean/modified runtime status.
- Certificate validity and warning-free HTTPS; actual `window.isSecureContext`; service-worker control after loading.
- Profile/library state; available storage; network state; model setup and cold/warm state. Do not clear an existing personal library to create a test profile.

Download `/__qa/fixtures.zip` and `/__qa/expected.json` before the offline round. Use only the supplied synthetic materials. The ZIP contains originals, independent expected pages/media intervals, malformed cases and tester ledgers. Model setup is a separate approximately 445 MB download; record its actual displayed size and completion.

## Execute in this order

| Round | Actions and pass evidence |
| --- | --- |
| Before setup | Save a note and PDF through actual controls, reload, and open their preserved originals. Search readiness must not be confused with storage confirmation. Open Privacy and Terms before setup. |
| Setup | Download and verify assets; record completion and time separately from indexing. Exercise an interrupted download and retry/repair. A failed or incomplete setup must not claim Offline ready. |
| S8 reference fixtures | Time `sample-01.jpg`, `sample-02.png`, `ocr.webp`, `sample-03.pdf` and `scanned.pdf` individually from Save activation to actual Ready after setup. Record bytes/hash, first/warm state, elapsed time and OCR/page provenance. Each agreed small fixture has a 120-second target; do not extrapolate to maximum-size files. |
| Retrieval and originals | Use the unchanged expected queries from `expected.json`: text/PDF page, text-free image, speech and sampled video scene. Compare the exact original and expected page/time interval; exercise Play, two seeks and reopen for audio/video. Run the fixed unrelated queries as well. |
| Installed app | Use Chrome's install action, then open from the launcher. Confirm standalone display; record actual library/cache behavior. Test real file picker, note keyboard/save, portrait/landscape, zoom, safe areas and reachable essential controls. [Chrome installation instructions](https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DAndroid&hl=en). |
| Offline | After setup and fixture download, disable Wi-Fi and mobile data on the phone. In browser and installed mode, close/reopen, import/process a fresh local fixture, run a fresh query and open the original. Playback is tested separately. Restore networking afterward. |
| Transfer and lifecycle | Export the synthetic library and restore into a separate profile/device; compare original hashes, titles, duplicate reporting and queued/reindexed status. Test deletion/reload, processing interruption/reopen and retry. Retest Nakshatra's reported archive/OCR cases only on the build that includes her fixes. |
| Update | Keep a synthetic saved original and backup. When a separately identified update is available, confirm an explicit update notice, no forced reload during work, and preserved original/offline reopening afterward. With only one build available, record Not run. |

Keep timings per modality. For speech/video, distinguish processing success, matched timestamp, physical playback and offline success. Inspecting a browser tab is not a substitute for the owner's actual keyboard, picker and touch checks.

## Result ledger and handoff

Use the generated session's `DEVICE_STEPS.md` and a local copy of this row for every scenario. Values stay Not run until executed; distinguish captured diagnostics from owner reports.

| Scenario / SPEC | Candidate / mode | Expected source / state | Actual / timing / attempts | Result | Evidence / issue |
| --- | --- | --- | --- | --- | --- |
| Not selected | Not recorded | Not recorded | Not observed | Not run | None |

Record Pass, Fail, Blocked or Not run with the actual reason. A failed query is retained; do not change thresholds, expectations or fixtures to obtain a pass. Preserve exports and previous measurements. Stop the local server afterward; the owner can revoke USB debugging authorization and remove temporary certificate trust when no longer needed. No deployment, Android pass or all-statements-green claim follows from preparing this file.
