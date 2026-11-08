# Azure pilot deployment

This runbook applies to the separate `pilot/auto-sync` worktree. It does not deploy the completed coursework branch. Record the exact source, local changes, image IDs, archive SHA-256, Azure resource IDs, hostname and actual validation for each release. Creating these files does not itself publish a release.

## Runtime and data

One Linux Azure VM runs three Compose services: Caddy terminates HTTPS, the Node 24 server serves the PWA and `/api`, and PostgreSQL 17 keeps metadata at `/srv/campus-recall/postgres` on the mounted data disk. Caddy state lives under `/srv/campus-recall/caddy`. `PILOT_DATA_DIR` can select another prepared data-disk mount. Refuse startup if the data disk is not mounted; silently writing a fresh database to the OS disk is unsafe. Only Caddy publishes ports 80 and 443. PostgreSQL is on an internal Docker network; the API port is not published. The app joins an outbound-capable network for Google, private Azure Blob and VM managed identity access.

The runtime image includes the built PWA, browser WASM/workers, bundled server and backup CLI. It contains neither source/test directories, the application dependency tree, local libraries, credentials nor model weights. `scripts/prepare-assets.mjs` regenerates browser runtime assets during the image build; the pinned model manifest retains explicit model setup downloads. `.models` is a local test cache and must not enter the image.

Originals/index bundles live in a private Azure Blob container. Database backups go to a separate private container. Use the VM's system-assigned managed identity, with Storage Blob Data Contributor scoped to this pilot's storage account or its required containers. Leave `PILOT_MANAGED_IDENTITY_CLIENT_ID` blank for that identity. Configure Blob versioning and soft-delete retention for both blobs and containers before launch; database backups do not contain original bytes. Account operators can read content; this pilot does not provide end-to-end encryption.

The app opens/migrates PostgreSQL before listening and attempts a database backup at startup, then every 24 hours, retaining the newest 14 logical backups. A healthy HTTP process does not prove a successful backup or available originals: check both explicitly. Preserve the PostgreSQL and Caddy data directories during upgrades; never delete them as a deployment cleanup step.

## Build an immutable candidate

Run from the pilot repository root using Docker BuildKit. On the Mac, build `linux/amd64` for an x86 Azure VM; do not transfer a native `linux/arm64` image to it. Select an image tag for this candidate and use the verified Node 24 base digest recorded in the release evidence:

```sh
docker build --platform linux/amd64 \
  --file pilot/deploy/Dockerfile \
  --build-arg SOURCE_REVISION="$(git rev-parse HEAD)" \
  --tag campus-recall-pilot:RELEASE_ID .
docker image inspect campus-recall-pilot:RELEASE_ID \
  --format '{{.Id}} {{.Architecture}} {{.Config.User}}'
docker save --output /SAFE_RELEASE_DIRECTORY/campus-recall-pilot.tar \
  campus-recall-pilot:RELEASE_ID
shasum -a 256 /SAFE_RELEASE_DIRECTORY/campus-recall-pilot.tar
```

Replace `RELEASE_ID` and the output directory. Prefer an explicit `@sha256:` digest for the reviewed base images, and retain the resolved Node, PostgreSQL and Caddy image digests in the release record. A label naming HEAD alone does not identify uncommitted packaging/source changes: preserve the exact source snapshot and its hash with that candidate. Do not claim an uncommitted image is a clean committed release.

Required checks include `npm test`, `npm run test:pilot:storage`, `npm run test:pilot:e2e`, `npm run check` and `npm run format:check` at the candidate source. Report skipped storage cases, missing model caches, device checks and hosted checks separately from passes. The production image itself must start and serve its runtime assets; host-side tests do not prove it does.

## Host configuration and secrets

After the chosen VM, storage, DNS and spending envelope are authorized and provisioned, copy `compose.yaml` and `Caddyfile` to `/opt/campus-recall`, transfer/load the saved image, and copy `pilot.env.example` to `/opt/campus-recall/.env`. This environment file contains only non-secret settings; protect it with mode `0600`.

