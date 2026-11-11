/// <reference types="node" />
// W7 with the real engine and pinned models: the server's engine host indexes a fixture PDF and
// photo in headless Chromium, the bundles pass the P05 checks with the app's INDEX_VERSION, the
// host's search finds the PDF at the expected page, and the segments match what the app itself
// stores for the same files. Memory and timings are reported for docs/pilot/whatsapp.md.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  PILOT_INDEX_VERSIONS,
  searchMetadataDigest,
  validateIndexBundle,
  type IndexBundle,
  type IndexSegment,
} from '../contract';
import {
  EngineHostUnavailableError,
  EngineIndexError,
  PlaywrightEngineHost,
  type EngineIndexResult,
  type EngineSearchItem,
} from '../server/whatsapp/engine-host';

// The same file, title and query as the cross-device real-model test (corpus target R3).
const PDF = 'tests/fixtures/sample-03.pdf';
const PDF_SHA256 = '5b124fb2928e9db137ff87b77d6351100f828b9853059733f39e61bab3480374';
const PDF_TITLE = 'Synced synthetic document';
const PDF_QUERY = 'How many classmates can work together for CS437?';
// Corpus target R1: a photo of a notice, searched by its text and its picture.
const IMAGE = 'tests/fixtures/sample-01.jpg';
const IMAGE_TITLE = 'Notice board photo';
const IMAGE_QUERY = 'Find the badminton team registration announcement';
const PDF_ID = '4f0c2a8e-1b7d-4c3e-9a51-2d6e8f0b3c71';
const IMAGE_ID = '9b1e7d24-6a3f-4e8c-b5d0-7c2f1a9e4b63';

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Resident memory of a process and all its descendants, in bytes. */
async function treeRss(rootPid: number) {
  const listing = await new Promise<string>((done, fail) =>
    execFile('ps', ['-axo', 'pid=,ppid=,rss='], (error, out) => (error ? fail(error) : done(out))),
  );
  const rows = listing
    .trim()
    .split('\n')
    .map((line) => line.trim().split(/\s+/).map(Number));
  const tree = new Set([rootPid]);
  for (let grew = true; grew;) {
    grew = false;
    for (const [pid, ppid] of rows)
      if (tree.has(ppid) && !tree.has(pid)) {
        tree.add(pid);
        grew = true;
      }
  }
  return rows.reduce((sum, [pid, , rss]) => (tree.has(pid) ? sum + rss * 1024 : sum), 0);
}

/** Peak memory of the engine host's Chromium and of this Node process, sampled every 200 ms. */
function sampleMemory(host: PlaywrightEngineHost) {
  const peaks = { chromium: 0, node: 0, total: 0 };
  let phase = { chromium: 0, node: 0, total: 0 };
  const timer = setInterval(async () => {
    const pid = host.browserProcessId;
    const chromium = pid ? await treeRss(pid).catch(() => 0) : 0;
    const node = process.memoryUsage().rss;
    for (const target of [peaks, phase]) {
      target.chromium = Math.max(target.chromium, chromium);
      target.node = Math.max(target.node, node);
      target.total = Math.max(target.total, chromium + node);
    }
  }, 200);
  return {
    peaks,
    /** Peaks since the last call. */
    phase() {
      const result = phase;
      phase = { chromium: 0, node: 0, total: 0 };
      return result;
    },
    stop: () => clearInterval(timer),
  };
}

const mb = (bytes: number) => Math.round(bytes / 1_000_000);

async function bundleFor(
  globalId: string,
  bytes: Uint8Array,
  title: string,
  result: EngineIndexResult,
): Promise<IndexBundle> {
  return {
    globalId,
    contentSha256: sha256(bytes),
    searchMetadataDigest: await searchMetadataDigest({ title }),
    indexVersion: result.indexVersion,
    dimension: 768,
    segments: result.segments,
  };
}

