// Local-only synthetic test materials. Never read a browser library or include model weights.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { zipSync, strToU8 } from 'fflate';

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--output-dir'))
  throw Error('Usage: npm run qa:prepare -- [--output-dir <new-directory>]');
const output = resolve(args[1] || '.cache/qa-kit');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const corpus = JSON.parse(await readFile('tests/fixtures/corpus.json', 'utf8'));
const freeze = JSON.parse(await readFile('docs/verification/retrieval-freeze.json', 'utf8'));
for (const [file, expected] of Object.entries(freeze.hashes))
  if (sha(await readFile(file)) !== expected)
    throw Error(
      `Frozen retrieval input changed: ${file}. Review it before preparing a QA baseline.`,
    );

const mime = {
  '.jpg': ['image', 'image/jpeg'],
  '.png': ['image', 'image/png'],
  '.webp': ['image', 'image/webp'],
  '.pdf': ['pdf', 'application/pdf'],
  '.mp3': ['audio', 'audio/mpeg'],
  '.m4a': ['audio', 'audio/mp4'],
  '.wav': ['audio', 'audio/wav'],
  '.mp4': ['video', 'video/mp4'],
};
const materials = new Map();
const fixedTime = Date.UTC(2026, 0, 1); // Synthetic capture times, not real user evidence.
const zip = (files) =>
  zipSync(
    Object.fromEntries(
      Object.entries(files).map(([name, bytes]) => [name, [bytes, { mtime: new Date(fixedTime) }]]),
    ),
  );
