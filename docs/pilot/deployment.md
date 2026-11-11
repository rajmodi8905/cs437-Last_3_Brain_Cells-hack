# Azure pilot deployment

This runbook applies to the separate `pilot/auto-sync` worktree. It does not deploy the completed coursework branch. Record the exact source, local changes, image IDs, archive SHA-256, Azure resource IDs, hostname and actual validation for each release. Creating these files does not itself publish a release.

## Runtime and data

One Linux Azure VM runs three Compose services: Caddy terminates HTTPS, the Node 24 server serves the PWA and `/api`, and PostgreSQL 17 keeps metadata at `/srv/campus-recall/postgres` on the mounted data disk. Caddy state lives under `/srv/campus-recall/caddy`. `PILOT_DATA_DIR` can select another prepared data-disk mount. Refuse startup if the data disk is not mounted; silently writing a fresh database to the OS disk is unsafe. Only Caddy publishes ports 80 and 443. PostgreSQL is on an internal Docker network; the API port is not published. The app joins an outbound-capable network for Google, private Azure Blob and VM managed identity access.

The runtime image includes the built PWA, browser WASM/workers, bundled server and backup CLI, and, for the opt-in WhatsApp and Telegram channels, the engine host page (`npm run build:engine-host`, at `/app/engine-host`, never under `dist/`), the three Playwright packages and Playwright's headless Chromium with its Debian libraries. Chromium starts only with the WhatsApp or Telegram settings. The image contains neither source/test directories, the rest of the application dependency tree, local libraries, credentials nor model weights. `scripts/prepare-assets.mjs` regenerates browser runtime assets during the image build; the pinned model manifest retains explicit model setup downloads. `.models` is a local test cache and must not enter the image.

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

## WhatsApp channel (opt-in)

The channel ([whatsapp.md](whatsapp.md)) is off unless `/opt/campus-recall/compose.whatsapp.yaml` is installed next to `compose.yaml`. With that file, `deploy-release.sh` and the commands below use both files; without it, the app runs exactly as before and no Chromium starts. Set up the Meta app first ([whatsapp-setup.md](whatsapp-setup.md)).

**Secrets.** Add three files to `/etc/campus-recall/secrets`, written the same way as the Google secret (mode `0444` inside the root-only directory, no values in shell history, arguments or logs): `whatsapp_verify_token` (the webhook verify token you choose), `whatsapp_app_secret` (App settings → Basic → App secret) and `whatsapp_access_token` (the system-user token). The server reads them from `/run/secrets/…` itself (`PILOT_WHATSAPP_*_FILE`), so they never enter the environment that Chromium inherits. Before starting Chromium the server also removes the Google secret and database URL from its own environment.

**Settings.** Add to `/opt/campus-recall/.env` (see `pilot.env.example`): `PILOT_WHATSAPP_PHONE_NUMBER_ID`, `PILOT_WHATSAPP_PRIVACY_URL` (an HTTPS page with [whatsapp-privacy.md](whatsapp-privacy.md), for example its GitHub URL on `main`), `PILOT_WHATSAPP_CONTACT_EMAIL`, and optionally `PILOT_WHATSAPP_GRAPH_VERSION` (default `v27.0`) and `PILOT_WHATSAPP_NOTICE_VERSION` (default `1`, stored with each consent). The overlay sets `PILOT_ENGINE_HOST_DIST=/app/engine-host`, `PILOT_ENGINE_HOST_MODELS=/app/models` and `PILOT_ENGINE_HOST_STATE_DIR=/app/engine-state`. The server refuses to start with only some WhatsApp settings, and on a public origin the channel needs the durable storage the pilot already uses: its state is in the same PostgreSQL schema (migrations 3 and 4) and its files in the same Blob container.

**Data folders.** `/srv/campus-recall/models` holds the pinned model files (about 363 MB), mounted read-only. `/srv/campus-recall/engine-host` (owner uid 1000, mode `0700`) holds Chromium's profile, which the server empties at every start and stop; it is only a model cache and, while one item is being indexed, that item.

**Models.** At each release with the overlay installed, `deploy-release.sh` runs the candidate image once with network access, no secrets and only the models folder mounted: `node /app/fill-models.mjs` downloads the files listed in the image's own engine host manifest, checks every file's size and SHA-256 as `npm run models:download` does, and keeps files that already match. A failed check stops the release before anything changes. By hand:

```sh
sudo install -d -m 0755 /srv/campus-recall/models
sudo install -d -m 0700 -o 1000 -g 1000 /srv/campus-recall/engine-host
sudo docker run --rm --read-only --cap-drop ALL --security-opt no-new-privileges --user 0:0 \
  --volume /srv/campus-recall/models:/app/models --entrypoint node IMAGE /app/fill-models.mjs
```

