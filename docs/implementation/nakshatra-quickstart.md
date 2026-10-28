# Nakshatra: start the bug-finding round

This is the executable handoff for the [release plan](release-plan.md). It prepares test materials and a production app, not a new implementation assignment. Use [your complete AI prompt](bug-hunt-nakshatra.md). Raj implements fixes; you find/report defects and retest fixes. Chaitanya can reuse this setup with [his prompt](bug-hunt-chaitanya.md).

## 1. Start from the reviewed main version

Wait for the handoff PR containing this file, the scripts and issue form to merge into main. Inspect `git status` before changing an existing checkout; preserve unrelated work and do not reset/clean. For a separate clean checkout:

```bash
git clone https://github.com/rajmodi8905/cs437-Last_3_Brain_Cells-hack.git campus-recall-qa
cd campus-recall-qa
git rev-parse HEAD
node --version
```

Use Node 24; `.nvmrc` specifies 24.22.1. If the named directory already exists, use it safely or choose another new name. Record the exact main SHA rather than copying an earlier plan's SHA. For a candidate retest, use the exact reviewed candidate that Raj supplies and label it as such.

## 2. Prepare the kit and production app

```bash
npm ci
npm run qa:prepare
npm run build
npm run preview -- --port 4173 --strictPort
```

Open `http://127.0.0.1:4173/` in a dedicated QA browser profile. Keep the terminal running. Stop the server with Ctrl+C. Use this same origin/profile for reload/offline tests; do not clear a real library. A localhost production preview supports laptop testing without a hosted deployment.

`qa:prepare` uses only checked-in synthetic files and existing npm dependencies. It needs no API key, Python, ffmpeg, macOS speech command, model download or access to anyone's browser data. It verifies frozen retrieval inputs and generates `.cache/qa-kit/`:

| Material | Use |
| --- | --- |
| `START_HERE.md` | Ordered instructions and interpretation limits |
| `library-30.zip` | Import all twelve known targets and eighteen distractors via Settings > Choose backup ZIP |
| `originals/` | Import individual supported files to test Save separately from archive restore |
| `expected.json` | Exact content hashes, queries, original filenames/text, expected PDF pages and media intervals in seconds |
| `same-title.zip` | Two distinct originals sharing a display title; repeat restore to test content duplicates |
| `invalid/*.zip` | Invalid version/hash/path/missing-original cases; reject atomically without changing existing items |
| `invalid/corrupt.png` | Header-only PNG; original may save but must fail decoding honestly and remain available |
| `invalid/unsupported.txt` | Deliberately unsupported direct file input; use Note for text |
| `invalid/over-limit-note.txt` | Paste into Note to exercise the 20,000-character boundary; rejection/prevention must be honest |
| `exploratory.zip` | Three additional synthetic note/snapshot cases, separate from the fixed regression library |
| `baseline.json` | Source HEAD/working-tree state, Node version, lockfile/model-policy hashes and index settings |
| `kit-manifest.json` | SHA-256 and size for each delivered artifact except the manifest itself |
| `run-ledger.md` | Unfilled evidence ledger; generation is not a test run |

The generator refuses to overwrite an existing output directory, including your notes. For another round:

```bash
npm run qa:prepare -- --output-dir .cache/qa-round-2
```

All fixed archive capture times are synthetic. Restored items receive new UUIDs. Map originals using hashes/text and page/interval expectations rather than assuming the UUID in the archive is the runtime UUID. No model weights or embeddings are included. Copying an archive to another device does not copy its model cache.

## 3. Execute the first laptop round