async function makeLibrary(records, prefix) {
  const files = {};
  const items = [];
  const expected = [];
  for (const [index, record] of records.entries()) {
    const bytes = record.file
      ? await readFile(`tests/fixtures/${record.file}`)
      : strToU8(record.text);
    if (record.sha256 && sha(bytes) !== record.sha256)
      throw Error(`Fixture hash mismatch: ${record.file}`);
    const [kind, mimeType] = record.file
      ? mime[extname(record.file)]
      : [record.kind || 'note', 'text/plain;charset=utf-8'];
    const title =
      record.title ||
      (record.file
        ? record.file.slice(0, -extname(record.file).length)
        : kind === 'webpage'
          ? new URL(record.url).hostname
          : Array.from(record.text.split(/\r?\n/, 1)[0].trim()).slice(0, 120).join(''));
    const id = `${prefix}0000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
    const item = {
      id,
      kind,
      title,
      mimeType,
      originalName: record.file,
      byteLength: bytes.length,
      contentSha256: sha(bytes),
      createdAt: fixedTime + index,
      sourceUrl: record.url,
      originalPath: `originals/${id}`,
    };
    items.push(item);
    files[item.originalPath] = bytes;
    expected.push({
      ...record,
      kind,
      title,
      sourceUrl: record.url,
      sha256: item.contentSha256,
      bytes: bytes.length,
      syntheticCreatedAt: item.createdAt,
      intervalUnit: record.interval ? 'seconds' : undefined,
    });
    if (record.file) materials.set(`originals/${record.file}`, bytes);
  }
  const manifest = { format: 'campus-recall', version: 1, exportedAt: fixedTime, items };
  return {
    manifest,
    files,
    expected,
    archive: zip({ ...files, 'manifest.json': strToU8(JSON.stringify(manifest)) }),
  };
}

const library = await makeLibrary([...corpus.targets, ...corpus.distractors], '1000');
materials.set('library-30.zip', library.archive);
const sameTitle = await makeLibrary(
  [
    {
      id: 'T1',
      title: 'Same display title',
      text: 'Synthetic first original. Collect the blue folder from room 12.',
    },
    {
      id: 'T2',
      title: 'Same display title',
      text: 'Synthetic second original. Collect the green folder from room 24.',
    },
  ],
  '2000',
);
materials.set('same-title.zip', sameTitle.archive);
const exploratory = await makeLibrary(
  [
    {
      id: 'X1',
      text: 'Synthetic: Return the loaned microscope to the optics desk before Friday noon.',
      query: 'Where do I hand back the borrowed microscope?',
    },
    {
      id: 'X2',
      text: 'Synthetic: The astronomy club telescope viewing is postponed to Sunday at the rooftop observatory.',
      query: 'Find the update about the stargazing session.',
    },
    {
      id: 'X3',
      kind: 'webpage',
      url: 'https://example.test/exploratory/03',
      text: 'Synthetic: Collect replacement hostel access cards from the housing counter with your student identity card.',
      query: 'Find the instructions for replacing a dorm entry card.',
    },
  ],
  '3000',
);
materials.set('exploratory.zip', exploratory.archive);

const longTitle = 'A'.repeat(120);
const longNote = 'Synthetic long note. '.repeat(1000).slice(0, 20_000);
const ui = await makeLibrary(
  [
    {
      id: 'UI1',
      title: longTitle,
      text: 'Synthetic source for the maximum-length title. Keep this original distinct.',
    },
    { id: 'UI2', title: 'Long note boundary', text: longNote },
    {
      id: 'UI3',
      title: 'Unicode and source content',
      text: 'Synthetic user content: café, नमस्ते, 漢字, and a quoted em dash — retained exactly.',
    },
  ],
  '4000',
);
materials.set('ui-stress.zip', ui.archive);
materials.set('ui/long-title.txt', strToU8(longTitle));
materials.set('ui/long-note.txt', strToU8(longNote));
materials.set(
  'ui/fallback-text.txt',
  strToU8('Synthetic fallback snapshot: Robotics induction is on Saturday at the north workshop.'),
);
materials.set(
  'ui/snapshot.html',
  strToU8(
    '<title>Synthetic imported snapshot</title><main><p>Robotics induction is on Saturday at the north workshop.</p><script>window.qaImportedScript=true;fetch("http://127.0.0.1:4181/probe")</script><img src="http://127.0.0.1:4181/probe" onerror="window.qaImportedScript=true"></main>',
  ),
);
materials.set(
  'chaitanya-ledger.md',
  strToU8(
    `# Chaitanya UI/PWA run ledger\n\nTester/date/timezone:\nCommit/build URL/local changes:\nDevice/OS/browser and browser/installed mode:\nViewport/orientation/input method:\nProfile/model/cache/network/cold-warm state:\n\nRecord actual observations, sanitized screenshots/logs and issue links. Generating this file is not a test run.\n\n| ID | Scenario | Expected | Actual / evidence / attempts | Outcome | Issue / retest |\n| --- | --- | --- | --- | --- | --- |\n| C1 | First use and policy links | Accessible before setup | Not observed | Not run | None |\n| C2 | Save before model setup | Original saved; queued; exact source after reload | Not observed | Not run | None |\n| C3 | Setup/retry/progress | Verified readiness only; no duplicate setup jobs | Not observed | Not run | None |\n| C4 | Long title/note/Unicode | Readable, usable and exact original preserved | Not observed | Not run | None |\n| C5 | Keyboard/focus/reduced motion | Usable controls and focus restoration | Not observed | Not run | None |\n| C6 | Allowed page capture | Exact source text; no script/resource execution | Not observed | Not run | None |\n| C7 | Large page capture | Visible truncation at 20000 code points | Not observed | Not run | None |\n| C8 | Blocked/error/type capture | Honest error; manual fallback remains usable | Not observed | Not run | None |\n| C9 | HTML snapshot | Inert extracted text; no probe execution | Not observed | Not run | None |\n| C10 | Original viewers | Exact item/page/interval; no substitute | Not observed | Not run | None |\n| C11 | Responsive routes | No overflow at 390/768/1440 | Not observed | Not run | None |\n| C12 | Offline shell/policies/original | Production reopen works after caching | Not observed | Not run | None |\n| C13 | Phone/installed PWA | Record real device evidence separately | Not observed | Not run | None |\n| C14 | Policy facts/style review | Matches actual implementation/host; restrictions respected | Not observed | Not run | None |\n| C15 | Update and retest | Library preserved; original reported failure resolved | Not observed | Not run | None |\n\nFor redesign findings record Before | After | Why separately; no private imported files in public evidence.\n`,
  ),
);

