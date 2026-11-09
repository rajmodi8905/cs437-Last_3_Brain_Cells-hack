# Campus Recall automated Azure deployment

This is the operating guide for the proposed GitHub-to-Azure pilot release pipeline. It is deliberately specific about what is implemented in the repository versus what has **not** yet been provisioned or released. It replaces neither the Azure runtime runbook in [`docs/pilot/deployment.md`](docs/pilot/deployment.md) nor the normal review process.

## Status — 9 November 2026, Asia/Kolkata

The automation source was drafted on branch `codex/azure-autodeploy` and is now carried, uncommitted, on top of the UX work in the `codex/mobile-polish` worktree (based on `6f21ac93ec6e93e5f7b71ee73e88eb398277d6a3`). It has not been pushed, reviewed, merged, run in GitHub Actions, or used to deploy the VM.

`main` has moved to `e75b2b6` (PR #45). Neither `codex/mobile-polish` nor the UX work is on `main` yet, and this pipeline deploys only `main`, so they must be merged through a reviewed PR before any of it reaches the pilot.

Rechecked on 9 November 2026 against the combined work: the bundled server's `MIGRATIONS` literal matches the release script's pattern (2 string migrations); the repository's OIDC subject uses immutable IDs with prefix `repo:rajmodi8905@189959158/cs437-Last_3_Brain_Cells-hack@1411565360`; `npm audit --audit-level=low` reports 0 vulnerabilities and `npm run release:check` passes; `shellcheck -S warning` reports nothing for the release script. The VM prerequisites in step 5 (revision label on the running image, cutoff timer, mounted data disk) have **not** been re-verified from this session.

The read-only checks performed while writing this guide found:

- The authenticated GitHub account is `rajmodi8905`; the target repository is public and its default branch is `main`.
- The existing pilot VM `campusrecall-vm` in resource group `campus-recall-pilot-rg` is running. Its public IP at the check was `172.198.78.169`.
- No GitHub environment was returned by the repository environment listing.
- The proposed Azure user-assigned identity `campusrecall-github-deploy` does not exist yet.
- The local Azure CLI identity is `24110282@iitgn.ac.in` in subscription `307305c3-1e38-4fbe-8470-5b75d758232d`, tenant `7c21bd5f-12e7-4869-9a23-9ad39d684f76`.
- The repository has an active branch ruleset. It requires two real approvals; this pipeline must not be merged by bypassing that requirement.
- The GitHub token available for this check lacks `read:packages`, so package existence/visibility was not established. The first published GHCR package must be made public before a VM deployment can succeed.

The local Bicep compiled, the release script passed `bash -n`, and the workflow parsed as YAML. Those are syntax checks only, not a cloud deployment test.

## What the pipeline does

```text
reviewed pull request
        |
        v
main push -> "Verify Campus Recall" CI succeeds for that exact SHA
        |
        v
"Deploy Azure pilot" builds linux/amd64 runtime -> GHCR immutable digest
        |
        v
GitHub OIDC -> narrowly scoped Azure identity -> VM Run Command
        |
        v
VM preflight, backup, compatibility check, switch app image, HTTPS proof
        |
        +--> failure after switch: restore the previous app image and verify it
```

Only the app service is restarted. PostgreSQL, Caddy, durable data, original files, and the VM itself are not recreated by a normal release.

The intended URL remains `https://campusrecall.indiasouthcentral.cloudapp.azure.com`. Google sign-in is part of the application runtime, but OAuth registration and its secret are **not** managed by this deployment workflow.

## Source files and responsibilities

| File                                                                         | Responsibility                                                                                                                   |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| [`.github/workflows/azure-pilot.yml`](.github/workflows/azure-pilot.yml)     | CI-gated build, GHCR publication, Azure OIDC login, Run Command invocation, and public HTTPS verification.                       |
| [`pilot/azure/github-deployment.bicep`](pilot/azure/github-deployment.bicep) | Creates the dedicated Azure identity, its GitHub federated credential, a minimal custom role, and the VM-scoped role assignment. |
| [`pilot/deploy/deploy-release.sh`](pilot/deploy/deploy-release.sh)           | Root-only, host-side release transaction invoked through Azure Run Command.                                                      |
| [`pilot/deploy/compose.yaml`](pilot/deploy/compose.yaml)                     | Existing production Compose topology. It accepts the immutable `PILOT_IMAGE` selected by the release script.                     |
| [`docs/pilot/deployment.md`](docs/pilot/deployment.md)                       | Runtime, backup, recovery, data-handling, and cutoff runbook.                                                                    |

## Security model

### GitHub admission controls

The workflow is allowed to deploy only when all of these hold:

1. It runs in `rajmodi8905/cs437-Last_3_Brain_Cells-hack`.
2. The candidate is the current `main` commit, exactly 40 hexadecimal SHA characters.
3. The latest `push` execution of `Verify Campus Recall` / `ci.yml` for that same SHA completed successfully on `main` in the same repository.
4. It checks this again immediately before contacting the VM, so a queued older workflow cannot overwrite newer `main`.
5. Workflow executions serialize under `campus-recall-azure-pilot`; an existing release is never cancelled halfway through.

Automatic runs come from a successful `workflow_run` event and are additionally disabled until the repository environment variable `PILOT_AUTO_DEPLOY_ENABLED` is set to the literal value `true`. A manual run is permitted only from `main`; it must still pass the exact-CI and current-main checks.

The workflow uses pinned revisions of checkout, GitHub Script, Docker Buildx/login/build-push, and Azure Login actions. It checks out only the already-authorized main SHA and uses a Linux AMD64 image, the platform required by the Azure VM.

### Azure identity and scope

`github-deployment.bicep` creates `campusrecall-github-deploy`, a user-assigned managed identity. It creates no client secret. GitHub authenticates with a short-lived OpenID Connect token whose federated subject must exactly equal the repository's reported immutable environment subject:

```text
repo:rajmodi8905@189959158/cs437-Last_3_Brain_Cells-hack@1411565360:environment:azure-pilot
```

The custom role permits only:

```text
Microsoft.Compute/virtualMachines/read
Microsoft.Compute/virtualMachines/runCommand/action
```

The role assignment is scoped to only the existing `campusrecall-vm`, not the resource group or subscription. It cannot start, deallocate, delete, resize, or create VMs, administer Azure roles, or access storage through ARM.

`RunCommand` is nevertheless privileged: it executes elevated guest code. The real protection is the combination of a protected `main`, two genuine PR approvals, an environment limited to `main`, the exact OIDC subject, exact-SHA CI gating, immutable image digests, and the small VM-only Azure role. Do not grant this identity broader permissions to make a deployment easier.

### Registry and secrets

The workflow publishes `ghcr.io/rajmodi8905/campus-recall-pilot:sha-<40-char-source-sha>` and deploys its returned `@sha256:` digest, never `latest` or a mutable tag. It logs out and performs an anonymous manifest lookup before touching Azure. This proves the VM can pull without a GitHub PAT.

The GHCR package must be public. The source is already public and the runtime image is designed not to contain credentials, data, test directories, dependency source trees, or model weights. Do not put a registry token on the VM as a workaround for a private package.

OAuth and database secrets stay in root-owned files on the VM under `/etc/campus-recall/secrets`; they are not workflow variables, Docker build arguments, image layers, or Run Command arguments. A client secret previously pasted into a chat should be treated as exposed and rotated in Google Cloud before a future public release, even if the current pilot otherwise continues to run.

## One-time setup, in order

These steps mutate Azure or GitHub. They must be performed after the pull request has been reviewed and before enabling automatic deployment. Never copy the values of the environment secrets into this document, a terminal transcript, or a PR.

### 1. Review and merge the automation safely

1. Commit the three automation files and this guide on `codex/azure-autodeploy`.
2. Push the branch and open a PR against `main`.
3. Obtain the repository's two required genuine approvals and merge normally. Do not use a ruleset bypass.
4. Confirm the `Verify Campus Recall` push CI run for the resulting `main` SHA is successful.

The workflow must be on the default branch before it can be dispatched from the Actions UI.

### 2. Create the GitHub environment

Create an environment named `azure-pilot`, restricted to the `main` branch. Do not allow all branches. The environment is part of the OIDC subject, so its spelling is security-sensitive.

Example REST calls, using an authenticated `gh` session:

```sh
gh api --method PUT \
  repos/rajmodi8905/cs437-Last_3_Brain_Cells-hack/environments/azure-pilot \
  -f deployment_branch_policy[protected_branches]=false \
  -f deployment_branch_policy[custom_branch_policies]=true

gh api --method POST \
  repos/rajmodi8905/cs437-Last_3_Brain_Cells-hack/environments/azure-pilot/deployment-branch-policies \
  -f name=main -f type=branch
```

Afterwards, verify the environment and its branch policy with `gh api`. If GitHub changes the REST form encoding accepted by the first command, use the equivalent JSON body shown in GitHub's Environment API rather than weakening the policy.

### 3. Provision the least-privilege Azure identity

First inspect the planned changes:

```sh
az deployment group what-if \
  --resource-group campus-recall-pilot-rg \
  --template-file pilot/azure/github-deployment.bicep \
  --parameters \
    vmName=campusrecall-vm \
    githubSubject='repo:rajmodi8905@189959158/cs437-Last_3_Brain_Cells-hack@1411565360:environment:azure-pilot'
```

Apply only after the output shows the one identity, its federated credential, custom role, and VM-scoped assignment described above:

```sh
az deployment group create \
  --resource-group campus-recall-pilot-rg \
  --name campus-recall-github-deploy-YYYYMMDD \
  --template-file pilot/azure/github-deployment.bicep \
  --parameters \
    vmName=campusrecall-vm \
    githubSubject='repo:rajmodi8905@189959158/cs437-Last_3_Brain_Cells-hack@1411565360:environment:azure-pilot'
```

Capture the `clientId` output through a non-echoing method. The identity's client ID is the only value generated by this deployment; no application secret should appear in the output.

### 4. Configure the environment values

Set the following as `azure-pilot` environment **variables**:

```text
AZURE_RESOURCE_GROUP=campus-recall-pilot-rg
AZURE_VM_NAME=campusrecall-vm
PILOT_AUTO_DEPLOY_ENABLED=false
```

Also set the following as `azure-pilot` environment **variables** (not secrets):

```text
AZURE_CLIENT_ID=<Bicep output clientId>
AZURE_TENANT_ID=<Azure tenant ID>
AZURE_SUBSCRIPTION_ID=<Azure subscription ID>
```

These are identifiers, not credentials: OIDC replaces the client secret. The workflow currently reads `vars.AZURE_CLIENT_ID`, `vars.AZURE_TENANT_ID`, and `vars.AZURE_SUBSCRIPTION_ID`, so configuring them as environment variables is required. `AZURE_RESOURCE_GROUP`, `AZURE_VM_NAME`, and the auto-deploy flag are intentionally variables too. Do not create duplicate/conflicting names as secrets; the Google OAuth secret and database password remain exclusively on the VM.

Leave `PILOT_AUTO_DEPLOY_ENABLED=false` through the first successful proof deployment.

### 5. Confirm VM prerequisites

The existing VM must already have the production layout from the pilot runbook:

```text
/opt/campus-recall/compose.yaml
/opt/campus-recall/.env                  (root-readable only)
/srv/campus-recall                       (mounted durable data disk)
/etc/campus-recall/secrets               (root-owned Google/DB secrets)
/etc/campus-recall/cutoff/config.json    (expected 2026-12-06T12:17:11Z deadline)
```

Its Compose app must be healthy and based on an earlier image with a valid 40-character `org.opencontainers.image.revision` label. The service's cutoff timer must be active, the data disk mounted, and at least 15 minutes must remain before the pilot cutoff. The pipeline intentionally refuses deployment if any of those checks fail.

No inbound SSH rule needs to be opened for this automation. Azure Run Command is the sole remote control path. Do not modify the source-restricted SSH configuration merely to test the pipeline.

## What happens during a release

1. CI authorization picks the exact source SHA and records its CI run ID/attempt.
2. GitHub builds the `runtime` Docker stage for `linux/amd64`, labels it with the source revision, pushes it to GHCR, obtains the registry digest, and proves anonymous access.
3. GitHub obtains a short-lived Azure token via the `azure-pilot` environment OIDC subject.
4. Azure Run Command receives a base64 copy of the release script from the reviewed SHA. It receives only public immutable identifiers: image digest, source SHA, and GitHub run identity. It does not receive the VM environment or secrets.
5. The VM script takes a non-blocking release lock and validates the cutoff, timer, mount, Compose configuration, current healthy app image, and release ordering.
6. It pulls the candidate digest and checks AMD64 architecture and the exact source-revision image label.
7. It extracts and hashes the existing and candidate bundled migration plans in a networkless, read-only, capability-dropped container. Any migration change, malformed bundle, or divergence from the live database history stops the unattended deployment before any switch.
8. It runs and verifies a database backup using the existing app container, keeping private logs under `/opt/campus-recall/releases`.
9. It atomically replaces only `PILOT_IMAGE` in the protected `.env`, runs `docker compose up --detach --no-deps --wait app`, and checks container identity and health.
10. It compares the public HTTPS HTML and first built JavaScript asset against bytes from the new image, then writes a private release record. It retains only a bounded set of old, unreferenced app images; it never runs broad `docker system prune`, force-removes images, or removes volumes.
11. The GitHub runner calls `https://campusrecall.indiasouthcentral.cloudapp.azure.com/api/v1/config` over HTTPS and writes release identity/CI URL to the workflow summary.

If a failure occurs after selecting the new image, the script restores the prior `.env` image selection, starts only the previous app image, and verifies the same public asset proof. If rollback cannot be verified, it records `rollback-failed` and exits non-zero for operator intervention.

## First release procedure

1. Keep automatic deployment disabled.
2. Merge the reviewed workflow and finish the environment, identity, package visibility, and VM prerequisites above.
3. From GitHub Actions, manually run **Deploy Azure pilot** on `main`. The workflow accepts no arbitrary revision: it will refuse any SHA that is not current `main` with a successful exact push CI execution.
4. The first run will build the package. If anonymous GHCR validation fails, mark the newly created `campus-recall-pilot` package public in GitHub Package settings, then rerun the same current-main dispatch. Do not add a registry credential to the VM.
5. Read the run summary, the Azure Run Command result, and the public HTTPS endpoint. Also conduct the product-level device checks from the pilot runbook; a green endpoint alone does not prove sign-in, sync, offline behavior, or user data isolation.
6. Preserve the run URL, source SHA, image digest, backup verification outcome, and any manual device-test evidence in the project checkpoint.
7. Only after that proof is satisfactory set `PILOT_AUTO_DEPLOY_ENABLED=true`. Every future successful main CI execution then becomes a serialized automatic release.

## Manual release or migration change

An application release that changes `MIGRATIONS` is intentionally blocked. This is by design: automatic app rollback cannot make an incompatible database schema safe.

For a migration-bearing release, stop the automatic path and use a reviewed maintenance procedure:

1. Back up and verify the live database and originals.
2. Validate the migration and a restore in a separate schema/database.
3. Record forward and rollback compatibility, downtime expectations, source SHA, candidate digest, and approval.
4. Deploy during a maintenance window using the existing manual runbook, keeping the old image and data intact.
5. Prove application behavior, backup, and restore before considering auto-deploy eligible again.

Similarly, use a reviewed manual process for changes to Compose topology, Caddy, secrets, hostname, storage identity, database credentials, data retention, or the pilot cutoff. These are not safe app-image-only releases.

## Failure handling and rollback

| Symptom                                          | Meaning and response                                                                                                                                                             |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workflow refuses authorization                   | Main moved, CI is missing/failed, manual dispatch is not on main, or the triggering run differs. Start again from a fresh successful `main` CI; do not edit the checks out.      |
| Anonymous manifest check fails                   | GHCR image is not public or unavailable. Set package visibility correctly and rerun; never give the VM a PAT.                                                                    |
| Azure login fails                                | Check the `azure-pilot` environment name/branch policy, immutable OIDC subject, identity client ID, tenant/subscription, and exact VM role scope. Do not broaden the Azure role. |
| Run Command fails before switch                  | Inspect its sanitized output and VM prerequisite state. It should not have altered the selected app image.                                                                       |
| Migration-plan refusal                           | Use the reviewed manual migration procedure. Do not disable the check.                                                                                                           |
| Release reports rolled back                      | Previous app image was restored and HTTPS asset proof passed. Investigate the candidate; leave automatic deployment disabled if the cause is unclear.                            |
| `rollback-failed`                                | Treat as an incident. Avoid further automated releases; use the private VM console/Run Command and the manual recovery runbook. Preserve release records and backup evidence.    |
| Public endpoint fails after a green guest result | Inspect Caddy, DNS/TLS, the exact deployed image identity, and configuration privately. GitHub runner's final HTTPS check makes the overall workflow fail.                       |

Never roll back the PostgreSQL volume by overwriting it. Keep the current database and restore only into a separate, empty target during recovery validation.

## Cost, lifecycle, and scope limits

The approved pilot target is USD 80 for one month; an additional USD 20 is only a possible reserve and is not approved to spend automatically. GitHub Actions on this public repository and public GHCR use are expected to avoid private-package storage/transfer charges, but Azure compute, managed disks, public IP, and Blob storage can still incur charges.

The pipeline will not start a stopped VM, extend the pilot, disable the cutoff, or tear resources down. The existing compute deadline is `2026-12-06T12:17:11Z` (17:47:11 IST). Deallocation ends VM compute but does not end disk, IP, or storage billing. Closing the pilot needs a separately authorized export/retention and Azure teardown procedure.

## Routine operator checklist

Before enabling auto-deploy and after every meaningful release, record:

- GitHub PR, two approval links, merge SHA, CI run URL and result.
- Workflow run URL, exact source SHA, GHCR digest, and whether the public endpoint check passed.
- Azure identity resource/role assignment evidence and environment branch-policy evidence.
- Backup and verification result, private release record path, and any rollback result.
- Device-level sign-in, sync, offline, installability, and data-isolation observations separately from infrastructure health.
- Current spend versus the USD 80 cap and the still-unapproved reserve.

Update the private project `context.md` after every session. It is a local handover and is not automatically synchronized to GitHub or another machine.

## Validation already performed locally

On 9 November 2026, from this branch:

```sh
az bicep build --file pilot/azure/github-deployment.bicep --outdir "$(mktemp -d)"
bash -n pilot/deploy/deploy-release.sh
ruby -e 'require "yaml"; YAML.load_file(".github/workflows/azure-pilot.yml"); puts "workflow YAML parses"'
```

All three completed successfully (the Bicep CLI emitted only an available-version warning). No `what-if`, Azure deployment, GitHub environment creation, GHCR publication, or GitHub Actions deployment has yet been run.

## References

- [Azure GitHub Actions OIDC](https://learn.microsoft.com/en-us/azure/developer/github/connect-from-azure-openid-connect)
- [Azure Run Command for Linux VMs](https://learn.microsoft.com/en-us/azure/virtual-machines/linux/run-command)
- [GitHub Environments](https://docs.github.com/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)
- [GitHub container registry visibility](https://docs.github.com/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
- [Existing pilot runtime runbook](docs/pilot/deployment.md)