Set:

- `PILOT_IMAGE`: exact saved image tag or registry digest.
- `PILOT_DOMAIN`: final registered hostname, without scheme/path.
- `PILOT_GOOGLE_CLIENT_ID`: web OAuth client ID.
- `PILOT_BLOB_ACCOUNT_URL`: exact HTTPS Blob account endpoint.
- `PILOT_POSTGRES_IMAGE` and `PILOT_CADDY_IMAGE`: reviewed image digest references.
- Optional `PILOT_QUOTA_BYTES`: account quota; default 200,000,000 bytes. `PILOT_DATABASE_SCHEMA` defaults to `pilot` and can deliberately select a verified restored schema.

Create `/etc/campus-recall/secrets` owned by root, mode `0700`. Store the current authorized Google OAuth client secret in `google_client_secret`, and an independent strong random database password in `database_password`. Use a secret manager or non-echoing secure input to write them; never place values in shell history, command arguments, Git, image build arguments, screenshots or logs. These two files must be readable by the mounted service users: mode `0444` inside the root-only parent directory works with Compose bind-mounted secrets. Compose grants each file only to its listed service; this is host-file protection, not encrypted secret storage. Keep host/docker administration restricted.

The entrypoint reads mounted files, URL-encodes the database password, and passes the existing server configuration in memory. It never prints values. The database is initialized as database/user `pilot`; its password file must match the existing PostgreSQL data volume on later starts. Changing the file alone does not rotate a PostgreSQL password; perform an explicit database password rotation and restart the app together.

Register the exact Google OAuth callback:

```text
https://YOUR_HOSTNAME/api/v1/auth/google/callback
```

Use a web client and verified IITGN Workspace test accounts. Do not use development signing keys or emulator storage connection strings on a public origin. The server checks Google's signature, audience, verified email and hosted domain; an `hd` request hint alone does not authorize an account.

## Start and verify

On the VM, from `/opt/campus-recall`:

```sh
sudo docker load --input /SAFE_RELEASE_DIRECTORY/campus-recall-pilot.tar
sudo docker compose --env-file /opt/campus-recall/.env config --quiet
sudo docker compose --env-file /opt/campus-recall/.env up --detach --wait
sudo docker compose --env-file /opt/campus-recall/.env ps
sudo docker compose --env-file /opt/campus-recall/.env exec app \
  node /app/entrypoint.mjs /app/server/backup.mjs now
sudo docker compose --env-file /opt/campus-recall/.env exec app \
  node /app/entrypoint.mjs /app/server/backup.mjs verify
```

Verify DNS, a trusted TLS certificate and the canonical stable origin before users sign in. Caddy redirects HTTP to HTTPS and overwrites client-supplied `X-Forwarded-For`; the app trusts only this private proxy. Do not publish the app port or add an unreviewed upstream proxy. Caddy has no HTTP access log and suppresses proxy-error request logging to keep OAuth query strings out of logs. Container diagnostic logs rotate at 10 MB × 3 per service; inspect privately and avoid copying private object IDs into public reports.

Test the actual image on the actual VM: managed identity reaches Blob without storage keys; containers are private; unauthorized API reads fail; API/auth responses have `no-store`; no service worker caches API results; all WASM/workers have correct MIME and complete bytes; HTML/service-worker updates use revalidation. Confirm Google sign-in and Gmail refusal, two IITGN accounts remain isolated, exact original upload/download and ranges work, and another browser can search a synced real index locally. Recreate the app container and restart the VM to check persistence. Inspect the backup manifest/counts, restore into a separate empty schema and verify originals remain reachable. Keep restored data separate from the live app until explicitly selected.

On real phone and laptop, check installation, offline shell/policies, a downloaded original, and foreground sync after reconnect. Emulated browsers do not replace physical-device evidence. Set public pilot start/end dates and export/shutdown notices only after the candidate passes its launch gates.

## Backup, rollback and close

