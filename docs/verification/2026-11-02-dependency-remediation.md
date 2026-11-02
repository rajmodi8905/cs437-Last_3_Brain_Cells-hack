# Dependency remediation and delegated technical review

Recorded on 2 November 2026, Asia/Kolkata. Raj explicitly authorized fixing the dependency findings, requested an independent subagent review and delegated technical sign-off. Deployment remains excluded.

Final documentation and handover review: 3 November 2026. The full audit was rechecked on 3 November and still reports zero findings. The test results below retain their actual 2 November execution date.

**Status:** Remediation and all final local checks passed. Independent subagent technical review and owner-delegated policy/source sign-off are complete. These are validation-time results; subsequent publication is recorded by the publishing PR. No human GitHub PR approval or deployment is claimed.

## Findings and fixes

The initial full audit reported 20 affected entries: 18 moderate and 2 low, with no high/critical entries. These represented dependency chains from three advisories, not twenty independent bugs. Production-only audit reported zero. The initial report and its earlier successful application tests remain historical evidence in the [freeze checkpoint](2026-11-03-spec-freeze.md).

| Advisory | Actual dependency path | Remediation |
| --- | --- | --- |
| [glob cancellation bypass](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) | Workbox build → glob 11.1.0 | Pin patched `glob@14.0.3` with an npm override. |
| [minimatch pattern amplification](https://github.com/advisories/GHSA-g3hv-75wg-m249) | ESLint/config-array, TypeScript ESLint, glob and FileList → minimatch 10.2.6 / 5.1.9 | Pin patched `minimatch@11.0.4`. Verify the exports and ordinary patterns used by the actual consumers. |
| [deepmerge returned-object prototype poisoning](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) | Workbox build → Rollup node-resolve → deepmerge 4.3.1 | Replace this dependency with a private, explicitly identified local MIT security fork. The latest upstream release remains affected; no upstream patched version is claimed. |

No parent-package downgrades, advisory ignores, force-fixes or application model/threshold changes were used. Runtime dependencies remain pinned to their original versions. The lockfile changes only the affected build dependency graph, its newly required transitive matcher packages and the local fork.

## Local fork and installation

The fork is [`vendor/deepmerge`](../../vendor/deepmerge/README.md), named `@campus-recall/deepmerge@4.3.1-campus.1`. It derives from the exact upstream bundled CommonJS file; its source SHA-256, npm integrity and unchanged MIT license are preserved. It blocks `__proto__`, `constructor` and `prototype` in both target-copy and source-merge loops, creates own data properties for assignments, and fails closed if a target Proxy membership check throws. Null/primitive placeholders, ordinary nested data, arrays, symbols, custom merging and clone options remain covered.

The actual Rollup resolver consumer calls deepmerge over its hard-coded defaults. It does not process private library content. Patching still removes the vulnerable behavior; this is not a general safety guarantee for arbitrary getters, Proxies or custom callbacks.

The root development dependency is `deepmerge: file:vendor/deepmerge`, with `deepmerge: $deepmerge` in overrides. This creates a portable root vendor link for clean installs. The override applies by package name; the current only transitive consumer is node-resolve. An initial nested `file:` override produced an invalid npm 11 lockfile and failed `npm ci`; the rejected lock/logs were retained, and the root dependency/reference replaced that approach. A separate installation probe and the actual isolated candidate both completed `npm ci` successfully.

The final full and production-only audits report **zero findings**. npm audit has no published advisory for the private fork; that alone is not evidence that its implementation is safe. The exploit regressions, source review, actual consumer resolution and build/test outcomes provide that evidence. No advisory was suppressed.

## Security and compatibility evidence

[`tests/tooling/dependencies.test.ts`](../../tests/tooling/dependencies.test.ts) resolves modules through their actual consumers, preventing a test from accidentally exercising an unused copy. Before remediation, three security tests failed and two compatibility tests passed. After remediation, all five pass:

- Nested null/undefined/primitive placeholders and null-prototype targets cannot inherit an injected `admin` value.
- Both input-copy paths reject reserved keys recursively; a malicious target with an own `__proto__` cannot poison the returned object.
- Inherited target keys remain excluded and throwing membership checks fail closed.
- Ordinary resolver options, array concatenation, symbols, custom merge and clone behavior remain usable.
- ESLint's named matcher API, Workbox's sync file enumeration/ignores, and FileList's `match` API produce expected files for the real kinds of brace, extension, directory and dotfile patterns used here.

The independent Codex subagent reproduced the upstream exploit, inspected the exact fork and passed 18 additional assertions. It verified the installed Workbox → resolver path resolves the patched file, the source hash matches the documented upstream artifact, the MIT license is unchanged and the local lock link is portable. It found no blocking patch defect; its final install/test/build conditions have now passed as recorded below. This is an agent technical review, not a human GitHub approval.

The subagent also found a negative-extglob semantic difference between minimatch 5 and 11. The repository's build patterns do not use that syntax. Do not infer universal major-version API equivalence; new pattern/config changes still require review and builds.

Both verification and manual release-preparation workflows now run `npm audit --audit-level=low` after `npm ci`. These workflow files were prepared locally; no remote workflow or deployment was dispatched. The fork has a documented removal path once an upstream fix exists and passes the regressions.

## Post-change candidate and validation

The application baseline remains main `deaf00929b7b7bd0e81a727ec200350995abf69e`. At validation, the dependency follow-up was an uncommitted candidate on `raj_all_fixes`, based on `643fb32b4f2e0fabf3392648685cd166a5aee83f`. The input fingerprint below identifies those tested bytes through subsequent publication; it is not relabeled as main's earlier CI result.

An isolated detached checkout received the current tracked patch, vendor files and new tests. Its 150 recorded source/test/tooling inputs have aggregate SHA-256 **`dcf41ac8e8029cefbed98329f17cd5c0354311334bb706fba5cc14aa00507263`**. The aggregate hashes sorted `{file, sha256}` entries serialized as compact JSON. Node 24.22.1/npm 11.20.0 and Playwright Chromium 156.0.8078.4 were used on the available Mac. Browser plugin unavailable; repository Playwright was used.

Dependencies were installed cleanly. Previously freshly downloaded public pinned model bytes were copied from the earlier readiness checkout and reverified; they were not fetched from scratch a second time. No existing browser library or private phone files were copied. No physical-phone or WebKit work was repeated.

The initial supplementary development smoke overlapped Vite's first lazy-dependency optimization reload and missed a transient saved status. Its failure/log was retained. After waiting for the development page to settle, the same note-save/reload/original flow passed without an application code change. Production smoke also passed independently.

| Check | Actual result |
| --- | --- |
| Isolated `npm ci` and pinned model verification | Passed; valid portable vendor link |
| Full audit and production-only audit | Zero findings in each |
| Focused security/consumer tests | 5 passed; before remediation 3 failed / 2 passed |
| TypeScript, ESLint, product/registry checks | Passed |
| Formatting | Passed |
| Full fast suite | 90 passed across 20 files; 11.96 seconds |
| Production Chromium suite | 27 passed; 46.5 seconds, no failures/skips |
| Actual-model suite | 11 passed; 12.8m, no failures/skips |
| Root and subdirectory builds/artifact checks | Passed |
| Root and subdirectory production smoke | Passed at 1440×900 and 390×900, including offline policy routes and saved originals before models |
| Candidate inputs and retrieval freeze | All 150 recorded inputs unchanged in both checkouts; all 9 frozen retrieval hashes match |
| Workflow YAML | Both parsed successfully; each contains its audit check |

**root artifact:** 43 files, 110,125,013 bytes; inventory SHA-256 `d604a57dab335b8812f8c023245b55f40b1804b56eb34b6113f8629caceb1f62`.

**subpath artifact:** 43 files, 110,125,493 bytes; inventory SHA-256 `317059d0e4daf2233ea41ce605f31193b55f8e4c12774f8f30012059bc30b0e7`.

Both artifacts are byte-for-byte identical to the preserved pre-remediation application builds. This confirms the tooling changes did not alter shipped output in these configurations. Sorted inventories and exact artifact copies are retained externally. Each S9/S10/S11 run processed 30 originals without failures; all twelve required targets ranked first and every fixed negative returned no matches. The consumed-corpus limitation and original R4 miss remain intact.

The sanitized [dependency result summary](2026-11-02-dependency-summary.json) records source identity, audits, independent review, results, artifact hashes and scope. The earlier [readiness summary](2026-11-02-readiness-summary.json) retains its original 85-test baseline rather than being overwritten.


## Sign-off scope

The [policy fact review](2026-11-02-policy-review.md) now records completed Codex review under Raj's explicit delegation. Neither Chaitanya's nor Nakshatra's approval is invented. The subagent's dependency review is recorded as independent agent review. Required human GitHub reviews for any later PR still apply.

Technical remediation is signed off: the local checks above passed, the independent source review approved the exact fork, and delegated policy/source review is complete. Hosting selection, deployment, actual host/MIME/cache validation and publication remain outside this work. The physical phone ZIP restore remains unverified; no assumption or dependency change supplies that missing result.

The implementation and regressions were prepared with Codex, with a separate Codex subagent reviewing the dependency findings and exact fork. Raw logs, rejected installation attempt, probe, candidate fingerprints and artifacts are retained outside public source. No AI author/coauthor Git identity was added.