const invalid = (name, change) => {
  const manifest = structuredClone(sameTitle.manifest);
  const files = { ...sameTitle.files };
  change(manifest, files);
  materials.set(
    `invalid/${name}.zip`,
    zip({ ...files, 'manifest.json': strToU8(JSON.stringify(manifest)) }),
  );
};
invalid('invalid-version', (manifest) => {
  manifest.version = 999;
});
invalid('invalid-hash', (manifest) => {
  manifest.items[0].contentSha256 = '0'.repeat(64);
});
invalid('missing-original', (manifest, files) => {
  delete files[manifest.items[0].originalPath];
});
invalid('invalid-path', (manifest) => {
  manifest.items[0].originalPath = '../unexpected';
});
materials.set('invalid/corrupt.png', new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
materials.set(
  'invalid/unsupported.txt',
  strToU8('Synthetic unsupported direct file import. Use the Note form instead.'),
);
materials.set('invalid/over-limit-note.txt', strToU8('x'.repeat(20_001)));
for (const name of ['scanned.pdf', 'ocr.webp', 'speech.wav'])
  materials.set(`originals/${name}`, await readFile(`tests/fixtures/${name}`));

const expected = {
  provenance: corpus.provenance,
  evaluation:
    'Original corpus is consumed regression data. Exploratory queries are unmeasured and must not be tuned into acceptance claims.',
  records: library.expected,
  negativeQueries: corpus.negatives,
  sameTitle: sameTitle.expected,
  exploratory: exploratory.expected,
  uiStress: ui.expected,
  phoneTarget: {
    milliseconds: 120_000,
    fixtureFiles: ['sample-01.jpg', 'sample-02.png', 'ocr.webp', 'sample-03.pdf', 'scanned.pdf'],
    scope:
      'Each agreed small image/PDF fixture after setup; record actual reference phone and cold/warm state.',
  },
  archiveNotes:
    'Restoration assigns new UUIDs. Match logical records using original SHA-256, filename/text and independently specified page/interval, not generated archive UUIDs. All capture times are synthetic.',
};
materials.set('expected.json', strToU8(JSON.stringify(expected, null, 2) + '\n'));
materials.set(
  'run-ledger.md',
  strToU8(
    `# QA run ledger\n\nNo tests have been run by generating this file. Copy a scenario row for each actual observation.\n\nTester/date/timezone:\nTested commit and working-tree changes:\nBuild URL and browser/installed mode:\nDevice/RAM/OS/browser versions:\nProfile/cache/model/network state:\n\n| Scenario / SPEC | Fixture/hash | Expected | Actual / timing / attempts | Outcome | Issue / candidate / retest |\n| --- | --- | --- | --- | --- | --- |\n| Not selected | Not recorded | Not recorded | Not observed | Not run | None |\n`,
  ),
);
materials.set(
  'START_HERE.md',
  strToU8(
    `# Synthetic Campus Recall QA kit\n\nUse docs/implementation/nakshatra-quickstart.md in the repository. Nothing here is a real announcement, user library or test result.\n\n1. Open a disposable browser profile at the production app's stable localhost/HTTPS URL.\n2. Save individual supported files from originals/ to exercise Save. For note and webpage input use expected.json's exact text and URL in Add; .txt is not a supported file import.\n3. In Settings restore library-30.zip to prepare all thirty originals. No models or embeddings are included; setup/indexing happens locally. Restore-only checks do not prove manual Save works.\n4. same-title.zip contains two distinct notes with the same display title. Repeating restore should report content duplicates.\n5. Use expected.json for original hashes, queries, PDF pages and media intervals (seconds). Restored UUIDs are new.\n6. Test exploratory.zip separately; its three queries have no measured pass claim and are not part of the frozen corpus.\n7. In a disposable profile, each invalid/*.zip must be rejected without changing existing items. corrupt.png has only a PNG signature: a saved original may fail later decoding and must remain available with a reason. Paste over-limit-note.txt into Add Note to test the character limit. unsupported.txt is deliberately unsupported as a direct file.\n8. originals/scanned.pdf and ocr.webp exercise scanned/OCR paths; speech.wav exercises WAV. Record actual results in run-ledger.md and file distinct defects using the repository issue form.\n\nKeep the app open during processing. Wait for the actual Ready/Failed states; restored Queued does not prove indexing. Physical phone checks require a trusted HTTPS URL reachable from the device, not a Mac localhost URL. Browser/installed caches are separate until observed otherwise.\n`,
  ),
);
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], {
  encoding: 'utf8',
}).trimEnd();
materials.set(
  'baseline.json',
  strToU8(
    JSON.stringify(
      {
        commit,
        workingTreeClean: !status,
        localChangePaths: status ? status.split('\n').map((line) => line.slice(3)) : [],
        node: process.version,
        packageLockSha256: sha(await readFile('package-lock.json')),
        assetPolicySha256: sha(await readFile('scripts/model-assets.json')),
        indexVersion: freeze.indexVersion,
        thresholds: freeze.thresholds,
        frozenInputHashes: freeze.hashes,
        warning:
          'This records source preparation, not a signed hosted-build identity or a test result. Only path names, never private file contents, are inspected by git status.',
      },
      null,
      2,
    ) + '\n',
  ),
);
const inventory = {
  format: 'campus-recall-qa-kit',
  version: 1,
  evidenceStatus: 'Test materials only; no tester results recorded.',
  files: [...materials].map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: sha(bytes) })),
};
// Never remove/overwrite an earlier run ledger. Use --output-dir for the next run.
await mkdir(dirname(output), { recursive: true });
await mkdir(output);
for (const [path, bytes] of materials) {
  await mkdir(dirname(join(output, path)), { recursive: true });
  await writeFile(join(output, path), bytes, { flag: 'wx' });
}
await writeFile(join(output, 'kit-manifest.json'), JSON.stringify(inventory, null, 2) + '\n', {
  flag: 'wx',
});
console.log(`Prepared ${inventory.files.length} synthetic QA artifacts at ${output}`);
console.log(
  'Start with START_HERE.md. No model download, browser data or test results included. Existing output directories are never overwritten.',
);