/** Sets the app up like a student would, with pinned files answered from the local mirror. */
async function prepareApp(context: BrowserContext, page: Page) {
  const manifest = JSON.parse(await readFile('public/asset-manifest.json', 'utf8')) as {
    assets: { url: string; sha256: string }[];
  };
  const external: string[] = [];
  let setup = true;
  await context.route(/^https?:\/\//, async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1') return route.continue();
    const asset = manifest.assets.find((entry) => entry.url === url.href);
    if (!setup || !asset) {
      external.push(`${route.request().method()} ${url.href}`);
      return route.abort();
    }
    return route.fulfill({
      status: 302,
      headers: {
        location: `http://127.0.0.1:4180/${asset.sha256}`,
        'access-control-allow-origin': '*',
      },
    });
  });
  await page.goto('/#/library');
  await page.getByRole('button', { name: 'Open my library' }).click();
  await page.goto('/#/settings');
  await page.getByRole('button', { name: 'Download offline search', exact: true }).click();
  await expect(page.getByText('Assets verified', { exact: true })).toBeVisible({
    timeout: 180_000,
  });
  setup = false;
  return external;
}

/** Saves a file through the app's Add screen and returns the segments the app stored for it. */
async function appSegments(page: Page, file: string, mimeType: string, title: string) {
  await page.goto('/#/add');
  await page.getByLabel('Choose files to save').setInputFiles({
    name: file.split('/').pop()!,
    mimeType,
    buffer: await readFile(file),
  });
  await page.getByLabel(/^Title/).fill(title);
  await page.getByRole('button', { name: 'Save locally' }).click();
  await expect(page.locator('[data-item-id]').filter({ hasText: title })).toContainText('Ready', {
    timeout: 180_000,
  });
  const itemId = await page
    .locator('[data-item-id]')
    .filter({ hasText: title })
    .getAttribute('data-item-id');
  return page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open('campus-recall');
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });
    try {
      const rows = await new Promise<any[]>((resolve, reject) => {
        const request = db
          .transaction('segments')
          .objectStore('segments')
          .index('itemId')
          .getAll(id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return rows.map((row) => ({
        modality: row.modality,
        location: row.location,
        ...(row.text !== undefined ? { text: row.text } : {}),
        vector: Array.from(row.vector as Float32Array),
        indexVersion: row.indexVersion as string,
      }));
    } finally {
      db.close();
    }
  }, itemId!);
}

const keyOf = (segment: IndexSegment) =>
  `${segment.modality}|${JSON.stringify(segment.location)}|${segment.text ?? ''}`;

/** Pairs segments by modality, location and text; reports the lowest cosine and largest gap. */
function compare(host: IndexSegment[], app: IndexSegment[]) {
  const sorted = (list: IndexSegment[]) =>
    [...list].sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0));
  const a = sorted(host);
  const b = sorted(app);
  let minCosine = 1;
  let maxDifference = 0;
  a.forEach((segment, i) => {
    const other = b[i]?.vector ?? [];
    let dot = 0;
    let na = 0;
    let nb = 0;
    segment.vector.forEach((value, j) => {
      dot += value * other[j];
      na += value * value;
      nb += other[j] * other[j];
      maxDifference = Math.max(maxDifference, Math.abs(value - other[j]));
    });
    minCosine = Math.min(minCosine, dot / Math.sqrt(na * nb));
  });
  return {
    hostKeys: a.map(keyOf),
    appKeys: b.map(keyOf),
    minCosine,
    maxDifference,
    identical: maxDifference === 0,
  };
}

