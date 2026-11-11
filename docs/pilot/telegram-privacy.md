# Campus Recall on Telegram: privacy

Pilot version 2.2 · Updated 11 November 2026

This page is for students who use the Campus Recall bot on Telegram. It adds to the pilot Privacy Policy (docs/pilot/privacy-policy.md in the repository) and does not change it for anyone else. Campus Recall is a student project, not an official IIT Gandhinagar service. Using the bot is your choice: if you never open it, nothing on this page applies to you.

## Using the bot is opt-in

When you tap Start, the bot sends a short notice and stores nothing you send until you tap **Agree** (or reply `AGREE`). Anything sent before that is not saved; send it again after agreeing. The bot only replies to you. It never messages you first and never sends advertising. During the demo the bot may be open only to some accounts; anyone else gets a short "not open yet" reply, and nothing they send is stored.

You must be 18 or older to use the bot.

## What is stored

After you agree, our server stores:

- the photos (JPEG, PNG, WebP), PDFs and notes you send or forward to the bot, and links you send on their own, as items in your own private library;
- the index that makes them searchable (extracted text and OCR, and the numbers the search model computes from it);
- your Telegram user ID, your @username if you have one (used to label app links, for example "Telegram @name"), when you agreed and to which version of the notice, and whether you sent `/stop`;
- each message's and button tap's ID, and while it is being handled its content, so an update Telegram delivers twice is saved once;
- for a day, which item each search result button points to;
- one-time app links, stored only as a fingerprint, for 10 minutes.

Voice notes, audio, videos, stickers, locations, contacts and other files (such as Word or PowerPoint) are not saved; the bot says so. Telegram compresses photos sent as photos; send a photo as a file to keep the original.

## Who sees it

Telegram stores chats with bots on its own servers. Chats with bots are cloud chats: they are not end-to-end encrypted, and Telegram passes your messages and files to us. Telegram's own terms and privacy policy cover what Telegram does.

Our server, on Microsoft Azure, stores and processes your files to make them searchable, and sees the searches you type to the bot, because it searches on the server for you. Storage is encrypted at rest but not end to end: the project's operators and the cloud provider can technically access it. We do not use your files or searches for advertising, analytics or training models, and we do not share them with other students.

The Campus Recall app's own promise is unchanged: for students who do not use the bot, files and searches stay on their device, and nothing is uploaded unless they sign in and choose to include their library.

## Using it in the app

Send `/open` (or tap **Open in app** after a search) for a link that opens your Telegram library in the Campus Recall app. The link works once, for 10 minutes. The app lists and searches your Telegram items without uploading the library already on that device, unless you choose "Include this device's library", as for any account.

## Stopping and deleting

- `/stop` pauses the bot: it saves nothing and replies to nothing except `/resume`. What you saved is kept.
- `/delete`, then **Yes, erase everything** within 10 minutes, erases your library: every saved file, note and index, your consent, your username, your app links and search buttons, and it signs out the app. We keep only the message IDs, so a message Telegram delivers again is not saved again. Your next message gets the notice again.
- Deleted items can remain in database backups and storage recovery copies for up to 28 days, as described in the pilot Privacy Policy. Copies you made yourself, and Telegram's copies of the chat, are not affected; you can delete the chat in Telegram as well.

## Pilot end

The pilot ends on 6 December 2026 at 17:47 IST (12:17 UTC). The bot stops answering then. Open your library in the app and export anything you need before that date.

## Contact

Send `/help` to the bot for the team's contact email, or report a problem at https://github.com/rajmodi8905/cs437-Last_3_Brain_Cells-hack/issues . Do not post private documents, user IDs or usernames in public issues.
