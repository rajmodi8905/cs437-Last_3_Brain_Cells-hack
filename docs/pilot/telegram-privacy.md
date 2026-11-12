# AnyRecall on Telegram: privacy

Pilot version 2.3 · Updated 11 November 2026

This page is for students who use the AnyRecall bot on Telegram. It adds to the pilot Privacy Policy (docs/pilot/privacy-policy.md in the repository) and does not change it for anyone else. AnyRecall is a student project, not an official IIT Gandhinagar service. Using the bot is your choice: if you never open it, nothing on this page applies to you.

## Using the bot is opt-in

When you tap Start, the bot sends a short notice and a **Log in with IITGN** button. It stores nothing you send and searches nothing until you log in with your IITGN Google account and press **Continue** on the page that asks "Link Telegram … to …?". Anything sent before that is not saved; send it again after logging in. The bot only replies to you. It never messages you first and never sends advertising. During the demo the bot may be open only to some accounts; anyone else gets a short "not open yet" reply, and nothing they send is stored.

You must be 18 or older to use the bot.

## Your Telegram chat is linked to your AnyRecall account

Logging in links this Telegram account to your IITGN account in AnyRecall. What you send the bot then goes into that account's cloud library: the same library the app's Auto-sync uses, so the items appear in the app on any device where you sign in and use Auto-sync. One Telegram account is linked to one IITGN account at a time; to use another, send `/logout` first. Linking always needs your IITGN account's own Google sign-in.

Whoever has your Telegram account can use the bot as you, and can open your cloud library from the bot's one-time "Open in browser" links. Each link works once, for 10 minutes; `/logout` makes unused links stop working. Keep your Telegram account secure, and send `/logout` if you lose access to it or no longer want this.

## What is stored

After you log in, our server stores:

- the photos (JPEG, PNG, WebP), PDFs and notes you send or forward to the bot, and links you send on their own, as items in your cloud library, and a record of which items came through Telegram (so `/delete` can erase exactly those);
- the index that makes them searchable (extracted text and OCR, and the numbers the search model computes from it);
- your Telegram user ID, the IITGN account it is linked to (its Google account ID and email), when you linked and to which version of the notice you agreed, your @username if you have one, and whether you sent `/stop`;
- each message's and button tap's ID, and while it is being handled its content, so an update Telegram delivers twice is saved once;
- for a day, which item each search result button points to;
- one-time login and app links, stored only as a fingerprint, for 10 minutes, with your Telegram name (your @username, or else your first name) for the login page.

Voice notes, audio, videos, stickers, locations, contacts and other files (such as Word or PowerPoint) are not saved; the bot says so. Telegram compresses photos sent as photos; send a photo as a file to keep the original.

## Who sees it

Telegram stores chats with bots on its own servers. Chats with bots are cloud chats: they are not end-to-end encrypted, and Telegram passes your messages and files to us. Telegram's own terms and privacy policy cover what Telegram does. In the chat the bot shows your email only in part (for example `s•••a@iitgn.ac.in`).

Our server, on Microsoft Azure, stores and processes your files to make them searchable, and sees the searches you type to the bot, because it searches your library on the server for you (including items you synced from the app). Storage is encrypted at rest but not end to end: the project's operators and the cloud provider can technically access it. We do not use your files or searches for advertising, analytics or training models, and we do not share them with other students.

The AnyRecall app's own promise is unchanged: for students who do not use the bot, files and searches stay on their device, and nothing is uploaded unless they sign in and choose to include their library. Opening the app from the bot does not upload the library already on that device unless you choose "Include this device's library", as for any sign-in.

## Stopping, logging out and deleting

- `/stop` pauses the bot: it saves nothing and replies to nothing except `/resume`. What you saved is kept.
- `/logout` unlinks this Telegram account from your IITGN account and makes its unused links stop working. What you saved stays in your library. The bot then saves nothing until you log in again.
- `/delete`, then **Yes, erase my Telegram items** within 10 minutes, erases the items you saved through Telegram from your cloud library, on every device, with their indexes, and logs the chat out (as `/logout`). Items you added in the app are not touched; to remove your whole cloud library, use **Remove cloud library** in the app's Settings. We keep only the message IDs, so a message Telegram delivers again is not saved again.
- Deleted items can remain in database backups and storage recovery copies for up to 28 days, as described in the pilot Privacy Policy. Copies you made yourself, and Telegram's copies of the chat, are not affected; you can delete the chat in Telegram as well.

## Pilot end

The pilot ends on 6 December 2026 at 17:47 IST (12:17 UTC). The bot stops answering then. Open your library in the app and export anything you need before that date.

## Contact

Send `/help` to the bot for the team's contact email, or report a problem at https://github.com/rajmodi8905/cs437-Last_3_Brain_Cells-hack/issues . Do not post private documents, user IDs or usernames in public issues.