test('W7: the engine host indexes with the app engine and default model, and search finds it', async ({
  browser,
}, testInfo) => {
  test.setTimeout(1_200_000);
  const engineSource = await readFile('src/engine/index.ts', 'utf8');
  const INDEX_VERSION = /export const INDEX_VERSION =\s*'([^']+)'/.exec(engineSource)?.[1];
  expect(INDEX_VERSION).toBeTruthy();
  expect(PILOT_INDEX_VERSIONS).toContain(INDEX_VERSION);
  const pdf = new Uint8Array(await readFile(PDF));
  const image = new Uint8Array(await readFile(IMAGE));
  expect(sha256(pdf)).toBe(PDF_SHA256);

  // Two jobs per browser, so the first search and the second PDF run on restarted browsers.
  const host = new PlaywrightEngineHost({
    distDir: '.cache/engine-host-dist',
    modelsDir: '.models',
    maxJobsPerBrowser: 2,
    log: (message, detail) => console.log(message, detail ?? ''),
  });
  const memory = sampleMemory(host);
  const timings: Record<string, number> = {};
  const phases: Record<string, ReturnType<typeof memory.phase>> = {};
  const timed = async <T>(name: string, work: () => Promise<T>) => {
    memory.phase();
    const started = performance.now();
    const result = await work();
    timings[name] = Math.round(performance.now() - started);
    phases[name] = memory.phase();
    return result;
  };
  try {
    await timed('startAndSetup', () => host.start());
    const pdfResult = await timed('indexPdf', () =>
      host.index({
        bytes: pdf,
        kind: 'pdf',
        mimeType: 'application/pdf',
        title: PDF_TITLE,
        createdAt: 1_762_300_000_000,
      }),
    );
    const imageResult = await timed('indexImage', () =>
      host.index({
        bytes: image,
        kind: 'image',
        mimeType: 'image/jpeg',
        title: IMAGE_TITLE,
        createdAt: 1_762_300_000_000,
      }),
    );

    // P05: the bundles pass the server's checks with exactly the app's current INDEX_VERSION.
    const bundles = {
      pdf: await bundleFor(PDF_ID, pdf, PDF_TITLE, pdfResult),
      image: await bundleFor(IMAGE_ID, image, IMAGE_TITLE, imageResult),
    };
    for (const [bundle, bytes, title] of [
      [bundles.pdf, pdf, PDF_TITLE],
      [bundles.image, image, IMAGE_TITLE],
    ] as const) {
      expect(bundle.indexVersion).toBe(INDEX_VERSION);
      const valid = validateIndexBundle(
        bundle,
        {
          globalId: bundle.globalId,
          contentSha256: sha256(bytes),
          searchMetadataDigest: await searchMetadataDigest({ title }),
        },
        [INDEX_VERSION!],
      );
      expect(valid.ok, JSON.stringify(valid)).toBe(true);
    }
    expect(pdfResult.contentSha256).toBe(PDF_SHA256);
    expect(pdfResult.segments.every((s) => s.location.kind === 'page')).toBe(true);
    expect(imageResult.segments.some((s) => s.modality === 'visual')).toBe(true);

    // The host's search: the app's query embedding and ranking over the stored bundles.
    const items: EngineSearchItem[] = [
      { globalId: PDF_ID, kind: 'pdf', indexVersion: INDEX_VERSION!, segments: pdfResult.segments },
      {
        globalId: IMAGE_ID,
        kind: 'image',
        indexVersion: INDEX_VERSION!,
        segments: imageResult.segments,
      },
    ];
    const pdfHits = await timed('searchAfterRestart', () => host.search(PDF_QUERY, items));
    expect(host.starts).toBe(2);
    expect(pdfHits[0]).toMatchObject({
      globalId: PDF_ID,
      itemId: `cloud:${PDF_ID}`,
      location: { kind: 'page', page: 2 },
    });
    const imageHits = await timed('search', () => host.search(IMAGE_QUERY, items));
    expect(imageHits[0]).toMatchObject({ globalId: IMAGE_ID, location: { kind: 'whole' } });

    // The same original indexed again on the restarted browser gives the same numbers.
    const again = await timed('indexPdfWarm', () =>
      host.index({
        bytes: pdf,
        kind: 'pdf',
        mimeType: 'application/pdf',
        title: PDF_TITLE,
        createdAt: 1_762_300_000_000,
      }),
    );
    expect(host.starts).toBe(3);
    const repeat = compare(pdfResult.segments, again.segments);
    expect(repeat.hostKeys).toEqual(repeat.appKeys);
    memory.stop();
    expect(host.blockedRequests).toEqual([]);

    // Parity with the app itself: the same files saved through the app's Add screen.
    const context = await browser.newContext();
    const page = await context.newPage();
    const external = await prepareApp(context, page);
    const appPdf = await appSegments(page, PDF, 'application/pdf', PDF_TITLE);
    const appImage = await appSegments(page, IMAGE, 'image/jpeg', IMAGE_TITLE);
    expect(external).toEqual([]);
    await context.close();
    expect(new Set([...appPdf, ...appImage].map((s) => s.indexVersion))).toEqual(
      new Set([INDEX_VERSION]),
    );
    const parity = {
      pdf: compare(pdfResult.segments, appPdf),
      image: compare(imageResult.segments, appImage),
    };
    for (const result of Object.values(parity)) {
      expect(result.hostKeys).toEqual(result.appKeys);
      expect(result.minCosine).toBeGreaterThanOrEqual(0.9999);
    }

    const report = {
      indexVersion: INDEX_VERSION,
      segments: { pdf: pdfResult.segments.length, image: imageResult.segments.length },
      pdfLocations: pdfResult.segments.map((s) => s.location),
      pageMsInsideHost: { pdf: pdfResult.ms, image: imageResult.ms, pdfWarm: again.ms },
      timingsMs: timings,
      peakMemoryMB: {
        overall: {
          chromium: mb(memory.peaks.chromium),
          node: mb(memory.peaks.node),
          total: mb(memory.peaks.total),
        },
        byPhase: Object.fromEntries(
          Object.entries(phases).map(([name, peak]) => [
            name,
            { chromium: mb(peak.chromium), node: mb(peak.node), total: mb(peak.total) },
          ]),
        ),
      },
      search: {
        pdf: pdfHits.map((hit) => ({ ...hit, excerpt: hit.excerpt?.slice(0, 80) })),
        image: imageHits.map((hit) => ({ ...hit, excerpt: hit.excerpt?.slice(0, 80) })),
      },
      parity: {
        pdf: {
          count: appPdf.length,
          minCosine: parity.pdf.minCosine,
          maxDifference: parity.pdf.maxDifference,
          identical: parity.pdf.identical,
        },
        image: {
          count: appImage.length,
          minCosine: parity.image.minCosine,
          maxDifference: parity.image.maxDifference,
          identical: parity.image.identical,
        },
        repeatOnRestartedHost: {
          minCosine: repeat.minCosine,
          maxDifference: repeat.maxDifference,
          identical: repeat.identical,
        },
      },
      browserStarts: host.starts,
      blockedRequests: host.blockedRequests,
      platform: `${process.platform} ${process.arch}`,
    };
    await testInfo.attach('engine-host-report', {
      body: JSON.stringify(report, null, 2),
      contentType: 'application/json',
    });
    console.log('ENGINE HOST REPORT', JSON.stringify(report));
  } finally {
    memory.stop();
    await host.close();
  }
});

