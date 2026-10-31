# UI review

Emil skill source revision: `2d228630ba1446365f614a108cb8252f1feda202`, verified from the repository main revision on 23 October 2026. Sources: https://github.com/emilkowalski/skills/blob/2d228630ba1446365f614a108cb8252f1feda202/skills/emil-design-eng/SKILL.md and https://github.com/emilkowalski/skills/blob/2d228630ba1446365f614a108cb8252f1feda202/skills/mobile-native/SKILL.md .

Review approach: Emil Kowalski Design Engineering and Mobile Native, plus the installed frontend testing and React guidance. The Browser plugin was not available, so Playwright Chromium was used. No AI-generated visual assets or stock imagery were used. Product and design decisions come from the approved plan, recorded in PRODUCT.md and DESIGN.md.

| Before | After | Why |
| --- | --- | --- |
| A large view mixed service creation, state and screen markup | Injected services, a headless controller, separate screens/rows/dialogs and ordered feature styles | Allow the planned frontend redesign without modifying persistence or inference |
| Merged foundation displayed only a boot message | Library, Add, Search, Settings, source viewer and policy routes | Complete the approved save-to-source workflow |
| Initial secondary text was too small in screenshots | Larger file titles, readable metadata and phone body text | Improve scanning and readability |
| A form's changing character counter became part of its accessible name | Explicit stable textarea labels | Reliable assistive-technology and browser-test targeting |
| A reload immediately after clicking Save could precede durable confirmation | Tests wait for repository-driven Saved locally feedback | Verify the actual persistence boundary |
| Optional inference assets could fall through to network | Cache-only inference fetch adapter and strict runtime service-worker path | Missing assets must request repair instead of remote fallback |
| Modal dialogs had no containment | Background inert state, Tab loop, initial focus and focus restoration | Keep keyboard interaction in the active dialog |

Automated screenshots cover Library, Add, Settings, Privacy and Terms at 390, 768 and 1440 px. The [desktop Library](screenshots/library-desktop.png) and [phone-width Add](screenshots/add-phone.png) screenshots were visually inspected after the final browser run. The production test also checks no document-level horizontal overflow and direct/offline policy loading. All seven production-browser cases pass, including exact originals, keyboard, reduced motion, long titles and safe capture. Axe reported zero WCAG A/AA violations across the five routes at 390 and 1440 px. The interface detector returned an empty findings list; this does not replace visual inspection or manual accessibility testing.

Physical phone touch, keyboard-open, safe-area, installed-PWA and pinch-zoom checks are pending. Resized Chromium screenshots do not establish iPhone or Android correctness. Policy text was updated to match implementation; team content review is still required before public deployment.

## 29 October 2026 redesign: Swiss with neo-brutalist accents

Direction chosen by Raj after comparing neo-brutalism, Swiss graphic design and bento grid mockups. Skills applied: Emil Kowalski `emil-design-eng` and `mobile-native` (repository `emilkowalski/skills`, commit `a81dbca07f2217b7103e510c0f13f8d5b017afc9`). Only `src/ui`, `index.html` and `DESIGN.md` changed. Services, controller, storage and engine are untouched. Checked so far: `npm run check`, `npm run format:check`, 78 fast tests, 12 Chromium UI tests including axe. Visual inspection was in the in-app browser at 1440 and 390 px; no physical phone, installed-PWA or WebKit pass has been run for this redesign.

| Before | After | Why |
| --- | --- | --- |
| Blue accent, white sidebar, rounded icon tile as logo | Paper background, ink text, one signal orange, typographic wordmark with a square mark | Remove the generic dashboard look; type carries identity |
| Colored file-type icon tiles on every row | Numbered rows with a mono type tag and a square status marker | Scannable index feel; no decorative icons |
| Dashed empty box with an icon tile | Large left-aligned headline, one sentence, one action | Empty state states the next real action |
| Light 1 px borders and soft shadows | 2 px ink rules and hard offset shadows on a few controls only | Neo-brutalist accent without blur or gradients |
| Ten modules patched by a late readability override block | One coherent set of ten modules, no override pass | Smaller, predictable cascade |
| Phone bottom bar with icon plus 11 px label | Text-only 4-cell bar, current cell inverted with a signal marker | Larger labels, clearer current page |
| Filters as underlined tabs | Joined rectangular segments, selected inverted | 44 px targets and an obvious state |
| Dialog and toast appeared instantly, blurred backdrop | 180 to 220 ms opacity and transform entry, flat 62 percent ink backdrop | Feedback without blur; reduced motion removes it |
| Hover rules partly ungated | All hover rules inside `(hover: hover) and (pointer: fine)` | No sticky hover on touch |

