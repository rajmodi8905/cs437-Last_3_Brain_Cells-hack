# Campus Recall design context

The interface is a Swiss typographic system with neo-brutalist accents. It is a practical personal library: warm paper background, near-black ink, system Helvetica, one signal orange, and square corners everywhere. Type and rules carry the layout, not cards or icons.

Layout: desktop uses a left index rail, a content column and a source inspector on the right. Phones use a compact header, a text-only bottom bar and a full-screen source viewer. Rows in the library, search results and settings sections are numbered with CSS counters. Search is prominent and bordered; saved and search-ready are different states.

Neo-brutalist accents are limited to a 2 px ink border and a hard offset shadow on the search field, primary and secondary buttons, the setup banner, the add form and dialogs. Pressing a button moves it into its shadow. Everything else is flat.

Tokens live in `src/ui/styles/theme.css`: `--paper`, `--card`, `--ink`, `--muted`, `--signal` (fills only, always with ink text), `--signal-text` (links and counters), plus `--ok`, `--warn` and `--bad` for status. No external fonts. Mono is the system monospace stack, used for labels, counters, metadata and timestamps.

Rules kept from the approved plan: buttons are rectangular, at most 6 px corners (current value is 0), visible focus, 44 px main touch targets, phone inputs at least 16 px, safe areas and dynamic viewport units, pinch zoom preserved, reduced motion respected. Motion is limited to press feedback, dialog and toast entry (under 220 ms, ease-out, opacity and transform only) and the dropdown, which scales from its trigger. Hover styles sit behind `(hover: hover) and (pointer: fine)`. Empty states explain the next real action. No fabricated library data.

Banned: gradients, purple accents, pills, emoji icons, fake reviews or metrics, vague hero copy, AI stock imagery, generic marketing copy, authored em dashes, custom cursors, decorative scroll effects, blur and soft drop shadows. Preserve user imports exactly.

Apply Emil Kowalski's Design Engineering and Mobile Native guidance where consistent with these constraints. Product flows must stay functional before model setup and offline. Settings and first-use information link Privacy and Terms. Review real behavior, typography, long content, keyboard navigation and narrow layouts, then record actual findings in a Before | After | Why table in `docs/verification/ui-review.md`.

Landing page: the `#/` route (`src/ui/Landing.tsx`, `src/ui/styles/landing.css`, every selector scoped under `.landing`) is a full-screen marketing page without the app shell. The installed app still starts at `#/library` through the manifest `start_url`. The landing page may use scroll-linked motion that the rest of the app may not: a progress bar, reveal on scroll, a pinned three-step section and a typed search demo that is labelled sample data. It still bans custom cursors, scroll-jacking, gradients, fake metrics or testimonials. In-page links scroll with script because hash routing owns the URL. All claims must stay true to the shipped behavior. Reduced motion shows every state statically.
