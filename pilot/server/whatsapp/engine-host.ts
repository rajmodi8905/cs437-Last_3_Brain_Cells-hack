/// <reference types="node" />
// The engine host's server side (docs/pilot/whatsapp.md): runs the app's own built engine in
// headless Chromium so WhatsApp items get index bundles made by the same code, default model and
// INDEX_VERSION as a device's. Playwright is loaded only when a host is started.
import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ItemKind, SourceLocation } from '../../../src/shared';
import { PILOT_INDEX_VERSIONS, type IndexSegment } from '../../contract';
import { createStaticHandler } from '../static';

export interface EngineIndexInput {
  bytes: Uint8Array;
  kind: ItemKind;
  mimeType: string;
  title: string;
  /** Milliseconds. */
  createdAt: number;
  sourceUrl?: string;
}

export interface EngineIndexResult {
  indexVersion: string;
  /** SHA-256 of the bytes the engine indexed, as the app's library computed it. */
  contentSha256: string;
  /** In `IndexBundle.segments` form. */
  segments: IndexSegment[];
  /** Time inside the page from save to a ready index, in milliseconds. */
  ms?: number;
}

/** One stored bundle to search; `globalId` names the cloud item. */
export interface EngineSearchItem {
  globalId: string;
  kind: ItemKind;
  indexVersion: string;
  segments: IndexSegment[];
}

/** One ranked result, as the app's search returns it for a synced item. */
export interface EngineSearchHit {
  globalId: string;
  /** `cloud:<globalId>`. */
  itemId: string;
  segmentId: string;
  location: SourceLocation;
  matchKind: 'text' | 'visual';
  excerpt?: string;
  score: number;
}

/**
 * The engine refused the original (for example an unreadable or over-long PDF, an image it cannot
 * decode, nothing searchable): trying again gives the same answer.
 */
export class EngineIndexError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'EngineIndexError';
  }
}

export interface EngineHost {
  /** Indexes one original with the app's pipeline; throws EngineIndexError when it is refused. */
  index(input: EngineIndexInput): Promise<EngineIndexResult>;
  /** Embeds the query on the host and ranks these bundles with the app's search. */
  search(query: string, items: EngineSearchItem[], kind?: ItemKind): Promise<EngineSearchHit[]>;
  close(): Promise<void>;
}

/** The pinned assets the page sets up, from the built `asset-manifest.json`. */
interface ManifestAsset {
  url: string;
  sha256: string;
  bytes: number;
  name: string;
}

export interface PlaywrightEngineHostOptions {
  /** The engine host build (`npm run build:engine-host`, `.cache/engine-host-dist`). */
  distDir: string;
  /** Pinned model files named by SHA-256, as `npm run models:download` writes them. */
  modelsDir: string;
  /**
   * Chromium profile (its asset cache and the host's library database). A temporary directory
   * that is removed on close by default; a kept one makes restarts after the first faster.
   */
  profileDir?: string;
  /** Longest a single index or search may take before the page is restarted; 3 minutes. */
  jobTimeoutMs?: number;
  /** Longest model setup may take when a page starts; 10 minutes. */
  setupTimeoutMs?: number;
  /** The browser is restarted after this many jobs, to return any memory it holds; 50. */
  maxJobsPerBrowser?: number;
  headless?: boolean;
  log?: (message: string, detail?: unknown) => void;
}

/** Transient: the page crashed, timed out or could not start; the job is tried again later. */
export class EngineHostUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'EngineHostUnavailableError';
  }
}

const PAGE_PATH = '/pilot/engine-host/index.html';
const MODEL_PATH = /^\/__models\/([0-9a-f]{64})$/;
const OCR_DATA_PATH = '/runtime/ocr/eng.traineddata.gz';

function withTimeout<T>(work: Promise<T>, ms: number, what: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new EngineHostUnavailableError(`${what} took longer than ${ms} ms.`)),
        ms,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Serves the built page and the pinned model files on a loopback port only. Model files are
 * served only for SHA-256 names listed in the manifest; the page checks every file's hash again
 * during setup, exactly as the app does.
 */
async function startLocalServer(distDir: string, modelsDir: string, assets: ManifestAsset[]) {
  const pinned = new Set(assets.map((asset) => asset.sha256));
  // The app's service worker answers this path from the asset cache with the OCR data; the
  // engine host page has no service worker, so the same pinned file is served here.
  const ocr = assets.find((asset) => asset.url.endsWith('/eng.traineddata.gz'));
  const notFound = (res: import('node:http').ServerResponse) =>
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
  const files = createStaticHandler(distDir, (_req, res) => notFound(res));
  const sendModel = async (sha256: string, res: import('node:http').ServerResponse) => {
    const path = join(modelsDir, sha256);
    const size = await stat(path).then(
      (info) => info.size,
      () => undefined,
    );
    if (size === undefined) return notFound(res);
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': String(size),
      // Reached by redirect from the asset's public URL, so the response is cross-origin.
      'access-control-allow-origin': '*',
    });
    createReadStream(path).pipe(res);
  };
  const server: Server = createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://engine-host.local').pathname;
    const model = MODEL_PATH.exec(pathname);
    if (model) return void (pinned.has(model[1]) ? sendModel(model[1], res) : notFound(res));
    if (pathname === OCR_DATA_PATH && ocr) return void sendModel(ocr.sha256, res);
    void files(req, res);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    origin,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

