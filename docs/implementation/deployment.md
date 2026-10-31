# Static release preparation

This is a prepared release path, not a deployed service. GitHub Pages is the candidate free host for the repository's project site. No Pages setting, environment, remote branch, deployment or policy publication was changed by preparing these files. The team still needs to select the host, review its policy facts and authorize publication.

## Candidate and limits

The candidate project path is `/cs437-Last_3_Brain_Cells-hack/`, under the repository owner's `github.io` origin. Keep that origin and path stable: changing them creates a different browser library/model cache. Do not promise that a preview library automatically transfers to a hosted origin. Export and restore originals manually; restored items are reindexed.

GitHub documents a [1 GB published-site limit and soft 100 GB/month bandwidth limit](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits). The measured root build is approximately 110.1 MB, with a largest file of approximately 32.2 MB. Exact bytes and hashes come from the artifact checker on each build. Model weights remain on their pinned external public download sources; never copy `.models/` into the site. This is a static app, with no accounts or hosted inference endpoint.

GitHub Pages [logs visitors' IP addresses for security](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages#data-collection). Before a Pages publication, replace the generic hosting paragraph in the policy source with that actual hosting fact and its source, record the actual update date, and have the team review it. Do not claim the host receives private library content. The current generic policy correctly states that no host has yet been designated; preparation alone does not change that fact.

## Build and inspect locally

Use Node 24 and the pinned lockfile. From the approved source checkout:

```bash
npm ci
npm run models:download
npx playwright install chromium
npm run check
npm run format:check
npm run build
npm test
APP_BASE=/cs437-Last_3_Brain_Cells-hack/ npm run build
npm run release:check -- dist /cs437-Last_3_Brain_Cells-hack/
```

The final command is read-only. It verifies exact manifest/runtime hashes, install scope/icons, HTML and service-worker paths, required files, artifact size, and exclusion of QA downloads, certificates, test harnesses, model binaries and unexpected files. It refuses symlinks. It returns the artifact SHA-256 and total bytes. This check cannot establish that authored source contains no private information; reviewers still inspect public changes. It does not test a remote host's actual MIME types, HTTPS or caches.

For a local project-path preview:

```bash
APP_BASE=/cs437-Last_3_Brain_Cells-hack/ npm run preview
```

Open the printed host plus `/cs437-Last_3_Brain_Cells-hack/#/library`. Hash routes require no server rewrite. Use the ordinary `dist/` build, never `.cache/device-session*/app`, acceptance output or the repository root. The device-session snapshots intentionally contain QA downloads and are refused by the release checker.

## Prepared workflow

[The release workflow](../../.github/workflows/release-candidate.yml) is manual only. Commits and PR merges cannot trigger a publication through this workflow. It refuses a selected branch other than `main`, runs checks and the full real-model suite, builds the repository project path, validates it and uploads the production artifact plus source/artifact identities. Its default `publish=false` prepares artifacts only.

After publication is authorized and the team has completed release gates:

1. Verify the intended account is `rajmodi8905`; obtain the required reviews and merge the release changes normally. Do not bypass branch protection.
2. Select GitHub Actions as the Pages source in repository settings, per [GitHub's custom-workflow instructions](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages). Have the repository owner configure the `github-pages` environment to allow only main and require the designated human reviewer. These settings are not created automatically here.
3. Complete policy/hosting review and remaining physical-device gates. Inspect any open tester defects; local test passes do not replace reporter retests.
4. Dispatch “Prepare Campus Recall release” on main with `publish=false` first. Inspect source SHA, artifact SHA and all test results. Confirm the intended base path and absence of a custom-domain mismatch.
5. After explicit publication authorization, dispatch on the same reviewed main with `publish=true`. The job still repeats validation before deployment. Only the publish job receives Pages/id-token write permissions. Approve its protected environment according to team rules.
6. Record the actual deployment URL and commit returned by GitHub. Do not infer a hosted pass from a successful upload alone.

A custom domain, owner-level site or different host needs its own base-path build and policy review; this workflow deliberately prepares the current repository project path.

## Hosted verification

On the exact deployed commit, check:

- HTTPS without warnings; all JS/module/WASM/PDF/media workers load with usable MIME types.
- Direct hash routes, install manifest scope/start URL/icons, Privacy and Terms before setup.
- Explicit complete model setup, including a resume/repair scenario, followed by each supported source type.
- Real paraphrase/visual/speech queries and exact originals/page/timestamp, separately recording media playback and seek behavior.
- Offline reopening and fresh local search in the same browser profile, plus the actual installed PWA. Document browser/PWA library separation rather than assuming it.
- Manual export/restore to a second profile/device, hash preservation and reindexing.
- An update notification that does not reload automatically while saving/processing; originals remain available afterward.

Nakshatra and Chaitanya execute their existing tester scenarios. Raj implements any fixes. Hosted verification remains Not run until publication and real execution.

## Updates and rollback

Back up originals before an update and finish processing. Keep the prior reviewed commit, its lockfile, release identity and a verified build. To roll back, use a reviewed revert PR restoring the previous application source to main, run the same checks and manually publish a new verified artifact after authorization. Do not force-push main or deploy unreviewed arbitrary refs.

A service worker cannot be forced to replace every open client's app immediately. Test that the update notice appears, close/reopen where necessary, and verify the active version before retesting. Asset rollback does not reverse a database migration. The current schema is unchanged by this work; future schema changes require a tested migration/recovery plan. Do not clear the user's site data as a routine rollback step.
