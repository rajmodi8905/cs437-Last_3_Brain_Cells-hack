# Privacy Policy

Pilot version 2.2 · Updated 11 November 2026

AnyRecall is a student project by Raj Modi, Chaitanya and Nakshatra. This policy covers the separate Auto-sync pilot. It does not change the earlier local-only submission. Public launch follows hosted verification. Cloud access and cloud export end on 6 December 2026 at 17:47 IST (12:17 UTC); export your cloud library through Settings before then. This conservative 30-day window starts with Azure VM creation on 6 November 2026, not a claim that public launch has already happened. Do not rely on this experimental service as your only copy of important material.

## Local only

Local only is the default. No account is needed to save, process, search or open a local library. Originals, titles, source URLs, extracted text, transcripts, embeddings and processing records stay in this browser's IndexedDB. Models and runtimes are stored in browser Cache Storage. Local only does not contact the pilot API or initialize sign-in. Set up Auto-sync explicitly contacts the sync service; this choice is remembered here so a previously enabled account can reconnect after a reload. Sign-out clears that choice. Nothing from a local library is uploaded unless you sign in and explicitly include it.

## Optional Auto-sync on Azure

Auto-sync requires a verified IITGN Google Workspace account (@iitgn.ac.in). Google handles sign-in and supplies the pilot server with identity information, including a stable account identifier and email. The server uses a secure session cookie for access; it does not receive your Google password. INSIIT may link to the app but does not sign you in.

Signing in alone does not upload a library. Including this device's library uploads its originals and metadata, including titles, capture times and source URLs, to your account's private vault on Microsoft Azure. Compatible embeddings, extracted text and source locations such as PDF pages or media times also sync, so other signed-in devices can search locally without first downloading originals.

Processing, query embedding and ranking run on your devices. Search queries are not sent to the pilot server. There is no cloud inference. Cloud access is authenticated and uses HTTPS. Azure encrypts stored data at rest, but this is not end-to-end encryption: authorized project operators and the cloud provider can technically access stored content. Someone with access to your browser profile may also access its local library and retained account data.

## Optional WhatsApp bot

The pilot also has a WhatsApp bot for the demo. It is opt-in: it stores nothing until you message it and reply AGREE to its notice, and you must be 18 or older to use it. Everything in this section applies only to students who use the bot; for everyone else the rest of this policy is unchanged.

The bot saves the photos, PDFs and notes you send or forward to it into a private library for your WhatsApp account on the pilot's Azure storage, with your WhatsApp user ID, the phone number WhatsApp gives us, your consent time and each message's ID. Unlike the app, the bot works on the server: our server extracts text and builds the search index for what you send, and sees the searches you type to the bot. WhatsApp (Meta) decrypts messages to the bot to pass them to us and keeps them for up to 30 days, under Meta's own terms. A one-time link (OPEN) opens that library in the app; the app does not upload the library already on your device unless you include it.

STOP pauses the bot. DELETE ALL followed by CONFIRM DELETE erases your bot library, consent, phone number and app links, keeping only message IDs so a repeated delivery is not saved again; backups and recovery copies expire as described below. The bot ends with the pilot on 6 December 2026 at 17:47 IST (12:17 UTC). Details: docs/pilot/whatsapp-privacy.md in the repository, which the bot's PRIVACY command links to.

## Optional Telegram bot

The pilot also has a Telegram bot for the demo. It is opt-in: it stores and searches nothing until you log in from it with your IITGN Google account and confirm linking the chat to that account, and you must be 18 or older to use it. Everything in this section applies only to students who use the bot; for everyone else the rest of this policy is unchanged.

