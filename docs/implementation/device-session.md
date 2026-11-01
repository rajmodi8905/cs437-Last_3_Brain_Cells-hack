# Prepare and run the real-phone session

For Android Chrome and installed-app execution, use the [Android validation runbook](android-validation.md) alongside this transport/build preparation. Earlier iPhone results retain their original build identities; a prepared Android snapshot is not a new device pass.

This completes local infrastructure for the 28 October work in [the release plan](release-plan.md). Raj prepares the build/diagnostics and implements fixes. Nakshatra and Chaitanya execute their assigned scenarios and report findings. Device owners perform unlock, trust, certificate, installation and physical interaction steps. Preparation alone never establishes a phone pass.

## What is ready and what still needs a phone

The plan, issue form, prompts and both testers' kits reached main through PRs #8 and #9. Main `59756cc9aac759776dbb578b1f85d2822ad56d65` has a successful [CI run](https://github.com/rajmodi8905/cs437-Last_3_Brain_Cells-hack/actions/runs/40663915386).

The new commands create an isolated production snapshot, pinned source/build/fixture identities, a downloadable synthetic kit, a temporary seven-day local certificate and a blank physical-device record. They do not deploy a hosted site, install a certificate, alter trust stores, read an existing browser library, run models or claim any device result.

S8's actual phone performance, S13's installation/keyboard/safe-area/zoom/playback/offline checks and S15's final team policy/hosting review remain open. Do not start the UI revamp before the initial compatibility pass and core blockers are understood.

## Local preparation

Use Node 24, the pinned npm dependencies and an installed OpenSSL executable. On the current Mac these prerequisites are available. No new npm dependency, Xcode installation, paid service or API key is required. From the project checkout:

```bash
npm run qa:device:prepare -- --address ACTUAL_LAN_IP
```

Replace `ACTUAL_LAN_IP` with the Mac's actual reachable IPv4 address. On this Mac, `ipconfig getifaddr en0` reports the Wi-Fi address; it can change. Use `127.0.0.1` only for a laptop-only transport test, never as a phone URL.

The command typechecks and builds from current source into `.cache/device-session/app/`, generates the shared kit, and creates these additional files:

| Path inside the session | Purpose |
| --- | --- |
| `DEVICE_STEPS.md` | Actual source identity, planned address, public root fingerprint, expiry and blank result ledger |
| `app/` | Isolated production QA snapshot; normal `dist/` and existing browser libraries are preserved |
| `app/__qa/session.json` | Commit, exact runtime input hashes, asset manifest hash, index policy, fixture hash and certificate fingerprints |
| `app/__qa/fixtures.zip` | Phone-downloadable synthetic files/archives/checklists; no model weights or private libraries |
| `app/__qa/expected.json` | Original hashes, expected source pages/media intervals and the five agreed small S8 fixtures |
| `app/__qa/root-ca.crt` | Public temporary root certificate for deliberate device-owner installation |
| `private/` | Local certificate keys/configuration; never share or commit |
| `record.json` | Local snapshot inventory used to refuse changed or misidentified builds |

The generator refuses an existing session directory. For another run, use a new directory:

```bash
npm run qa:device:prepare -- --address ACTUAL_LAN_IP --directory .cache/device-session-round-2
```

For a new build on the same address during an existing trusted session, reuse its still-valid certificate without copying its root signing key:

```bash
npm run qa:device:prepare -- --address ACTUAL_LAN_IP --directory .cache/device-session-round-2 --certificate-from .cache/device-session
```

This preserves the original certificate expiry and fingerprint. It does not install trust or extend validity. Expired, mismatched or wrong-address certificates are rejected. Retain the old session and its measurements.

Keep session files under ignored `.cache/` or outside the repository. A full prepared app snapshot uses more disk space than the small fixture ZIP. This is a QA build with additional synthetic downloads, not the artifact to publish as the normal product.

## Start the local HTTPS host

The server verifies snapshot/source hashes, certificate/key/issuer/IP matching and expiry before starting. It uses HTTP/1.1 over TLS because the default HTTP/2 preview failed on the reference iPhone; certificate validation remains enabled. It refuses changed snapshots rather than silently attaching the wrong version to a phone result.

```bash
npm run qa:device:serve -- --host 0.0.0.0
```

