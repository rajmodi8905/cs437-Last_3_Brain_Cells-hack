# AnyRecall on WhatsApp: privacy

Pilot version 2.1 · Updated 11 November 2026

This page is for students who message the AnyRecall bot on WhatsApp. It adds to the pilot Privacy Policy (docs/pilot/privacy-policy.md in the repository) and does not change it for anyone else. AnyRecall is a student project, not an official IIT Gandhinagar service. Using the bot is your choice: if you never message it, nothing on this page applies to you.

## Using the bot is opt-in

The first time you message the bot, it sends a short notice and stores nothing you send until you reply `AGREE`. Anything sent before that is not saved; send it again after agreeing. The bot only replies to you. It never messages you first and never sends advertising.

You must be 18 or older to use the bot.

## What is stored

After you agree, our server stores:

- the photos (JPEG, PNG, WebP), PDFs and notes you send or forward to the bot, and links you send on their own, as items in your own private library;
- the index that makes them searchable (extracted text and OCR, and the numbers the search model computes from it);
- your WhatsApp user ID, the phone number WhatsApp gives us (used to reply and shown masked, for example "WhatsApp ••••1234"), when you agreed and to which version of the notice, and whether you sent `STOP`;
- each message's ID and type, and while it is being handled its content, so a message WhatsApp delivers twice is saved once;
- one-time app links, stored only as a fingerprint, for 10 minutes.

Voice notes, videos, stickers, locations, contacts and other files are not saved; the bot says so.

## Who sees it

WhatsApp normally encrypts chats end to end. A chat with a business that uses Meta's Cloud API, like this bot, is different: WhatsApp (Meta) decrypts your messages to pass them to us, and keeps them for up to 30 days. WhatsApp marks such chats in the app. Meta's own terms and privacy policy cover what Meta does.

Our server, on Microsoft Azure, stores and processes your files to make them searchable, and sees the searches you type to the bot, because it searches on the server for you. Storage is encrypted at rest but not end to end: the project's operators and the cloud provider can technically access it. We do not use your files or searches for advertising, analytics or training models, and we do not share them with other students.

The AnyRecall app's own promise is unchanged: for students who do not use the bot, files and searches stay on their device, and nothing is uploaded unless they sign in and choose to include their library.

## Using it in the app

Send `OPEN` (or tap "Open in app" after a search) for a link that opens your WhatsApp library in the AnyRecall app. The link works once, for 10 minutes. The app lists and searches your WhatsApp items without uploading the library already on that device, unless you choose "Include this device's library", as for any account.

## Stopping and deleting

- `STOP` pauses the bot: it saves nothing and replies to nothing except `START`. What you saved is kept.
- `DELETE ALL`, then `CONFIRM DELETE` within 10 minutes, erases your library: every saved file, note and index, your consent, your phone number and your app links, and it signs out the app. We keep only the message IDs, so a message WhatsApp delivers again is not saved again. Your next message gets the notice again.
- Deleted items can remain in database backups and storage recovery copies for up to 28 days, as described in the pilot Privacy Policy. Copies you made yourself, and Meta's copies of the chat, are not affected.

## Pilot end

The pilot ends on 6 December 2026 at 17:47 IST (12:17 UTC). The bot stops answering then. Open your library in the app and export anything you need before that date.

## Contact

Send `HELP` to the bot for the team's contact email, or report a problem at https://github.com/rajmodi8905/cs437-Last_3_Brain_Cells-hack/issues . Do not post private documents or phone numbers in public issues.
