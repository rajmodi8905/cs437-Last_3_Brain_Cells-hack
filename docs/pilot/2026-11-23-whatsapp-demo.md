# WhatsApp demo record: 23 November 2026

Status: not yet run. This file holds the VM measurements and the phone run for the WhatsApp channel ([whatsapp.md](whatsapp.md)) before the demo on 24 November. Fill in each section with what was actually observed; leave a row as "not measured" rather than estimating. Keep phone observations separate from automated results, as the [7 November phone check](2026-11-07-phone-check.md) does. No phone numbers, tokens, message IDs or private file names belong here.

## Release

| Item                                         | Value |
| -------------------------------------------- | ----- |
| Source revision                              |       |
| Image digest                                 |       |
| Release (manual, migrations 3 and 4)         |       |
| Graph API version in use                     |       |
| Engine host ready time in the log            |       |
| Models folder checked (`fill-models.mjs`)    |       |
| Webhook saved and verified in Meta (time)    |       |
| App mode in Meta (Development or Live)       |       |

## VM measurements

Measured on the pilot VM (2 vCPU, 8 GiB), with `docker stats` for memory and the server log or a stopwatch for times. Record how each number was taken.

| Measurement                                         | Result | How measured |
| --------------------------------------------------- | ------ | ------------ |
| Index a PDF (pages, time from "Saved" to searchable) |        |              |
| Index a photo (time from "Saved" to searchable)     |        |              |
| Search reply time (message sent to list received)   |        |              |
| Peak memory, app container (Node plus Chromium)     |        |              |
| Memory left on the VM at that peak                  |        |              |
| PostgreSQL container memory at that peak            |        |              |

## Automated results

Pass counts at the released revision (from the pull request or CI run):

| Command                       | Result |
| ----------------------------- | ------ |
| `npm run test:pilot`          |        |
| `npm run test:pilot:storage`  |        |
| `npm run test:pilot:e2e`      |        |
| `npm run test:pilot:models`   |        |
| `./test.sh`                   |        |

## Phone run (observed)

From the allow-listed phones. Note the phone model, WhatsApp version and who ran each step.

| Step                                                         | Observed |
| ------------------------------------------------------------ | -------- |
| First message gets the notice once                           |          |
| `AGREE`                                                      |          |
| Forward a poster photo: one confirmation                     |          |
| Forward a PDF: confirmation, then searchable                 |          |
| Search: list of results; picked result sends the original    |          |
| "Open in app" link opens the app and shows the item          |          |
| `OPEN`: link opens the app, signed in as the WhatsApp account |          |
| Library listed in the app without including the device's own |          |
| `DELETE ALL`, `CONFIRM DELETE`: items gone, app signed out    |          |
| A second phone sees none of the first phone's items          |          |

## Limits

What this record does not show (for example: only Meta's test number, five allow-listed phones, one VM run).
