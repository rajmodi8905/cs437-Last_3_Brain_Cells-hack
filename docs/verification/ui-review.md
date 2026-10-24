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