1. Before model setup, save at least one supported file from each available type plus a note and manually pasted webpage snapshot. Reload; compare originals and queued visibility. Use `expected.json` for the exact note/snapshot text and URL. `.txt` files are not supported direct file imports.
2. Restore `library-30.zip` in Settings. Check 30 queued originals and their viewers; do not mistake Queued for successful extraction. Repeating restore should report 30 content duplicates. Use a separate fresh profile if step 1 already saved some of the same originals; otherwise the imported count should reflect those real duplicates.
3. Choose Download offline search in Settings. This is the browser's explicit approximately 445 MB setup. Wait for actual verified readiness, then complete indexing with the app open. A CLI model download does not install models into this browser profile.
4. Run the fixed queries and unrelated queries from `expected.json`. Check matching originals, PDF pages and speech/visual intervals. Preserve known negative and weak-match behavior. The original corpus is already consumed regression data; no broad accuracy claim follows from passing it.
5. Run `same-title.zip`, rename/filter/delete tests, interruption/retry and export/restore into another profile. Use disposable profiles for malformed archives/quota experiments. Verify an existing sentinel item survives each rejected invalid archive.
6. Evaluate `exploratory.zip` in a separate profile/library, not mixed into the fixed 30-item corpus. It has no measured success claim. Record misses and ambiguity; do not tune model/threshold/query policy while calling this independent evaluation.
7. Record actual observations in the ledger. File one reproducible nonduplicate issue per defect using GitHub > Issues > New issue > Bug report. Include the actual SHA/build URL and required fields. If the form is absent, verify this handoff has reached the repository's default branch.

The `example.test` URLs identify saved synthetic snapshots; they are not live pages and do not promise a successful network fetch. Save their supplied text through the fallback. Use public real pages only for explicit webpage-capture checks.

## 4. Automated commands are optional for manual discovery

To validate storage/tooling quickly:

```bash
npm run check
npm run test:fast
```

For the full automated suite, separately follow README browser installation and `npm run models:download`, then `npm run build` and `npm test`. CLI assets live in ignored `.models/` for the test mirror, separately from browser Cache Storage. Skip that download when doing only manual browser testing; it is not a prerequisite for `qa:prepare` or preview.

If a required setup step fails, record its real error and mark dependent scenarios blocked. Do not replace inference with fixture results or claim a missing-device check passed.

## 5. Physical phones and optional local HTTPS

Desktop storage/archive testing can start independently. A phone cannot reach a laptop's `127.0.0.1`; HTTP at a LAN address does not establish PWA/secure-context acceptance. Ask Raj for the exact stable, trusted HTTPS address and candidate SHA when scheduling phone work. No hosted deployment is created by this handoff.

For a local HTTPS session, the host needs a certificate valid for its actual LAN IP/hostname, trusted on each test device. With existing certificate files, the supplied preview command is:

```bash
QA_TLS_KEY=/absolute/path/to/qa-key.pem \
QA_TLS_CERT=/absolute/path/to/qa-cert.pem \
QA_HOST=0.0.0.0 \
npm run qa:https
```

This is macOS/Linux shell syntax; in PowerShell set the equivalent `$env:QA_TLS_KEY`, `$env:QA_TLS_CERT` and `$env:QA_HOST` first. Port defaults to 4173; set `QA_PORT` to a fixed different port if necessary. Use the host's LAN address from the phone on a reachable network. Do not treat the printed `localhost` URL as a phone URL, and do not bypass certificate errors as proof of trusted HTTPS.

When local certificates are needed, Raj/device owners can deliberately use [mkcert's documented mobile setup](https://github.com/FiloSottile/mkcert#mobile-devices). For example, after they have approved and configured their local CA, `mkcert -key-file .cache/qa-key.pem -cert-file .cache/qa-cert.pem localhost 127.0.0.1 ACTUAL_LAN_IP` creates a leaf certificate; replace `ACTUAL_LAN_IP` with the real address. Install only the public root certificate on the phone as instructed, never the CA private key. iOS certificate profiles require explicit [SSL trust](https://support.apple.com/en-us/102390). Device owners control these actions; the scripts do not install certificates or change trust stores. Remove development trust when the session is over if it is no longer needed.

For iPhone diagnostics, connect USB-C, unlock/trust the Mac and enable Safari Web Inspector as in the release plan. The cable is useful for inspection, but is not required for laptop testing. Actual certificate trust, LAN reachability and physical phone behavior remain to be verified during the device session.

## 6. Report and retest

Use the [issue form](../../.github/ISSUE_TEMPLATE/bug-report.yml) and your prompt's account/duplicate/privacy rules. Keep private files, real library exports, downloaded weights, test ledgers and generated kit outputs out of public commits. Known fixture inputs may be named by path/hash instead of attaching them again.

Give Raj issue links and blocked/not-run scenarios. Retest original failures on each named candidate and after its reviewed merge. Neither generating this kit nor a merged fix establishes that your physical environment passed.
