# Campus Recall demo

Use a production build on the Mac first. All supplied course rules, dates, announcements, recordings and drawings are **synthetic demonstration data**, not official IITGN information or interview evidence. Do not import private student material into a public demonstration profile.

## Prepare

```bash
nvm use
npm ci
npm run build
npm run preview
```

Open the printed localhost URL. Use a clean browser profile and choose **Open my library**. In Settings, download and verify the local assets. The UI shows the actual manifest size, around 445 MB. Wait for queued items to become Ready. Keep a manual export if reusing a demo profile.

For phone testing, use a separately approved trusted HTTPS deployment. No deployment is supplied or authorized by these demo instructions. An ordinary HTTP LAN address is insufficient for installation/WebGPU secure-context checks.

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

## Show privacy and transfer behavior

- Once setup is complete, disable network access in browser developer tools or turn Wi-Fi off. Reload, search, open a PDF/image/recording, and inspect the locally preserved original. Cached reads and Blob URLs are local; explicit setup or webpage capture is a separate operation.
- Open Privacy and Terms offline. Explain browser eviction, lack of application-level encryption and separate libraries on different devices.
- Export an individual item from its viewer, or export the library in Settings. The ZIP is unencrypted. Restore into a separate browser/profile and show a fresh queued item that can already be opened. This is manual transfer, without automatic sync.
- Delete an item, reload and verify it stays deleted from this library. Earlier exported ZIPs remain separate copies.

## What to say about validation

Use the current verification report. The first corpus evaluation missed one note; that failure and the later timestamp issue were preserved and fixed. Later results are regression evidence from a consumed synthetic corpus, not a general accuracy estimate. Do not claim physical-phone, Safari, installation or peer-review results that the team has not recorded.