The bundled operator commands are `list`, `now`, `verify`, and `restore <key> [--schema <empty_name>]`. Run them through `/app/entrypoint.mjs` so mounted secret files are applied. Restore refuses non-empty targets; use a fresh database/schema, preserve the current one, check restored row counts and object availability, then deliberately change the live database/schema only after review. The default Compose schema is `pilot`; a restore rehearsal can use a separate schema without changing it. Database backup restoration does not recover hard-deleted original bytes unless Blob soft-delete/versioning retained them.

For an app rollback, set `PILOT_IMAGE` to the prior reviewed image and run `up --detach --wait`; retain the same database and Caddy volumes. Check schema compatibility first: older code may not support newer migrations. Never roll back a database by overwriting the live volume. For end-of-pilot shutdown, provide the promised export window, verify users can retrieve cloud-only originals, apply the disclosed live-data/backup retention, and separately remove or stop billed Azure resources as authorized. Compose shutdown alone does not stop Azure VM/disk/IP/storage charges.

## One-month compute cutoff

The approved operating envelope is $80 for this one-month pilot. The optional $20 reserve is not approved for spending. Before launch, record an exact UTC compute deadline at VM creation plus 30 days and align the user-facing end/export dates with it. A scheduled deallocation controls compute duration; it is not a guarantee that total Azure charges stay under $80.

`pilot/azure/lifecycle.bicep` grants the existing VM's system-assigned identity a custom role containing only `Microsoft.Compute/virtualMachines/deallocate/action`, assigned at that one VM's scope. Its definition is assignable only within the pilot resource group. It grants no start, delete, storage or subscription-management rights. The installer uses VM metadata to refuse a configured resource ID different from its own. It keeps the managed-identity ARM token in process memory, bypasses proxies for IMDS, and never logs tokens, request headers or response bodies.

After reviewing and authorizing the scoped role deployment, apply it from the operator computer and install the timer on the VM:

```sh
az deployment group create --resource-group PILOT_RESOURCE_GROUP \
  --name pilot-compute-cutoff --template-file pilot/azure/lifecycle.bicep \
  --parameters vmName=PILOT_VM_NAME
# Copy install-cutoff.sh to the VM, then run there with the recorded exact values:
sudo bash install-cutoff.sh EXACT_UTC_DEADLINE FULL_VM_RESOURCE_ID
sudo python3 /usr/local/sbin/campus-recall-cutoff.py --check
sudo systemctl list-timers campus-recall-cutoff.timer --no-pager
```

Use the deadline format `YYYY-MM-DDTHH:MM:SSZ`. The installer stores configuration under root-only `/etc/campus-recall/cutoff` and installs `campus-recall-cutoff.service`/`.timer` independently of the app's `.env` and service. The persistent one-time calendar timer catches a missed deadline. A boot check also deallocates a VM restarted after its deadline; before the deadline that check does nothing. Azure HTTP 200/202 means the request succeeded/was accepted, not that the guest has measured final billing state. Network, throttling and transient authorization failures retry briefly; systemd retries a failed service after 15 minutes. Check timer state and the sanitized journal, and verify the final VM status through the operator's Azure account. Do not test the live deallocation action early merely to validate the timer.

This cutoff never deletes data. Disks, the static public IP and Blob storage can continue to incur charges after compute deallocation. Complete the announced export and retention procedure, then tear down those billed resources through a separately reviewed, authorized action. Do not extend the timer or restart past the deadline to consume the reserve without the user's approval.

References: [Docker Compose secrets](https://docs.docker.com/compose/how-tos/use-secrets/), [official PostgreSQL image](https://hub.docker.com/_/postgres), [Caddy reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).

Cutoff references: [Azure VM deallocate API](https://learn.microsoft.com/en-us/rest/api/compute/virtual-machines/deallocate?view=rest-compute-2025-04-01), [Azure instance metadata](https://learn.microsoft.com/en-us/azure/virtual-machines/instance-metadata-service?tabs=linux), [Azure custom roles](https://learn.microsoft.com/en-us/azure/role-based-access-control/custom-roles).
