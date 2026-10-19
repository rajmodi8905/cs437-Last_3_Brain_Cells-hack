# Campus Recall foundation

This checkout contains Nakshatra's foundation package: shared contracts, Dexie persistence, version-1 archive transfer, storage tests, and the unavailable-engine adapter. Product screens, routing, viewers, PWA behavior, extraction, models, and retrieval remain downstream work.

## Setup

Use Node 24 and npm. From a clean checkout:

```text
npm ci
npm run test:fast
npm test
npm run check
npm run build
```

The current tests use fake IndexedDB for isolated repository behavior. Browser persistence and actual model acceptance still require the downstream Playwright/model setup described in `docs/implementation/acceptance.md`; missing model assets are not silently treated as passing.

`npm run dev` starts the minimal foundation entry point. It intentionally does not provide product navigation or a processing engine yet.