test('W7: a job over its time limit fails as transient and the next job gets a fresh browser', async () => {
  test.setTimeout(600_000);
  const host = new PlaywrightEngineHost({
    distDir: '.cache/engine-host-dist',
    modelsDir: '.models',
    jobTimeoutMs: 1,
  });
  try {
    await host.start();
    const first = host.browserProcessId;
    expect(first).toBeGreaterThan(0);
    const input = {
      bytes: new Uint8Array(await readFile(PDF)),
      kind: 'pdf' as const,
      mimeType: 'application/pdf',
      title: PDF_TITLE,
      createdAt: 1_762_300_000_000,
    };
    await expect(host.index(input)).rejects.toBeInstanceOf(EngineHostUnavailableError);
    // The timed-out browser is gone; the next job starts another one.
    expect(host.browserProcessId).toBeUndefined();
    await expect(host.index(input)).rejects.toBeInstanceOf(EngineHostUnavailableError);
    expect(host.starts).toBe(2);
    expect(host.blockedRequests).toEqual([]);
  } finally {
    await host.close();
  }
});

test('W7: an original the engine cannot read is refused as permanent', async () => {
  test.setTimeout(600_000);
  const host = new PlaywrightEngineHost({
    distDir: '.cache/engine-host-dist',
    modelsDir: '.models',
  });
  try {
    const refused = await host
      .index({
        bytes: new TextEncoder().encode('%PDF-1.4\nnot really a PDF'),
        kind: 'pdf',
        mimeType: 'application/pdf',
        title: 'Broken scan',
        createdAt: 1_762_300_000_000,
      })
      .catch((cause: unknown) => cause);
    expect(refused).toBeInstanceOf(EngineIndexError);
    expect((refused as EngineIndexError).message).toContain('could not be read');
    // The page is still usable afterwards.
    const ok = await host.index({
      bytes: new TextEncoder().encode('Hostel curfew is 11 pm on weekdays.'),
      kind: 'note',
      mimeType: 'text/plain;charset=utf-8',
      title: 'Curfew',
      createdAt: 1_762_300_000_000,
    });
    expect(ok.segments).toEqual([
      expect.objectContaining({ modality: 'text', location: { kind: 'whole' } }),
    ]);
    expect(host.starts).toBe(1);
  } finally {
    await host.close();
  }
});
