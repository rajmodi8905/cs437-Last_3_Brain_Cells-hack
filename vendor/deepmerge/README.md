# Build-only deepmerge security fork

This private local package derives from the bundled CommonJS distribution of upstream `deepmerge@4.3.1`. A root file dependency and the npm override `deepmerge: $deepmerge` resolve this fork reproducibly. The current only transitive consumer is `@rollup/plugin-node-resolve`; the override applies to future consumers by package name as well. It is not a new upstream release and is not imported into the application.

- Upstream: https://github.com/TehShrike/deepmerge
- Source artifact: https://registry.npmjs.org/deepmerge/-/deepmerge-4.3.1.tgz
- npm integrity: `sha512-3sUqbMEc77XqpdNO7FRyRog+eW3ph+GYCbj+rK+uYyRMuwsVy0rMiVtPn+QJlKFvWP/1PYpapqYn0Me2knFn+A==`
- Original `dist/cjs.js` SHA-256: `2e5160f84a1141bd927264afe4d15766f1e6cf07daef182b37ff53fea121de7d`
- License: MIT; original copyright and permission are preserved in [LICENSE](LICENSE).
- Advisory: https://github.com/advisories/GHSA-gcqx-w48m-w2h4
- Upstream discussion/reproduction: https://github.com/TehShrike/deepmerge/issues/273

## Local change

The reserved keys `__proto__`, `constructor` and `prototype` are rejected in both target copying and source merging. Writes create explicit own data properties. A throwing target Proxy membership check fails closed; null and primitive merge placeholders still behave as empty targets. Other upstream merge behavior is retained, including arrays, symbols, custom merging and clone options.

This intentionally restricts reserved-key behavior. The actual consumer merges hard-coded resolver defaults; it does not require those keys or accept private library content. Do not use this as a general promise that arbitrary getters, proxies or custom merge callbacks are safe.

The package has its own local name/version to distinguish the reviewed fork from upstream. npm audit does not establish the security of this local source; the exploit regressions and consumer/build checks provide the patch evidence. No advisory is ignored or suppressed.

## Maintenance

Run `npx vitest run tests/tooling/dependencies.test.ts`, `npm run check`, the full suite and both root/subdirectory builds after changes. Remove this override and directory when a verified upstream fix is available and passes those checks. Do not replace it with an old unpatched version merely to avoid an advisory range.