type Playwright = typeof import('@playwright/test');
type BrowserContext = import('@playwright/test').BrowserContext;
type Page = import('@playwright/test').Page;
type WireIndexInput = Omit<EngineIndexInput, 'bytes'> & { bytesBase64: string };
type WireIndexOutcome =
  (EngineIndexResult & { ok: true }) | { ok: false; error: { code: string; message: string } };
type HostWindow = {
  engineHost: {
    ready(): Promise<{ indexVersion: string }>;
    index(input: WireIndexInput): Promise<WireIndexOutcome>;
    search(query: string, items: EngineSearchItem[], kind?: ItemKind): Promise<EngineSearchHit[]>;
  };
};

/**
 * Runs the engine host page in headless Chromium: one warm page, one job at a time, a time limit
 * per job, and a fresh browser after a crash, a timeout or `maxJobsPerBrowser` jobs.
 */
export class PlaywrightEngineHost implements EngineHost {
  private readonly options: Required<
    Pick<
      PlaywrightEngineHostOptions,
      'jobTimeoutMs' | 'setupTimeoutMs' | 'maxJobsPerBrowser' | 'headless'
    >
  > &
    PlaywrightEngineHostOptions;
  private queue: Promise<unknown> = Promise.resolve();
  private server?: Awaited<ReturnType<typeof startLocalServer>>;
  private context?: BrowserContext;
  private page?: Page;
  private starting?: Promise<Page>;
  private profileDir?: string;
  private ownProfile = false;
  private pid?: number;
  private jobs = 0;
  private broken = false;
  private closed = false;
  /** Requests the page tried to send off this machine; all are refused. */
  readonly blockedRequests: string[] = [];
  /** Pages started so far, including restarts. */
  starts = 0;

  constructor(options: PlaywrightEngineHostOptions) {
    this.options = {
      jobTimeoutMs: 180_000,
      setupTimeoutMs: 600_000,
      maxJobsPerBrowser: 50,
      headless: true,
      ...options,
    };
  }

  private log(message: string, detail?: unknown) {
    (this.options.log ?? ((m, d) => console.error(m, d ?? '')))(message, detail);
  }

  /** Starts Chromium and the page now instead of on the first job. */
  async start() {
    await this.serial(() => this.ready());
  }

  /** The Chromium main process ID while the browser runs, for measuring memory. */
  get browserProcessId(): number | undefined {
    return this.pid;
  }

