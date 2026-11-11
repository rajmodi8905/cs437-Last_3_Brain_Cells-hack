# WhatsApp setup

How to connect the opt-in WhatsApp channel ([whatsapp.md](whatsapp.md)) to Meta's WhatsApp Cloud API with Meta's free test number, try it on a laptop first, and then turn it on for the pilot ([deployment.md](deployment.md), "WhatsApp channel (opt-in)"). No credential values belong in this repository, in issues or in pull requests: they live in private files on the laptop or the VM only.

## What you end up with

| Value                        | Where it comes from                                  | Where it goes (laptop)                       | Where it goes (VM)                                |
| ---------------------------- | ---------------------------------------------------- | -------------------------------------------- | ------------------------------------------------- |
| App ID                       | App settings → Basic                                 | `settings.env`: `META_APP_ID` (notes only)   | not needed                                        |
| App secret                   | App settings → Basic → App secret → Show             | `app_secret` file                            | `/etc/campus-recall/secrets/whatsapp_app_secret`  |
| Verify token                 | You choose it (a long random string)                 | `verify_token` file                          | `/etc/campus-recall/secrets/whatsapp_verify_token` |
| System-user access token     | Business settings → System users                     | `access_token` file                          | `/etc/campus-recall/secrets/whatsapp_access_token` |
| Phone number ID              | WhatsApp → API Setup, under the test number          | `settings.env`: `PILOT_WHATSAPP_PHONE_NUMBER_ID` | `.env`: `PILOT_WHATSAPP_PHONE_NUMBER_ID`      |
| WhatsApp Business Account ID | WhatsApp → API Setup                                 | `settings.env`: `WHATSAPP_BUSINESS_ACCOUNT_ID` (notes only) | not needed                         |
| Test number                  | WhatsApp → API Setup ("From")                        | `settings.env`: `WHATSAPP_TEST_NUMBER` (notes only) | not needed                                 |
| Graph API version            | Optional; the server defaults to `v27.0`             | `settings.env`: `PILOT_WHATSAPP_GRAPH_VERSION` | `.env`: `PILOT_WHATSAPP_GRAPH_VERSION`          |