The bot saves the photos, PDFs and notes you send or forward to it into your own AnyRecall cloud library on the pilot's Azure storage (the library the app's Auto-sync uses), with a record of which items came through Telegram, your Telegram user ID, the IITGN account it is linked to, your @username if you have one, your consent time and each message's ID. Unlike the app, the bot works on the server: our server extracts text and builds the search index for what you send, and searches your library for the searches you type to the bot. Telegram stores chats with bots on its own servers; they are not end-to-end encrypted, under Telegram's own terms. One-time links (/open) open your library in the app; the app does not upload the library already on your device unless you include it. Whoever has your linked Telegram account can open your cloud library this way; each link works once for 10 minutes, and /logout stops unused ones.

/stop pauses the bot. /logout unlinks the chat and keeps what you saved. /delete followed by its "Yes, erase my Telegram items" button erases the items you saved through Telegram from your library and unlinks the chat, keeping only message IDs so a repeated delivery is not saved again; the rest of your library stays (remove it with Remove cloud library in the app). Backups and recovery copies expire as described below. The bot ends with the pilot on 6 December 2026 at 17:47 IST (12:17 UTC). Details: docs/pilot/telegram-privacy.md in the repository, which the bot's /privacy command links to.

## Requests and technical records

Opening the hosted app sends ordinary requests to Azure infrastructure. Technical operational records can include IP addresses, request times and errors. No advertising or behavioral analytics is implemented, and the application does not record document titles, extracted content or queries as usage metrics. Counts displayed in Settings describe your library, not a claim about overall adoption.

Explicit offline setup downloads pinned model files from Hugging Face, English OCR data from jsDelivr, and runtime files from the app host. Those providers receive download requests, without your library content or queries. Model downloads are a setup step; inference runs locally. If you add your own search model in Settings, the model ID you type is sent to Hugging Face to look up and download that model's files; the model then runs on this device like the default one, and your library content and queries are never sent.

Capturing a public webpage requests the URL you enter. The destination receives ordinary network information, such as your IP address. Browser rules may block capture; you can paste text or import an inert snapshot instead. Imported HTML never executes. Opening an external source, Google sign-in, the repository or the issue tracker contacts that service under its own policy.

## Pause, downloads and deletion

Pause stops new background sync transfers on this device. It does not delete cloud copies. Sign-out ends this device's cloud session. The sign-out checkbox can additionally remove this account's downloaded originals and sync data here; local library originals remain unless you delete them separately.

Keep offline downloads a verified original into this account's device storage. Remove download deletes that local offline copy, while retaining the cloud item and its searchable catalogue. Deleting a cloud item deletes its active cloud original and index and sends a tombstone to other syncing devices. Removing the cloud library removes its active cloud data and resets the vault so old devices cannot upload without starting again. Earlier manual exports and other independent copies are outside these deletion controls.

Database backups are scheduled daily, keeping the newest 14 backups. Azure Blob soft delete and versioning are part of the deployment configuration: recoverable deleted blobs are retained for 14 days, and old versions are scheduled for removal after 14 days. A previous version can therefore remain recoverable for up to 28 days after replacement, plus lifecycle processing delay. Deletion removes active access before all backup and recovery copies expire. Operators must apply these settings before public launch and remove the pilot resources after the announced shutdown and retention window.

## Export, storage and pilot end

Export cloud library downloads every current cloud original and its metadata in unencrypted ZIP files, with length and SHA-256 verification. Embeddings, model weights and session credentials are excluded. Large libraries are split into archives within local restore limits. Allow multiple downloads when prompted and keep the ZIPs private. Settings can restore each archive into a local library for re-indexing. Export needs a working signed-in connection; a library that changes during export requires a retry.

Browser storage can be cleared or evicted. Persistent storage requests are best-effort; the browser and operating system control backups and permissions. Download and back up important originals before 6 December 2026 at 17:47 IST (12:17 UTC). The service ends then even if public launch occurs later than VM creation. No indefinite cloud availability is promised.

## Contact

Report problems at https://github.com/rajmodi8905/cs437-Last_3_Brain_Cells-hack/issues . Do not attach private documents, credentials or identifying content to public issues. Changes to data handling require an updated policy.