**Resources.** The overlay raises the app's memory limit from 768 MB to 3 GB, its process limit to 1,024 (Chromium's threads count), `/dev/shm` to 512 MB and the stop grace period to 30 seconds. On a Mac, Node plus Chromium peaked at 2.1–2.4 GB summed over processes; PostgreSQL (512 MB), Caddy (128 MB) and the system keep the rest of the VM's 8 GiB. `docker stats` shows the VM's own peak while a file is indexed. If Chromium is killed for memory, the page crash is retried as a failed index job.

**First release with the channel.** Parts 1 and 2 add database migrations 3 and 4, so `deploy-release.sh` refuses the automatic release ("Database migration plan changed; manual release required."). Release that image by hand once, from `/opt/campus-recall`, after the Meta app, secrets, settings and folders are ready:

```sh
COMPOSE='docker compose --env-file /opt/campus-recall/.env -f compose.yaml -f compose.whatsapp.yaml'
sudo $COMPOSE config --quiet
sudo $COMPOSE exec app node /app/entrypoint.mjs /app/server/backup.mjs now
sudo docker pull ghcr.io/rajmodi8905/campus-recall-pilot@sha256:DIGEST
# Fill the models (above), set PILOT_IMAGE in .env to the same digest, then:
sudo $COMPOSE up --detach --wait app
# The Caddyfile changed for the link page (below); copy its contents over the old one in place
# (see the warning below), check that Caddy sees the new file, then reload:
sudo sh -c 'cat Caddyfile.new > /opt/campus-recall/Caddyfile'
sha256sum /opt/campus-recall/Caddyfile
sudo docker exec "$(sudo $COMPOSE ps -q caddy)" sha256sum /etc/caddy/Caddyfile
sudo $COMPOSE exec caddy caddy reload --config /etc/caddy/Caddyfile
sudo $COMPOSE logs app | grep -E 'WhatsApp|engine host'
```

Caddy's headers are defaults now (`?Referrer-Policy`, `?Content-Security-Policy`): the one-time link page keeps its own `Referrer-Policy: same-origin` and CSP. With Caddy's `no-referrer` in its place, browsers send `Origin: null` on the page's Continue `POST` and the server refuses it, so links would never open. Check with `curl -sI https://…/api/v1/whatsapp/open/x`, which must show `Referrer-Policy: same-origin`. `deploy-release.sh` never recreates Caddy, so this copy and reload are manual.

**Warning: copy the Caddyfile's contents, do not replace the file.** `compose.yaml` bind-mounts the single file `./Caddyfile` into the Caddy container. A bind mount of a file follows the file itself (its inode), not its name, so anything that writes a new file under the same name leaves the running container reading the old one: `install`, `mv`, `rsync` without `--inplace`, or an editor that saves by writing a new file and renaming it. `caddy reload` then reloads the old configuration and reports success. This happened in the first Telegram release. Either copy the contents into the existing file (`cat Caddyfile.new > Caddyfile`, which keeps the inode) and reload, or, if the file was replaced, restart the Caddy container (`sudo $COMPOSE restart caddy`) so it mounts the new file. Either way, check that the two hashes above match: `sha256sum /opt/campus-recall/Caddyfile` on the VM and `docker exec … sha256sum /etc/caddy/Caddyfile` inside the container.

The log shows `WhatsApp channel on: Meta's webhook is https://…/api/v1/whatsapp/webhook.` and `WhatsApp engine host ready in … s.` If it shows `The WhatsApp engine host could not start`, the bot still answers: searches are by keyword only and index jobs wait until a later start indexes them. Fix the cause (usually the models folder or memory) and restart the app. Rolling back to an image from before the channel leaves the new tables and columns in place; older code applies only the migrations it knows, so it starts, but check compatibility as for any rollback. After this release, later releases with unchanged migrations go through the workflow again.

**Checks.** With the server up, save the webhook in Meta (Meta calls it to verify, [whatsapp-setup.md](whatsapp-setup.md)). Then, from an allow-listed phone: AGREE, forward a photo and a PDF, search, pick a result, `OPEN` and open the link, `DELETE ALL` and `CONFIRM DELETE`. Record times and memory in the demo record.

**Turning it off.** Remove `compose.whatsapp.yaml` and run `up --detach --wait app` with `compose.yaml` alone. Stored WhatsApp items stay in their vaults until `DELETE ALL` or the pilot's end; the webhook path then answers `NOT_FOUND`. Turn off the webhook in Meta too.

## Telegram channel (opt-in)

The channel ([telegram.md](telegram.md)) is off unless `/opt/campus-recall/compose.telegram.yaml` is installed next to `compose.yaml`. With that file, `deploy-release.sh` and the commands below use it as well (with `compose.whatsapp.yaml` too, if that is installed; the two channels share one engine host). Without it, nothing changes. Create the bot first ([telegram-setup.md](telegram-setup.md)). On the VM it runs in webhook mode, and students link it to their IITGN account with the pilot's own Google sign-in.

