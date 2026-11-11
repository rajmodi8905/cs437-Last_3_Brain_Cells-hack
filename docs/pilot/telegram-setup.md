# Telegram setup

How to create the bot for the opt-in Telegram channel ([telegram.md](telegram.md)) with BotFather, try it on a laptop, and then run it on the pilot VM ([deployment.md](deployment.md), "Telegram channel (opt-in)"). No token belongs in this repository, in issues, in pull requests or in a chat: it lives in a private file on the laptop or the VM only. `@<your bot>` below stands for the bot's username.

## 1. Create the bot with BotFather

1. In Telegram, open [@BotFather](https://t.me/BotFather) (check the blue verified mark) and send `/newbot`.
2. Send the bot's **name**, shown in chats (for example "AnyRecall").
3. Send its **username**: unique, ending in `bot`. This is the `@<your bot>` people search for.
4. BotFather answers with the **token** (`<numbers>:<letters>`). Anyone with it controls the bot. Copy it straight into its private file (step 3), never into a chat, issue or terminal command. If it leaks, send `/revoke` to BotFather and replace the file.

Optional, all through BotFather:

- `/setcommands`, then the bot, then this list (the bot answers exactly these):

  ```text
  start - Start and read what is stored
  login - Link your IITGN account
  help - What I can do
  open - Open your library in the app
  logout - Unlink this chat
  privacy - How your data is handled
  stop - Pause the bot
  resume - Resume after stop
  delete - Erase what you saved here
  ```

- `/setdescription`: what people see before they tap Start, for example "Save photos, PDFs and notes to your AnyRecall library and search them. Tap Start, read what is stored, and log in with your IITGN account."
- `/setabouttext`: a one-line profile text, and `/setuserpic`: the bot's picture (for example `public/icon-512.png`).

Bots see only messages sent to them in private chats; the server ignores groups, so no privacy-mode change is needed.

## 2. Find your Telegram user ID (for the demo's allowed list)

`PILOT_TELEGRAM_ALLOWED_USERS` can limit the bot to the team and reviewers. Numeric user IDs are better than usernames, which people can change or give up. To find yours, run the local trial with your @username in the list, send the bot a message, and stop; or ask a trusted ID bot. Do not post IDs in public issues.

## 3. Try it locally (long polling)

The first trial runs on a laptop: the pilot server with the channel on, memory storage, and long polling, so no public address or webhook is needed.

**Private folder.** Keep everything in `~/.config/anyrecall/telegram/`, outside the repository:

| File           | Content                                                                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bot_token`    | the token from BotFather, one line                                                                                                                      |
| `settings.env` | optional `KEY=value` lines: `PILOT_TELEGRAM_CONTACT_EMAIL`, `PILOT_TELEGRAM_ALLOWED_USERS`, `PILOT_TELEGRAM_PRIVACY_URL`, `PILOT_TELEGRAM_NOTICE_VERSION`; other lines are ignored |

```sh
mkdir -p ~/.config/anyrecall/telegram && chmod 700 ~/.config/anyrecall/telegram
pbpaste > ~/.config/anyrecall/telegram/bot_token   # macOS, right after copying the token
chmod 600 ~/.config/anyrecall/telegram/*
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

`--contact you@iitgn.ac.in` can replace `PILOT_TELEGRAM_CONTACT_EMAIL` in `settings.env`; `--port` changes the port (4600). The script (`pilot/scripts/telegram-local.mjs`) passes the token file to the server by path and never reads, prints or puts the token on a command line. It builds the server bundle and starts it on `127.0.0.1` with `PILOT_TELEGRAM_LOCAL_TRIAL=1`, long polling, memory storage (everything is lost when it stops), development sign-in with a throwaway key in the ignored `.cache/pilot-dev-key/` (made once by `pilot/scripts/dev-key.mjs`), and the privacy link set to `docs/pilot/telegram-privacy.md` on GitHub's `main` unless `settings.env` sets one. Wait for `Telegram bot @… is answering.` (and `Telegram engine host ready in … s.` with the models).

**Why development sign-in.** The bot works on the student's own IITGN account, so linking needs that account's sign-in. Google's OAuth client accepts only the pilot domain's callback, so a laptop cannot use real Google sign-in; the trial uses the development one instead (type an `@iitgn.ac.in` email; the same identity checks refuse other domains). The server allows it only on this trial: listening on loopback, and behind a tunnel only with memory storage, never on a public deployment. While the tunnel runs, anyone who has its address can sign in as any IITGN email, so share it with nobody and stop the trial when done. Real IITGN login is tried on the Azure pilot (section 4).

**Links on a phone.** Login and app links need an HTTPS address, because Telegram and a phone cannot open the laptop's `127.0.0.1`. Without `--origin`, `/start`, `/login` and `/open` explain that. Start a tunnel in a second terminal and pass its address:

```sh
cloudflared tunnel --url http://127.0.0.1:4600   # prints https://<random>.trycloudflare.com
npm run pilot:telegram-local -- --origin https://<random>.trycloudflare.com
```

The tunnel only carries the app and the one-time links; Telegram updates still come by long polling. A quick tunnel's address changes every time it starts; restart the server with the new one.

**In Telegram** (phone or desktop): search for `@<your bot>`, open it and tap **Start**. Read the notice; anything sent now gets "Log in first with /login." and is not saved. Tap **Log in with IITGN**: the browser shows the trial's sign-in page; type your IITGN email, then **Continue** on "Link Telegram @you to you@iitgn.ac.in?". The chat says "Linked to y•••u@iitgn.ac.in" and the login button disappears. Then:

- forward a message, send a photo (as a file to keep its full quality) and a PDF, and send `note Mess timings 8 to 10`; one "Saved … items" confirmation follows;
- type a search, for example `mess timings`, and tap a result: the original comes back with an **Open in browser** button;
- open the app through the tunnel (or **Open in browser**), sign in with the same email if asked, and choose **Include this device's library**: the Telegram items are listed in the cloud library;
- `/help`, `/privacy`, `/stop` then `/resume`, `/logout` then `/login` again, and `/delete` then **Yes, erase my Telegram items** (items you added in the app stay).

Stop with Ctrl+C: the server stops polling, sends waiting confirmations, closes Chromium and exits.

Only one process can poll a bot. While the trial runs, do not run a second trial or the VM in polling mode with the same token; and if the VM has set a webhook, a local trial's start removes it (`deleteWebhook`), so set it again by restarting the VM's app afterwards.

## 4. Webhook mode on the VM

On the VM the channel runs in webhook mode: Telegram posts updates to `https://<pilot domain>/api/v1/telegram/webhook` with a secret token, and the server checks it before reading anything. Linking uses the pilot's existing Google sign-in (`PILOT_GOOGLE_CLIENT_ID` and the `google_client_secret` file, with the callback `https://<pilot domain>/api/v1/auth/google/callback` already registered); nothing about Google changes for Telegram.

1. Make a webhook secret: `openssl rand -hex 32` written straight into its file (below).
2. Put the token and the secret into `/etc/campus-recall/secrets/telegram_bot_token` and `telegram_webhook_secret`, and the settings into `.env` ([deployment.md](deployment.md), "Telegram channel (opt-in)").
3. Install `compose.telegram.yaml` next to `compose.yaml` and start the app. At start the server calls `setWebhook` with the pilot's URL, the secret and only `message` and `callback_query` updates, and logs `Telegram webhook set.`
4. Check real IITGN login from a phone: **Start**, **Log in with IITGN**, Google's account chooser (IITGN accounts only), back on "Link Telegram … to …?", **Continue**, and "Linked to …" in the chat. A personal Gmail account is refused with Settings' "not eligible" message.

Telegram keeps undelivered updates for 24 hours, so a short restart loses nothing. Switching back to a local trial removes the webhook (`deleteWebhook`); the next start of the VM's app sets it again.

## Rotating the token and secret

- **Token**: `/revoke` in BotFather gives a new one and stops the old one at once. Replace the file (`bot_token` on the laptop, `telegram_bot_token` on the VM) and restart.
- **Webhook secret**: replace the file and restart the app; the server sets the webhook with the new secret at start.

After a suspected leak, revoke the token and look in the server log for refused webhook requests.
