# Browser storage, transfer and recovery, 3 November 2026

Nakshatra's task: deeper real-browser verification of S1, S3, S6 and S12, with minimal fixes for any demonstrated defect. The branch `nakshatra/browser-storage-recovery` starts from main `deaf0091` (PR #25 merge, which already includes PR #24). PR #26 (documentation and dependency updates) was open and is not included; the branch merges with it without conflicts. Raj's earlier note asked for affected regressions to be repeated after PR #24 merged, and this round covers the storage part of that.

**Result:** no product defect was found. Ten new real-browser cases in [`tests/e2e/storage-recovery.spec.ts`](../../tests/e2e/storage-recovery.spec.ts) pass. Each guarded behavior was also checked by removing one guard at a time: the relevant new case failed, and the guard was then restored. No production code changed.

## What the new cases add

Existing coverage was fake-IndexedDB unit tests (concurrent imports, stale claims, cancel/retry, save rollback), a single-tab restore into a second browser profile, and one actual-model interrupt/retry. The new cases run in Chromium against real IndexedDB, mostly with two tabs of one profile. They read every store with the native IndexedDB API and hash originals in the page, instead of trusting repository methods.

- **Production app:** restore, save and the library view go through the real interface on the production preview.
- **Test-only harness:** claims, late publications and injected faults use the harness build (`tests/harness.html`, built into `.cache/acceptance-dist`), because the interface cannot time those steps deterministically. Fault injection exists only inside test code. Nothing is added to production output.

| SPEC | Case | Checks |
| --- | --- | --- |
| S1 | A file saved through Add in one tab | The other open tab shows it without reload. After both tabs close, the item has its exact SHA-256, name, MIME type, title and one queued job. |
| S1 | Fault on the job write during save (harness) | `STORAGE_FAILED`; no item, original or job in either tab or after reopening. |
| S3 | Delete in one tab while another tab holds the processing claim | The late publish, late failure and enqueue are all rejected. The same text is saved again first, as a new item. After reopening, nothing references the deleted item, and the other items are unchanged. |
| S6 | Two tabs restore the same seven-entry archive through Settings | The archive covers six kinds plus a same-bytes pair with different titles. One tab reports 7/0 and the other 0/7. Hashes, titles, capture times, source URLs, original names, MIME types and lengths match the source. All IDs are new; seven queued generation-0 jobs; no segments. |
| S6 | Imports started at the same instant in two tabs (harness) | Same counts and metadata. Exists because the interface case cannot reliably catch an out-of-transaction duplicate check (see below). |
| S6 | Seven invalid archives through Settings, each also carrying a valid new note | Hash mismatch, missing original, version 2, an extra non-original file, repeated ID, `javascript:` URL, truncated ZIP. Each shows an error and leaves the library byte-identical, also after reload. |
| S6 | Fault on the third original write during restore (harness) | The whole restore rejects. After reopening the library is unchanged, and a clean retry imports all seven entries. |
| S6 | Tab closed at 25/50/75/90% of a measured 175-entry restore | Always all or nothing. Both outcomes were observed (below). |
| S12 | Reload during processing | While the processing tab holds the `campus-recall-processor` lock, another tab cannot recover its claim. After the reload releases it, recovery claims the same generation with a new claim ID. The stale claim is rejected before and after the retry publishes; exactly one segment set and no jobs remain. |
| S12 | Recoverable failure, reopen, retry | Failed state and original survive reopening. Retry runs generation 1; the generation-0 claim is rejected; after reopening it is Ready with one segment set. |

S6 restore, S1 durable save and the S3 delete check also feed back into the existing coverage registry (`tests/spec/coverage.json`).

## Guard removal

A disposable script (not committed) changed one guard in `src/storage/index.ts` at a time, rebuilt, ran only the matching new case, and then restored the file. After each run `git diff` was empty.

| Guard removed | Case | Outcome |
| --- | --- | --- |
| Restore duplicate check moved to its own read transaction before the write transaction | Same-instant two-tab import | Failed 3/3 (both tabs imported). The Settings two-tab case still passed 3/3. |
| Restore writes moved outside the transaction | Fault on the third original write | Failed: earlier entries were committed. |
| `deleteItem` no longer deletes the original | Delete during a held claim | Failed: an orphan original remained. |
| `publishSegments` no longer compares the claim ID | Reload during processing | Failed: the stale run published after recovery. |
| Save writes its job in a second transaction | Fault on the job write during save | Failed: the item and original were committed. |

## Observations

- **Close timing:** a full 175-entry restore took 0.7–1.8 s. Closing at 25% and 50% always abandoned it. Closing at 75% sometimes committed, and at 90% usually committed. Every outcome was complete or empty, and this run cannot show exactly which import phase each close interrupted.
- **Freshly written ZIP:** on this Windows machine, a ZIP written to disk moments before `setInputFiles` could not be read by the page, even though the same file restored normally later. A likely cause is antivirus scanning; it wasn't investigated further. The app then reports "Archive is not a valid Campus Recall export.", because a read failure goes to the same message as a malformed archive. The tests now pass archives as in-memory files. This is recorded as an observation, not a reproduced user-facing defect.

## Validation

Environment: Windows 11, Node 24.21.0 (the pinned 24.22.1 was not available), Playwright 1.64.1 Chromium, without model assets.

- `npm run check`, `npm run format:check`, `eslint src tests`, `npm run build`: pass.
- `vitest run`: 84/85. The one failure is `tests/tooling/release.test.ts` creating a symlink, which Windows refuses without Developer Mode or administrator rights (`EPERM`). It is unrelated to this branch.
- `playwright test tests/e2e`: 37/37 (27 existing + 10 new). The new spec alone with `--repeat-each 3`: 30/30.
- Not run: the actual-model acceptance suite (`tests/acceptance`, needs `npm run models:download`), WebKit/Firefox, Android/iPhone, and the pinned Node version.
