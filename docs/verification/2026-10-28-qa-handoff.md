# Nakshatra bug-finding prerequisites: verification

Recorded 28 October 2026. This verifies the testing handoff, not Nakshatra's future findings or phone compatibility.

Starting application baseline: reviewed main `b58ee3508e7871602606cbc414d3a6c08c569da7`. The handoff adds plans, prompts, issue form, local synthetic-kit tooling, optional local HTTPS preview and tests. No application code under `src/`, model policy, original fixtures, frozen queries/thresholds or dependency versions changed.

## Actual validation

Environment: MacBook M4, macOS, Node 24.22.1, existing pinned npm dependencies and Playwright Chromium. This was not a fresh operating system, physical-phone run or new independent retrieval evaluation.

| Check | Actual result |
| --- | --- |
| Regression before implementation | The new kit test suite failed setup because `prepare-qa-kit.mjs` did not exist; its eight cases did not run. This is not eight assertion failures or historical deadline evidence. |
| Kit tests after implementation | Eight cases passed using the actual repository/importer and independent expected hashes: 30 originals/six kinds/queued jobs/no indexes, duplicate titles, repeated restores, four malformed archives, artifact integrity and refusal to overwrite tester notes |
| `npm run check` | Passed type/lint/product/15-ID mapping checks |
| `npm run test:fast` | 58 tests passed in 15 files |
| `npm run build` | Production build passed; no kit output/test harness added to production |
| `npm run test:browser` | Nine production browser cases passed, including kit restore of 30 queued originals, exact note opening, duplicate reporting and invalid-archive rejection without item loss |
| `npm run qa:prepare` | Generated 35 synthetic artifacts plus their inventory in ignored `.cache/qa-kit/`, about 1.5 MB on disk; no model download/browser data access |
| `npm run format:check` | Passed |
| Issue form and documentation | YAML structure/unique fields/options/required flags checked; formatting and local Markdown links checked. GitHub rendering is not claimed before default-branch publication. |
| `qa:https` local transport | Temporary test certificate, verified only by a Python client explicitly trusting that certificate. App, PWA manifest, asset manifest and ffmpeg WASM HEAD requests returned 200; WASM MIME was `application/wasm`. No OS/phone trust store changed. Server stopped afterward. |
| `qa:https` without certificate files | Explicit setup error; no insecure fallback |

The kit uses pinned existing originals and independent corpus page/media interval metadata. Its additional three exploratory text/snapshot queries have no measured success claim and are separate from acceptance. Generated archive IDs/capture times are synthetic; restoration allocates fresh item UUIDs. The generator does not overwrite an earlier ledger and does not copy models, private libraries or existing exports.

The existing actual-model suite is unchanged and was not rerun locally for a script/documentation handoff. The PR workflow remains configured to run real-model acceptance. Do not treat a kit-import check as proof of extraction or semantic ranking.

## Remaining actions

1. Required human reviews and authorized merge into main before the issue form/current-main prompts become the default handoff.
2. Nakshatra follows [the quickstart](../implementation/nakshatra-quickstart.md), records the actual fetched SHA and executes bug finding under her own account. Chaitanya can use the same kit with his assigned prompt.
3. Physical-device work needs a reachable trusted HTTPS origin and actual device-owner actions. The supplied local HTTPS command prepares the server path, but no public deployment, phone trust, LAN reachability or phone pass is claimed here.

All eight local toolkit cases and nine browser cases are reproducible commands, not a claim that the product is fully released or every SPEC statement has passed on phones.