  private async ready(): Promise<Page> {
    if (this.closed) throw new Error('The engine host is closed.');
    if (this.page && !this.broken && this.jobs < this.options.maxJobsPerBrowser) return this.page;
    if (this.page || this.context) await this.stopBrowser();
    this.starting ??= this.launch().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  private async launch(): Promise<Page> {
    const distDir = resolve(this.options.distDir);
    const manifest = JSON.parse(await readFile(join(distDir, 'asset-manifest.json'), 'utf8')) as {
      assets: ManifestAsset[];
    };
    this.server ??= await startLocalServer(
      distDir,
      resolve(this.options.modelsDir),
      manifest.assets,
    );
    if (!this.profileDir) {
      this.ownProfile = !this.options.profileDir;
      this.profileDir =
        this.options.profileDir ?? (await mkdtemp(join(tmpdir(), 'campus-recall-engine-host-')));
    }
    const { chromium } = (await import('@playwright/test')) as Playwright;
    const context = await chromium.launchPersistentContext(this.profileDir, {
      headless: this.options.headless,
      serviceWorkers: 'block',
      acceptDownloads: false,
      // A second guard under the request routing below: no host name resolves except loopback.
      args: ['--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1'],
    });
    this.context = context;
    this.jobs = 0;
    this.broken = false;
    this.starts++;
    this.pid = await this.findBrowserPid();
    const origin = this.server.origin;
    const byUrl = new Map(manifest.assets.map((asset) => [asset.url, asset]));
    let settingUp = true;
    // Nothing leaves this machine: the page's own origin is served locally, a pinned asset's
    // public URL is answered from the local copy (during setup only), and anything else fails.
    await context.route(/.*/, async (route) => {
      const url = route.request().url();
      if (url.startsWith(`${origin}/`) || url.startsWith('data:') || url.startsWith('blob:'))
        return route.continue();
      const asset = byUrl.get(url);
      if (settingUp && asset && url.startsWith('https://'))
        return route.fulfill({
          status: 302,
          headers: {
            location: `${origin}/__models/${asset.sha256}`,
            'access-control-allow-origin': '*',
          },
        });
      this.blockedRequests.push(`${route.request().method()} ${url}`);
      return route.abort();
    });
    context.on('close', () => {
      if (this.context === context) this.broken = true;
    });
    const page = await context.newPage();
    page.on('crash', () => {
      this.broken = true;
      this.log('Engine host page crashed');
    });
    page.on('pageerror', (error) => this.log('Engine host page error', error.message));
    try {
      await page.goto(`${origin}${PAGE_PATH}`);
      await withTimeout(
        page.evaluate(() => (window as unknown as HostWindow).engineHost.ready()),
        this.options.setupTimeoutMs,
        'Engine host setup',
      );
    } catch (cause) {
      await this.stopBrowser();
      throw new EngineHostUnavailableError('The engine host could not start.', { cause });
    }
    settingUp = false;
    this.page = page;
    return page;
  }

  /** Chromium's main process: the one started with this profile directory. */
  private async findBrowserPid() {
    try {
      const { execFile } = await import('node:child_process');
      const listing = await new Promise<string>((done, fail) =>
        execFile('ps', ['-axo', 'pid=,command='], { maxBuffer: 16 << 20 }, (error, out) =>
          error ? fail(error) : done(out),
        ),
      );
      for (const line of listing.split('\n')) {
        const match = /^\s*(\d+)\s+(.*)$/.exec(line);
        if (
          match &&
          match[2].includes(`--user-data-dir=${this.profileDir}`) &&
          !match[2].includes('--type=')
        )
          return Number(match[1]);
      }
    } catch {
      // Only used for measurements.
    }
    return undefined;
  }

  private async stopBrowser() {
    const context = this.context;
    this.context = undefined;
    this.page = undefined;
    this.pid = undefined;
    if (context) await context.close().catch(() => undefined);
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Runs one job on the warm page; a timeout or crash restarts the browser for the next job. */
  private run<T>(what: string, job: (page: Page) => Promise<T>) {
    return this.serial(async () => {
      const page = await this.ready();
      this.jobs++;
      try {
        return await withTimeout(job(page), this.options.jobTimeoutMs, what);
      } catch (cause) {
        if (cause instanceof EngineIndexError) throw cause;
        // Whatever happened, the next job starts from a fresh browser.
        this.broken = true;
        await this.stopBrowser();
        if (cause instanceof EngineHostUnavailableError) throw cause;
        throw new EngineHostUnavailableError(`${what} failed in the engine host.`, { cause });
      }
    });
  }

  index(input: EngineIndexInput): Promise<EngineIndexResult> {
    const { bytes, ...rest } = input;
    const wire: WireIndexInput = { ...rest, bytesBase64: Buffer.from(bytes).toString('base64') };
    return this.run('Indexing', async (page) => {
      const outcome = await page.evaluate(
        (value) => (window as unknown as HostWindow).engineHost.index(value),
        wire,
      );
      if (!outcome.ok) throw new EngineIndexError(outcome.error.code, outcome.error.message);
      const { ok: _ok, ...result } = outcome;
      return result;
    });
  }

  search(query: string, items: EngineSearchItem[], kind?: ItemKind): Promise<EngineSearchHit[]> {
    return this.run('Search', (page) =>
      page.evaluate(
        ({ query, items, kind }) =>
          (window as unknown as HostWindow).engineHost.search(query, items, kind),
        { query, items, kind },
      ),
    );
  }

  async close() {
    this.closed = true;
    await this.queue;
    await this.starting?.catch(() => undefined);
    await this.stopBrowser();
    await this.server?.close();
    this.server = undefined;
    if (this.ownProfile && this.profileDir)
      await rm(this.profileDir, { recursive: true, force: true });
  }
}

/**
 * A stand-in for tests: deterministic unit vectors, one text segment per input (page 1 for a
 * PDF), and failures that can be injected.
 */
export class FakeEngineHost implements EngineHost {
  readonly calls: EngineIndexInput[] = [];
  /** Each queued error is thrown by one `index` call before any succeeds. */
  readonly failures: Error[] = [];
  /** Runs inside `index` before it answers, to change things meanwhile. */
  onIndex?: (input: EngineIndexInput) => Promise<void> | void;
  closed = false;
  indexVersion = PILOT_INDEX_VERSIONS[0];

  async index(input: EngineIndexInput): Promise<EngineIndexResult> {
    this.calls.push(input);
    await this.onIndex?.(input);
    const failure = this.failures.shift();
    if (failure) throw failure;
    const { createHash } = await import('node:crypto');
    const axis = createHash('sha256').update(input.title).digest()[0] % 768;
    return {
      indexVersion: this.indexVersion,
      contentSha256: createHash('sha256').update(input.bytes).digest('hex'),
      segments: [
        {
          modality: 'text',
          location: input.kind === 'pdf' ? { kind: 'page', page: 1 } : { kind: 'whole' },
          text: input.title,
          vector: Array.from({ length: 768 }, (_, i) => (i === axis ? 1 : 0)),
        },
      ],
    };
  }

  async search(_query: string, items: EngineSearchItem[]): Promise<EngineSearchHit[]> {
    return items.slice(0, 5).map((item) => ({
      globalId: item.globalId,
      itemId: `cloud:${item.globalId}`,
      segmentId: `cloud:${item.globalId}:0`,
      location: item.segments[0]?.location ?? { kind: 'whole' },
      matchKind: 'text',
      excerpt: item.segments[0]?.text,
      score: 1,
    }));
  }

  async close() {
    this.closed = true;
  }
}
