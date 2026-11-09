# Campus Recall demo

Use the merged application's local checker or the [deployed pilot](https://campusrecall.indiasouthcentral.cloudapp.azure.com). All supplied course rules, dates, announcements, recordings and drawings are **synthetic demonstration data**, not official IITGN information or interview evidence. Do not import private student material into a public demonstration profile. A demo rehearsal is a procedure, not evidence that every step has passed on a physical phone.

## Prepare

```bash
docker compose up --build --wait
```

Open **http://localhost:4600**. Docker and Git are the only host prerequisites; see the [README](../../README.md#run-locally). Use a separate demo browser profile and choose **Open my library**. In Settings, choose **Download offline search** and finish verification of the roughly 445 MB download. Wait for imported items to become Ready. Keep an export if reusing a demo profile. The full test command is `./test.sh` and needs 10 GB allocated to Docker; starting the app does not require running the test suite.

For a phone, use the deployed HTTPS pilot, then follow [Add to Home Screen / Install app](../../README.md#use-on-your-phone). Open the installed icon before setup. An ordinary HTTP LAN address is insufficient for installation/secure-context checks. The pilot's export deadline is **6 December 2026, 17:47 IST**. Local checker identities are visibly labelled development sign-ins; they do not prove Google authentication. The hosted pilot requires an IITGN Google account.

## Save, then find

1. Import `tests/fixtures/sample-01.jpg`, `sample-03.pdf`, `sample-06.pdf`, `sample-07.png`, `sample-08.png`, `sample-10.m4a`, `sample-11.mp4` and `sample-12.mp4` through the file picker. The app preserves these generic filenames.
2. Add the note: “Meet the mentor at the north library entrance on Tuesday afternoon.” Leave its title blank. Explain that Saved locally appears before Ready.
3. Ask “How many classmates can work together for CS437?” Open the three-page synthetic PDF at page 2 and verify its rule. The app retrieves the original; it does not generate an answer.
4. Ask “How long is the appeal window?” The relevant PDF says “Written objections must arrive within seven calendar days.” This demonstrates retrieval without meaningful shared query words. Open page 2.
5. Ask “Where is our adviser appointment?” Open the saved mentor note. Its display title is derived from the first line, while indexing avoids duplicating that text as metadata.
6. Ask “Find the red backpack on the table” or “Find the bicycle beside the basketball court.” Open the text-free drawing. A visual result has no generated caption.
7. Ask “Where was the recording about collecting the lab access card?” Open the M4A and check the matching playback interval. Playback does not autoplay.
8. Ask “Find the video explaining where theatre rehearsal is.” Verify the relevant spoken interval after the initial silence.
9. Ask “Find the video with a yellow umbrella next to a bicycle.” Open the silent video at its sampled matching scene. Explain the five-second sampling limit.
10. Ask an unrelated fixed negative, such as “Find the sourdough bread recipe I saved.” The app rejects weak matches without claiming the item was never saved.

## Show Local only, offline use and backup

- Once setup is complete, disable network access in browser developer tools or turn Wi-Fi off. Reload, search, open a PDF/image/recording, and inspect the locally preserved original. Cached reads and Blob URLs are local; explicit setup or webpage capture is a separate operation.
- Open Privacy and Terms offline. Explain browser eviction and the difference between the default Local only mode and explicitly included Auto-sync libraries.
- Export an individual item from its viewer, or export the library in Settings. The ZIP is unencrypted and omits models and embeddings. Restore into a separate browser/profile and show a fresh queued item that can already be opened. This demonstrates manual backup/transfer independently of optional Auto-sync.
- Delete an item, reload and verify it stays deleted from this library. Earlier exported ZIPs remain separate copies.

## Show optional Auto-sync on two devices

1. Use two separate browser profiles for the local checker, or the laptop and installed phone app for hosted testing. On each, explicitly choose **Set up Auto-sync**. Locally use the same synthetic IITGN development address; on the hosted pilot use the same real IITGN Google account. Do not mix the local checker and hosted pilot: they have separate storage and identities.
2. On the sender, include only the synthetic demo library through **Include this device's library**. Sign-in alone does not authorize uploading. Wait for the actual synced count. On the receiver, explicitly include its demo library as well.
3. In receiver Settings, find the full title under **In your cloud library**, open the original and download it. Choose **Keep offline** to retain a verified copy on that device.
4. To demonstrate semantic retrieval, finish offline-search setup on both devices and processing on the sender, then wait for its search index to sync. Search on the receiver for the mentor appointment or PDF paraphrase above. Open the matching original at the reported page or interval. A compatible cloud search index can be used without first downloading the original; opening it online fetches the source.
5. Save a new synthetic note on the receiver and confirm the sender receives it. Pause/resume sync and check the displayed state. Keep the app open during processing and sync.
6. Turn the receiver offline, reopen the installed app and open a copy explicitly kept offline. Do not promise offline access to originals that were never downloaded. Reconnect before exporting the cloud library through Settings, then verify the exported originals in a separate restore profile.
7. With a second genuine IITGN account, verify that the first account's cloud library is absent. Development addresses only test the local identity path. Record device/browser versions, build identity and actual results; keep private originals and account details out of public evidence.

Cloud content is not end-to-end encrypted; authorized operators can access it. Export important originals before the pilot deadline. These instructions neither redeploy the service nor extend its lifetime.

## What to say about validation

Use the [verification index](README.md), [Docker checker record](2026-11-08-checker.md), [hosted release](../pilot/2026-11-06-release.md) and [phone checkpoint](../pilot/2026-11-07-phone-check.md). The first corpus evaluation missed one note; that failure and the later timestamp issue were preserved and fixed. Later results are regression evidence from a consumed synthetic corpus, not a general accuracy estimate. Distinguish automated, owner-reported and instrumented physical-device results. Do not claim installation, second-real-account, outside-group usage or peer-review results that have not been recorded.

The course schedules unseen-feature acceptance for **16 November** and demos for **17 November**. Add the assigned feature's specification and tests when it is requested; do not weaken existing frozen assertions to obtain a pass.