Add `--directory .cache/device-session-round-2` for a different prepared session. Default port is 4473; an explicit `--port` can select another fixed port. The command prints the actual `QA_DEVICE_URL`. Without `--host 0.0.0.0`, it binds to Mac loopback for laptop transport checks only.

Use the same origin and profile throughout a test round. A phone cannot reach the Mac's `127.0.0.1`. Both devices need a network route to the selected address; campus client isolation, a changed address or firewall rules may prevent this. Report reachability separately; a cable does not create trusted HTTPS or a LAN route. If the network changes, prepare a correctly identified session for its new address instead of ignoring certificate errors.

## Device-owner actions, when the iPhone is connected

1. Connect USB-C, unlock the phone and accept the Mac trust prompt if shown. Record the exact iOS and Safari versions. The cable enables inspection; it does not by itself prove app compatibility.
2. Enable Safari Web Inspector on the phone and developer features on Mac Safari. Follow [WebKit's instructions](https://webkit.org/web-inspector/enabling-web-inspector/). Do not install Xcode/Developer Mode merely to test this PWA.
3. If choosing local HTTPS, transfer only the public `app/__qa/root-ca.crt` to the phone using a device-owner-controlled method. Check its displayed fingerprint against `DEVICE_STEPS.md`. Never transfer the `private/` directory or a CA private key.
4. The owner must deliberately install the temporary profile and enable its SSL trust. Apple explains the separate [certificate trust step](https://support.apple.com/en-us/102390). No script performs it. If the owner prefers not to add development trust, use a separately authorized hosted HTTPS preview instead; that has not been deployed here.
5. Open the printed HTTPS app URL in Safari after certificate trust and reachability are confirmed. A certificate-warning bypass is not a passing trusted-HTTPS test.
6. Open `/__qa/session.json` at that same origin and record its actual identity. Download `/__qa/fixtures.zip` into Files and extract it. Synthetic fixture transfers are separate from the approximately 445 MB browser model setup.
7. Begin with one note/image/PDF at a time, then visual and short media cases. Keep the app open during indexing and wait for actual Ready/Failed state. Save before setup is a separate check from search after verified setup.
8. Repeat relevant scenarios in the installed PWA. Observe its actual cache/library behavior rather than assuming it shares Safari's storage. Record installation, keyboard-open forms, safe areas, landscape, zoom, source opening and playback on the real device.

Existing data/models at Mac `http://127.0.0.1:4173/` are not copied to the phone or this new HTTPS origin. An empty library/new setup at a different origin is not evidence of lost data. Use the supplied JPEG/PNG/WebP/PDF fixtures first; HEIC/HEVC/MOV remain outside v1.

## Measurements and evidence

Use the generated `DEVICE_STEPS.md` and tester ledgers. Initial values remain Not run until someone executes a scenario. Record:

- Tested session/source commit, source input hash, build URL and any local changes.
- Exact physical device, OS/browser, Safari versus installed mode and test operator/date.
- Model/runtime setup state, cold/warm conditions, network/foreground/background state.
- Fixture filename/hash/bytes, independently expected original/page/interval, actual outcome and measured elapsed time.
- Failure reason, attempt count and a sanitized issue/retest reference when needed.

For S8, independently time each agreed small JPEG/PNG/WebP/text PDF/scanned PDF fixture after setup. The target is 120 seconds each on the documented reference phone, not laptop extrapolation. Speech/full-media timing is separate. Model setup time must not be quietly mixed into or removed from an indexing measurement.

For S13, separately record actual installation and offline reopening. For S14, core processing/search/source opening must work with networking disabled after setup; public fixture downloads/setup and explicit website capture are separate allowed requests. Initial transport success alone proves none of these processing outcomes.

The current desktop automated checks do not replace these physical measurements. Do not edit the fixed queries/thresholds/expected source locations to hide a miss, mark unrun scenarios passed or treat inferred hardware features as successful inference.

## Finish the session

Stop the preview with Ctrl+C. Preserve the synthetic kit and actual measurements while fixes are reviewed. Device owners can remove temporary development trust/profile when it is no longer needed. Private keys, generated snapshots, certificate files, downloaded weights, personal files and local notes stay out of commits.

After a fix, prepare a new identified snapshot and have the reporter repeat the original failure on the correct device. Public deployment and final policy approval remain separate authorized release steps.
