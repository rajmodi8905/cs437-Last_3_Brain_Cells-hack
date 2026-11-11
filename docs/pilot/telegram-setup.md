# Telegram setup

How to create the bot for the opt-in Telegram channel ([telegram.md](telegram.md)) with BotFather, try it on a laptop, and then run it on the pilot VM ([deployment.md](deployment.md), "Telegram channel (opt-in)"). No token belongs in this repository, in issues, in pull requests or in a chat: it lives in a private file on the laptop or the VM only. `@<your bot>` below stands for the bot's username.

## 1. Create the bot with BotFather

1. In Telegram, open [@BotFather](https://t.me/BotFather) (check the blue verified mark) and send `/newbot`.
2. Send the bot's **name**, shown in chats (for example "Campus Recall").
3. Send its **username**: unique, ending in `bot`. This is the `@<your bot>` people search for.
4. BotFather answers with the **token** (`<numbers>:<letters>`). Anyone with it controls the bot. Copy it straight into its private file (step 3), never into a chat, issue or terminal command. If it leaks, send `/revoke` to BotFather and replace the file.

Optional, all through BotFather:

- `/setcommands`, then the bot, then this list (the bot answers exactly these):

  ```text
  start - Start, read what is stored and agree
  help - What I can do
  open - Open your library in the app
  privacy - How your data is handled
  stop - Pause the bot
  resume - Resume after stop
  delete - Erase everything you saved here
  ```

- `/setdescription`: what people see before they tap Start, for example "Save photos, PDFs and notes and search them. Tap Start to read what is stored and agree first."
- `/setabouttext`: a one-line profile text, and `/setuserpic`: the bot's picture (for example `public/icon-512.png`).

Bots see only messages sent to them in private chats; the server ignores groups, so no privacy-mode change is needed.

## 2. Find your Telegram user ID (for the demo's allowed list)

`PILOT_TELEGRAM_ALLOWED_USERS` can limit the bot to the team and reviewers. Numeric user IDs are better than usernames, which people can change or give up. To find yours, run the local trial with your @username in the list, send the bot a message, and stop; or ask a trusted ID bot. Do not post IDs in public issues.

## 3. Try it locally (long polling)

The first trial runs on a laptop: the pilot server with the channel on, memory storage, and long polling, so no public address or webhook is needed.

**Private folder.** Keep everything in `~/.config/campus-recall/telegram/`, outside the repository:

| File           | Content                                                                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bot_token`    | the token from BotFather, one line                                                                                                                      |
| `settings.env` | optional `KEY=value` lines: `PILOT_TELEGRAM_CONTACT_EMAIL`, `PILOT_TELEGRAM_ALLOWED_USERS`, `PILOT_TELEGRAM_PRIVACY_URL`, `PILOT_TELEGRAM_NOTICE_VERSION`; other lines are ignored |

```sh
mkdir -p ~/.config/campus-recall/telegram && chmod 700 ~/.config/campus-recall/telegram
pbpaste > ~/.config/campus-recall/telegram/bot_token   # macOS, right after copying the token
chmod 600 ~/.config/campus-recall/telegram/*
```

Write the token with `pbpaste` or an editor, not with `echo`, so it stays out of shell history. An example `settings.env`:

```sh
PILOT_TELEGRAM_CONTACT_EMAIL=you@iitgn.ac.in
PILOT_TELEGRAM_ALLOWED_USERS=@your_username,@teammate
```

**Build once.** With Node 24: `npm ci`, `npm run build`, and for search by meaning `npm run models:download` and `npm run build:engine-host` (without them the bot runs, searching titles only).

**Start the server:**

```sh
npm run pilot:telegram-local
```

`--contact you@iitgn.ac.in` can replace `PILOT_TELEGRAM_CONTACT_EMAIL` in `settings.env`; `--port` changes the port (4600). The script (`pilot/scripts/telegram-local.mjs`) passes the token file to the server by path and never reads, prints or puts the token on a command line. It builds the server bundle and starts it on `127.0.0.1` with `PILOT_TELEGRAM_LOCAL_TRIAL=1`, long polling, memory storage (everything is lost when it stops), no development sign-in, and the privacy link set to `docs/pilot/telegram-privacy.md` on GitHub's `main` unless `settings.env` sets one. Wait for `Telegram bot @… is answering.` (and `Telegram engine host ready in … s.` with the models).

**In Telegram** (phone or desktop): search for `@<your bot>`, open it and tap **Start**. Read the notice and tap **Agree**. Then:

- forward a message, send a photo (as a file to keep its full quality) and a PDF, and send `note Mess timings 8 to 10`; one "Saved … items" confirmation follows;
- type a search, for example `mess timings`, and tap a result: the original comes back with an **Open in app** button;
- `/help`, `/privacy`, `/stop` then `/resume`, and `/delete` then **Yes, erase everything**.

**App links on a phone.** Without `--origin`, `/open` explains that app links need an HTTPS tunnel, because Telegram and a phone cannot open the laptop's `127.0.0.1`. For links, start a tunnel in a second terminal and pass its address:

```sh
cloudflared tunnel --url http://127.0.0.1:4600   # prints https://<random>.trycloudflare.com
npm run pilot:telegram-local -- --origin https://<random>.trycloudflare.com
```

The tunnel only carries the app and the one-time links; Telegram updates still come by long polling. A quick tunnel's address changes every time it starts; restart the server with the new one. The app has no sign-in of its own in a trial: open it from `/open`, press **Continue**, and Settings shows "Signed in as Telegram @<you>" with the bot's items listed.

Stop with Ctrl+C: the server stops polling, sends waiting confirmations, closes Chromium and exits.

Only one process can poll a bot. While the trial runs, do not run a second trial or the VM in polling mode with the same token; and if the VM has set a webhook, a local trial's start removes it (`deleteWebhook`), so set it again by restarting the VM's app afterwards.

## 4. Webhook mode on the VM

On the VM the channel runs in webhook mode: Telegram posts updates to `https://<pilot domain>/api/v1/telegram/webhook` with a secret token, and the server checks it before reading anything.

1. Make a webhook secret: `openssl rand -hex 32` written straight into its file (below).
2. Put the token and the secret into `/etc/campus-recall/secrets/telegram_bot_token` and `telegram_webhook_secret`, and the settings into `.env` ([deployment.md](deployment.md), "Telegram channel (opt-in)").
3. Install `compose.telegram.yaml` next to `compose.yaml` and start the app. At start the server calls `setWebhook` with the pilot's URL, the secret and only `message` and `callback_query` updates, and logs `Telegram webhook set.`

Telegram keeps undelivered updates for 24 hours, so a short restart loses nothing. Switching back to a local trial removes the webhook (`deleteWebhook`); the next start of the VM's app sets it again.

## Rotating the token and secret

- **Token**: `/revoke` in BotFather gives a new one and stops the old one at once. Replace the file (`bot_token` on the laptop, `telegram_bot_token` on the VM) and restart.
- **Webhook secret**: replace the file and restart the app; the server sets the webhook with the new secret at start.

After a suspected leak, revoke the token and look in the server log for refused webhook requests.