On 11 November 2026 a call with the team's system-user token returned the test number's details on both `v25.0` (the version in Meta's dashboard samples) and `v27.0`, so the server keeps `v27.0` as its default. Meta's [version table](https://developers.facebook.com/docs/graph-api/changelog/versions) listed `v26.0` (29 July 2026) as its newest entry that day; if a later call refuses `v27.0`, set `PILOT_WHATSAPP_GRAPH_VERSION=v25.0`, which Meta supports until 29 July 2028.

## 1. Meta developer app and test number

1. Sign in at [developers.facebook.com](https://developers.facebook.com) with the account that manages the team's business portfolio, open **My Apps** and choose **Create app**.
2. Name it (for example "Campus Recall pilot"), pick the use case **Connect with customers through WhatsApp**, and select the team's business portfolio (or let Meta create one).
3. Open **WhatsApp → API Setup**. Meta adds a **test number** to a new test WhatsApp Business Account. Note the phone number ID and the WhatsApp Business Account ID shown there.
4. The test number is free: it needs no payment method, and service replies (answers inside the 24-hour window after a student writes) are free up to 1,000 a month per business number. The bot only ever replies, so the demo stays inside that.

## 2. Allow-listed phones

The test number can only message phones on its recipient list, at most five.

1. In **WhatsApp → API Setup**, under **To**, choose **Manage phone number list** and add a phone in international format.
2. WhatsApp sends that phone a code; its owner reads it out and you enter it. Repeat for each phone (for the demo: the three team members and two reviewers).
3. Each person then sends any message to the test number from WhatsApp. That opens the conversation; the bot answers with its consent notice.

## 3. App secret and verify token

1. **App settings → Basic → App secret → Show** (Meta asks for your password). The server uses it to check the `X-Hub-Signature-256` on every delivery. Copy it straight into its private file (below), never into a chat, issue or terminal command.
2. Make a verify token, for example with `openssl rand -hex 16 > verify_token` inside the private folder. Meta sends it back once when you save the webhook, and the server compares it.

## 4. Permanent system-user token

The temporary token on the API Setup page lasts about a day; use a system user's token instead.

1. Open business settings ([business.facebook.com/settings](https://business.facebook.com/settings)) → **Users → System users → Add**. Name it (for example "campus-recall-bot") and give it the **Admin** role.
2. **Assign assets**: the app (**Apps**, full control) and the WhatsApp account (**WhatsApp accounts**, full control).
3. **Generate new token**: choose the app, set the expiry to **Never**, and tick `whatsapp_business_messaging` and `whatsapp_business_management`. Copy the token straight into its private file; Meta shows it once.

## 5. Try it locally (before deploying)

The first trial runs on a laptop: the pilot server with the channel on, memory storage, and an HTTPS tunnel so Meta and the phones can reach it.

**Private folder.** Keep everything in `~/.config/campus-recall/whatsapp/`, outside the repository:

| File           | Content                                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `app_secret`   | the app secret, one line                                                                                                       |
| `verify_token` | the verify token, one line                                                                                                     |
| `access_token` | the system-user token, one line                                                                                                |
| `settings.env` | `KEY=value` lines: `PILOT_WHATSAPP_PHONE_NUMBER_ID`, optionally `PILOT_WHATSAPP_GRAPH_VERSION`, `PILOT_WHATSAPP_CONTACT_EMAIL` and `PILOT_WHATSAPP_PRIVACY_URL`; notes such as `META_APP_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID` and `WHATSAPP_TEST_NUMBER` are ignored |

```sh
mkdir -p ~/.config/campus-recall/whatsapp && chmod 700 ~/.config/campus-recall/whatsapp
chmod 600 ~/.config/campus-recall/whatsapp/*
```

Write the secret files with an editor or by pasting into `pbpaste > file` (macOS), not with `echo`, so the values stay out of shell history.

**Build once.** With Node 24: `npm ci`, `npm run models:download`, `npm run build` and `npm run build:engine-host`.

**Start a tunnel** in a second terminal and leave it running. Either:

```sh
cloudflared tunnel --url http://127.0.0.1:4600   # prints https://<random>.trycloudflare.com
ngrok http 4600                                   # prints https://<random>.ngrok-free.app (free account)
```

A quick tunnel's address changes every time it starts; enter the new one in Meta (step 6) after each restart.

**Start the server:**

```sh
npm run pilot:whatsapp-local -- --origin https://<tunnel host> --contact you@iitgn.ac.in
```

`--contact` can be left out when `settings.env` has `PILOT_WHATSAPP_CONTACT_EMAIL`. The script (`pilot/scripts/whatsapp-local.mjs`) passes the three secret files to the server by path and never reads, prints or puts them on a command line; it reads only the server's own plain settings from `settings.env`. It builds the server bundle and starts it on `127.0.0.1:4600` with:

- `PILOT_ORIGIN` set to the tunnel's address, so the bot's app links work on the phone and the open-link `POST` passes its `Origin` check;
- `PILOT_WHATSAPP_LOCAL_TRIAL=1`, which accepts a public origin with local storage only while the server listens on loopback. Storage is in memory (everything is lost when it stops) unless you set `PILOT_DATABASE_URL` and `PILOT_BLOB_CONNECTION_STRING` for your own local PostgreSQL and Azurite;
- no development sign-in: through a tunnel anyone could use it. The app has no sign-in of its own in a trial; open it from the bot's `OPEN` link. (For a trial without phone links, run with a local origin and development sign-in instead; links then open only on the laptop.)
- the privacy link set to `docs/pilot/whatsapp-privacy.md` on GitHub's `main` unless `settings.env` sets `PILOT_WHATSAPP_PRIVACY_URL`.

It prints the callback URL to paste into Meta. Wait for `WhatsApp engine host ready in … s.` Stop with Ctrl+C: the server sends waiting confirmations, closes Chromium and exits.

## 6. Webhook

Meta checks the callback URL when you save it, so the server must already be running and reachable.

1. **WhatsApp → Configuration → Webhook → Edit**.
2. **Callback URL**: `https://<tunnel host>/api/v1/whatsapp/webhook` for a local trial, or for the pilot `https://campusrecall.indiasouthcentral.cloudapp.azure.com/api/v1/whatsapp/webhook`.
3. **Verify token**: the contents of the verify token file. Choose **Verify and save**. A wrong token gets 403 and Meta refuses to save.
4. Under **Webhook fields**, **Subscribe** to `messages`.
5. Subscribe the app itself to the WhatsApp Business Account. The quickstart test number is often subscribed only to Meta's own "WA DevX Webhook Events 1P App", and then real messages never reach the callback URL even though the webhook is saved. Check, and subscribe if the app is missing, with the system-user token (no values on the command line history if you read them from the files):

   ```bash
   curl -s "https://graph.facebook.com/v25.0/<WABA_ID>/subscribed_apps" -H "Authorization: Bearer $(cat ~/.config/campus-recall/whatsapp/access_token)"
   curl -s -X POST "https://graph.facebook.com/v25.0/<WABA_ID>/subscribed_apps" -H "Authorization: Bearer $(cat ~/.config/campus-recall/whatsapp/access_token)"
   ```

   The list must then include the app's own name and ID.
6. Optionally send a test payload from the same panel; the server answers 200 to it.

Only one callback URL is active per app: moving from the laptop to the VM means saving the VM's URL here (and the VM's verify token, if it differs).

## Development and Live mode

A new app is in **Development** mode. Meta says some webhooks are not sent in Development mode, and in practice only people with a role on the app or on the recipient list reach it, which is what the demo needs. If messages from an allow-listed phone never arrive while the dashboard's test payload does, switch the app to **Live** (App settings → Basic needs a privacy policy URL first: use the same page as `PILOT_WHATSAPP_PRIVACY_URL`). Live mode does not lift the test number's five-recipient limit.

## Rotating the token and app secret

- **Access token**: generate a new token for the system user (step 4), replace the file (`access_token` on the laptop, `whatsapp_access_token` on the VM), restart the server, check a reply arrives, then revoke the old token under the system user.
- **App secret**: **App settings → Basic → Reset**. Deliveries signed with the new secret are refused (403) until the server has it, and Meta retries them, so replace the file and restart promptly.
- **Verify token**: change the file and the value in Meta's webhook settings together, then **Verify and save** again. It is only used for that check.

After a suspected leak, rotate all three and look in the server log for refused deliveries.
