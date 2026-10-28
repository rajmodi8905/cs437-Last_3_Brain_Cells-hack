# Chaitanya: start UI, webpage and PWA bug finding

You find/report defects and retest fixes. Raj implements all changes, including UI, policies and PWA fixes. Use [your complete AI prompt](bug-hunt-chaitanya.md), [the release plan](release-plan.md) and the repository [Bug report form](../../.github/ISSUE_TEMPLATE/bug-report.yml). Do not repeat your historical content implementation package.

This handoff extends [PR #8's shared kit](https://github.com/rajmodi8905/cs437-Last_3_Brain_Cells-hack/pull/8). For the official current-main round, wait for both handoffs to merge. You do not need to wait for Nakshatra's findings. Candidate testing before merge must identify the exact branch/SHA and must not pretend to be main.

## 1. Prepare your own checkout and profiles

Inspect status and preserve existing work. In a separate new folder if needed:

```bash
git clone https://github.com/rajmodi8905/cs437-Last_3_Brain_Cells-hack.git campus-recall-chaitanya-qa
cd campus-recall-chaitanya-qa
git rev-parse HEAD
node --version
npm ci
npm run qa:prepare -- --output-dir .cache/chaitanya-qa
npm run build
npm run preview -- --port 4173 --strictPort
```

Use Node 24 (24.22.1 in `.nvmrc`). Open `http://127.0.0.1:4173/` in a dedicated QA profile. The generator refuses to overwrite old ledgers; choose a new output directory for another round. No API key, model download, Python, ffmpeg or macOS speech regeneration is needed to prepare the kit. Read [shared setup](nakshatra-quickstart.md) for original/hash/archive details and optional local HTTPS.

Use a new profile for genuine first-use/no-model checks. Keep the same origin/profile when testing persistence, interruption, offline launch or updates. Record OS/browser/version, desktop/phone, browser/installed mode, viewport/orientation, model/cache/network state, fixture/hash and actual SHA. Never clear a personal library to obtain an empty state.

## 2. Your materials

The common kit now also provides:

| File | Purpose |
| --- | --- |
| `ui-stress.zip` | Three real queued notes: a 120-character title, a 20,000-character source and verbatim Unicode/quoted source punctuation |
| `ui/long-title.txt` | Paste into Title to exercise its supported boundary |
| `ui/long-note.txt` | Paste into Note to exercise its supported boundary |
| `ui/fallback-text.txt` | Exact synthetic source for manual webpage fallback |
| `ui/snapshot.html` | HTML snapshot containing readable text, a script and an image; imports must remain inert |
| `expected.json` | Original content/hashes, PDF pages/media intervals and the three UI records under `uiStress` |
| `chaitanya-ledger.md` | C1–C15 scenarios with every outcome initially Not run |

The shared `same-title.zip`, `library-30.zip`, originals and invalid inputs are available for viewer, source identity and error-state checks. Restore queues items; it never fabricates Ready/Failed states. Observe those states through actual setup/processing/failure. `.txt` files are form inputs, not supported direct file imports.

Imported source text intentionally includes a quoted em dash and Unicode. The product-copy restrictions do not authorize changing imported content. A long title, note or fixture being generated is not proof its UI works.

## 3. Controlled webpage checks on your laptop

Keep the production preview running. In a second terminal in the same checkout:

```bash
npm run qa:webpages
```

This helper listens only on `127.0.0.1:4181`, serves fixed synthetic pages and has no model mirror, file server or upload endpoint. It requires no CLI model download. It is separate from the application and is not deployed with it. If 4181 is occupied, stop your own conflicting helper or set `QA_WEB_PORT` to a fixed free port and substitute it in the URLs. For the supplied HTML snapshot/probe example use default 4181.

Use **Add > Webpage > Public webpage URL > Capture** in the app, not the browser address bar:

| URL | Expected behavior |
| --- | --- |
| `http://127.0.0.1:4181/allowed` | Captured title `Synthetic QA notice`; text `Robotics induction is on Saturday at the north workshop.` |
| `http://127.0.0.1:4181/large` | First 20,000 code points with visible truncation notice |
| `http://127.0.0.1:4181/blocked` | Intentionally lacks CORS; capture should fail honestly and permit pasted text/HTML fallback |
| `http://127.0.0.1:4181/error` | Intentional HTTP 503; honest failure and usable fallback |
| `http://127.0.0.1:4181/unsupported` | Deliberate non-webpage MIME; honest failure and usable fallback |

After a blocked capture, paste `ui/fallback-text.txt`, save and open the exact original. In a separate Add form, choose the HTML snapshot file and verify only readable text is extracted. The imported script/image must not execute or load.

For an inert-import check, restart the helper first to reset its probe counter. After capture/import, opening `http://127.0.0.1:4181/probe-count` should show `{"requests":0}`. Directly opening `/allowed`, `/large` or the HTML file in a browser intentionally runs its script/image, so it invalidates a zero-probe check until the helper is restarted. Do not report that intentional fixture behavior as an application defect.

These HTTP loopback fixtures are for desktop capture testing. They are not reachable at the phone's localhost and must not be used as evidence of physical-phone HTTPS/CORS compatibility. Use imported snapshots and the actual agreed phone URL for that session. Stop the helper with Ctrl+C when finished.

## 4. Execute your scenarios

Work through C1–C15 in your generated ledger:

1. **Before setup:** first-use policy access; Library/Add/Search/Settings navigation; empty states; save confirmation; queued originals after reload. An unavailable search engine should report that honestly.
2. **Stress and viewers:** restore `ui-stress.zip`; inspect long titles/text at 390/768/1440 px; open each exact original, close and reopen; check Unicode/source text. Use the shared corpus for image/PDF/audio/video viewers and independent page/timestamp expectations after actual indexing.
3. **Keyboard/accessibility:** labelled controls, visible focus, tab order, dialog focus/close/return, Escape, keyboard shortcuts, reduced motion, zoom, contrast and touch targets. Record both automated results and manual observations; zero axe findings is not full accessibility proof.
4. **Capture:** run the controlled cases above and document expected restrictions separately from broken fallback behavior.
5. **Setup/processing:** explicitly download offline search in browser Settings, observe real progress and verified readiness, repeat clicks/interruption/repair and actual queued/failed/ready states. Keep the app open while processing. CLI `.models/` is a separate cache; do not download it merely for manual QA.
6. **Offline:** from the production preview, wait for app caching, revisit with network disabled and reopen policies and originals. Processing/search additionally require verified model/runtime caching. Close/reopen the same profile; do not call a new-profile failure lost persistence.
7. **Policies and style:** compare live pages with actual requests, storage/export/delete and the selected host. Report unknown hosting facts as unresolved; do not invent them or edit policy text. Apply the prohibited-pattern list without rewriting originals/quotes.
8. **Phones/install/update:** record real device/OS/browser, safe areas, keyboard, landscape, pinch zoom, installation/playback/offline/update behavior. Use trusted reachable HTTPS supplied for the session; USB-C inspection setup is in the release plan. Report unavailable devices or unprepared update candidates as blocked/not run. Never silently extrapolate from a resized Chromium page.
9. **After Raj fixes/redesign:** repeat original steps on the named candidate, record Before | After | Why, then verify merged main where available. A closed issue is not a passing retest.

For updates, use two explicitly identified builds on the same origin, take a manual backup and observe the app's update notification. No second build is fabricated by this handoff. If none is provided, leave that scenario unrun.

## 5. Report actual findings

Use the common Bug report form and your prompt's own-account authorization. One reproducible nonduplicate defect per issue, with actual versus expected behavior, severity proposal, attempts and sanitized evidence. Static-code concerns stay labelled unverified. No quota of issues and no invented screenshots/results.

Keep generated ledgers, screenshots, personal documents, model caches and exports out of public commits. Give Raj issue links plus blocked/not-run scenarios. Raj handles all fixes and implementation; your handoff is observation, reporting and retesting.

## 6. Optional automation

`npm run check` and `npm run test:fast` validate code/tooling. For browser automation, install Playwright Chromium, build, then `npm run test:browser`; Linux may need `npx playwright install --with-deps chromium`. Full `npm test` additionally requires the separate CLI model preparation described in README. Do not skip missing-model tests and call the full suite green.

This handoff prepares materials and reproducible helpers; it does not claim phone compatibility, final policy approval, model setup interruption or deployed-update verification has happened.