Not changed: PWA icon files and the manifest theme color still use the old blue. Updating them needs regenerated icons and a release check, so it is left as a separate decision.

### Readability and flow pass (29 October 2026)

Method: `ux-heuristics` skill (wondelai/skills, MIT, commit `c172996495bed0fcd26896a9416b2093fd7073f0`), applying Krug's laws, Nielsen's heuristics and its Quick Diagnostic. Checked: `npm run check`, `npm run format:check`, 78 fast tests, 12 Chromium UI tests. No physical device or WebKit run.

| Before | After | Why |
| --- | --- | --- |
| Body 15 px, metadata and status 12 px mono, muted text `#64635c` | Body 16 px, metadata and status 13 px, muted `#5a5953`, larger list titles and excerpts | Readability on laptops and phones |
| Library subline was a tagline | "N saved, M ready to search." or "Nothing saved yet." | Visibility of system status, fewer words |
| Filters showed no counts | Count on every type filter | Recognition over recall; empty types are visible at once |
| Search result location was the last words of a small meta line | Location ("Page 2", "0:02 to 0:08") first, bold, on a signal tag | The product's core promise is opening the exact place |
| Phone heading button full width | Compact button, 38 px heading | The list starts higher on small screens |

### Landing page and test-build correction (29 October 2026)

The `#/` route now shows a landing page (`src/ui/Landing.tsx`). New tests in `tests/e2e/landing.spec.ts` cover routing, in-page jumps, horizontal overflow at 390 and 1440 px and axe A/AA. Existing tests that opened the root and expected the welcome dialog now open `/#/library`.

Correction: the Playwright preview server on port 4174 serves `dist/` without rebuilding it. The Chromium results quoted for the two earlier redesign passes above ran against the older build from 14:06, not the redesigned code. After `npm run build` at 17:02 the full suite was rerun in the author's working tree: all 14 Chromium UI tests pass (one of them, the update test, is not part of this change) and all 14 pass in Playwright WebKit, including axe for the library routes and the landing page. Always run `npm run build` before `npm run test:browser`. WebKit, physical devices and the installed PWA have not been run for the redesign or landing page.

| Before | After | Why |
| --- | --- | --- |
| Root URL opened the library and a welcome dialog | Root URL opens the landing page; the library and dialog open from its buttons | A proper first impression for new visitors; installed app still starts in the library |
| No way back to an explanation page | "About Campus Recall" link in the sidebar | Orientation from inside the app |

### Landing audit fixes on `raj_all_fixes` (29 October 2026)

The three additional audit findings are fixed locally on `raj_all_fixes`, based on UI revamp commit `d8e5545`. Existing unstaged device/release work is preserved. This checkpoint does not implement or close the eight separate teammate reports.

| Before | After | Why |
| --- | --- | --- |
| First visit to the landing page set welcome state before its dialog mounted; policy links opened underneath onboarding and library entry skipped the focus effect | Pending introduction is separate from route-dependent dialog visibility; home/policy routes stay unobstructed and library entry mounts the existing focus-managed dialog | Policy access before setup, keyboard containment and durable dismissal |
| The sample search demo advanced indefinitely without a user control | Accessible Pause/Resume button freezes the typed query, result and caret; timers stop while paused/off screen and reduced-motion changes select the static example | Let users read the example without continuing motion |
| Section jumps aligned labels beneath the sticky header | Measured header height drives section scroll margins and the desktop pinned section offset, including wrapped narrow headers | Keep the destination label visible after navigation |

Five new browser tests first failed against the previous production build: two policy transitions, onboarding focus/dismissal, demo pause/resume and section offsets. After implementation, a visual check caught an unintended reveal-class reset on pause; this was corrected using a stable reveal class and a separate pause data attribute, with explicit opacity assertions added. Final Chromium UI results: **19 passed**, no failures/skips, 36.0 seconds. The fast suite passed **78/78**; TypeScript/lint/product/coverage-map checks, formatting and production build passed.

The final render check used Playwright Chromium at 1440, 390 and 320 px: correct page identity, no framework overlay or horizontal overflow, zero page errors, visible paused demo with a 44 px control, keyboard Space activation and unobstructed first-use Privacy access. Screenshots of the corrected desktop landing, phone demo and phone policy were inspected. Browser plugin unavailable, so the existing Playwright workflow was used. No physical-phone, Android, real-model or WebKit rerun is claimed for this UI checkpoint. All nine frozen retrieval hashes match; no model, worker, storage, threshold, dependency or index change was made.

Raw local logs and screenshots are outside the repository under `/tmp/campus-recall-fixes-*`. No commit, push, PR, issue update or deployment was performed; the branch is the local collection point for later fixes and the eventual reviewed PR.