**Secrets.** Add two files to `/etc/campus-recall/secrets`, written the same way as the Google secret (mode `0444` inside the root-only directory, no values in shell history, arguments or logs): `telegram_bot_token` (from BotFather) and `telegram_webhook_secret` (for example `openssl rand -hex 32`, written straight into the file). The server reads them from `/run/secrets/…` itself, so they never enter the environment that Chromium inherits, and the token never appears in a URL the server logs. Linking needs no further secret: it uses `google_client_secret` and `PILOT_GOOGLE_CLIENT_ID`, which the pilot already has, and the Google callback already registered (`https://YOUR_HOSTNAME/api/v1/auth/google/callback`); Google returns to the Telegram link page through the server, not through a second callback.

**Settings.** Add to `/opt/campus-recall/.env` (see `pilot.env.example`): `PILOT_TELEGRAM_PRIVACY_URL` (an HTTPS page with [telegram-privacy.md](telegram-privacy.md), for example its GitHub URL on `main`), `PILOT_TELEGRAM_CONTACT_EMAIL`, optionally `PILOT_TELEGRAM_ALLOWED_USERS` (numeric user IDs or @usernames, comma separated, to keep the demo to the team and reviewers) and `PILOT_TELEGRAM_NOTICE_VERSION`. The overlay sets `PILOT_TELEGRAM_BOT_TOKEN_FILE`, webhook mode (`PILOT_TELEGRAM_MODE=webhook`, `PILOT_TELEGRAM_WEBHOOK_SECRET_FILE`) and the engine host folders, and the same memory, process and shared-memory limits as the WhatsApp overlay. Data folders, model filling and resources are as for WhatsApp (above); `deploy-release.sh` fills the models when either overlay is installed. Never set `PILOT_DEV_KEY_FILE` or `PILOT_TELEGRAM_LOCAL_TRIAL` on the VM: the server refuses a development key on a public origin.

**First release with the channel, and with linking.** The channel adds database migration 5 (Telegram's tables), and linking adds migration 6 (`tg_accounts`, `tg_saved`, the purpose, user and message of `tg_links`, and `sessions.via`), so `deploy-release.sh` refuses the automatic release once for each ("Database migration plan changed; manual release required."). Release by hand as for WhatsApp, with the Telegram overlay in `COMPOSE`:

```sh
COMPOSE='docker compose --env-file /opt/campus-recall/.env -f compose.yaml -f compose.telegram.yaml'
# Add -f compose.whatsapp.yaml as well when the WhatsApp channel stays on.
sudo $COMPOSE config --quiet
sudo $COMPOSE exec app node /app/entrypoint.mjs /app/server/backup.mjs now
sudo docker pull ghcr.io/rajmodi8905/campus-recall-pilot@sha256:DIGEST
# Fill the models (above), set PILOT_IMAGE in .env to the same digest, then:
sudo $COMPOSE up --detach --wait app
sudo $COMPOSE logs app | grep -E 'Telegram|engine host'
```

The log shows `Telegram channel on (webhook): https://…/api/v1/telegram/webhook.`, `Telegram bot @… is answering.`, `Telegram webhook set.` and the engine host's ready line. `Telegram setWebhook failed` means Telegram could not be told; check the token and that the pilot's HTTPS address is reachable, then restart the app. The webhook takes no session or CSRF; a request without the right `X-Telegram-Bot-Api-Secret-Token` gets 401 or 403. Caddy needs no change: the Telegram link pages set their own headers, which Caddy's defaults do not override. Backups include the Telegram tables. Rolling back to an image from before linking leaves migration 6's tables and column in place; older code ignores them, but a restore needs the code's own database version.

**Checks.** From an allowed account on a phone: Start (nothing is saved before login: a forwarded message gets "Log in first with /login."), **Log in with IITGN**, Google's account chooser with an IITGN account, back on "Link Telegram … to …?", **Continue**, then "Linked to …" in the chat and the login button gone. A personal Google account must be refused ("not eligible" in Settings). Then forward a message, send a photo as a file and a PDF, search, tap a result, `/open` and open the link (Settings shows the IITGN email; the items appear after "Include this device's library"), `/logout` and `/login` again, and `/delete` and **Yes, erase my Telegram items** (an item added in the app stays).

**Polling instead.** Long polling also works on the VM (`PILOT_TELEGRAM_MODE=polling`, no webhook secret), for example while the domain is unavailable; only one process may poll a bot, so stop any laptop trial with the same token. Starting a polling process removes the webhook. Linking still uses the pilot's Google sign-in.

**Turning it off.** Remove `compose.telegram.yaml` and run `up --detach --wait app` without it. Items saved through Telegram stay in the students' own cloud libraries (they are ordinary items there), and links stop working. Telegram keeps calling the webhook, which then answers `NOT_FOUND`; remove it by restarting a polling trial once, or by revoking the token in BotFather when the bot is retired.

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
