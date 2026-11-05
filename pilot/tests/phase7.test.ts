import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { LIMITS, type ItemKind } from '../../src/shared';
import { createApiClient } from '../client/api';
import { readEntry } from '../client/entry';
import { googleIdToken, type FirebaseAuthModule } from '../client/google';
import { MemoryLocalLibrary, MemorySyncStateStore } from '../client/memory';
import { SyncEngine } from '../client/sync';
import { loadConfig } from '../server/config';
import { deviceFetch, idToken, sha256, startPilotServer } from './helpers';

let pilot: Awaited<ReturnType<typeof startPilotServer>> | undefined;
afterEach(async () => {
  await pilot?.close();
  pilot = undefined;
});

async function device(options: { downloadRangeBytes?: number } = {}) {
  const net = deviceFetch();
  const api = createApiClient({ base: pilot!.base, fetch: net.fetchImpl });
  const library = new MemoryLocalLibrary();
  const engine = new SyncEngine({
    api,
    library,
    state: new MemorySyncStateStore(),
    libraryId: 'library',
    ...options,
  });
  const session = await api.signIn(idToken());
  await engine.include(session.vault.epoch);
  return { net, api, library, engine, epoch: session.vault.epoch };
}

/** Bytes that start with a format's magic number, then a repeating pattern. */
function fileBytes(magic: string, length: number) {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = (i * 31 + 7) % 251;
  bytes.set(new TextEncoder().encode(magic));
  return bytes;
}
const utf8 = (text: string) => new TextEncoder().encode(text);
const TEXT = 'text/plain;charset=utf-8';

const SIX: {
  kind: ItemKind;
  title: string;
  mimeType: string;
  sourceUrl?: string;
  bytes: Uint8Array;
}[] = [
  {
    kind: 'image',
    title: 'Mess menu photo',
    mimeType: 'image/png',
    bytes: fileBytes('\x89PNG\r\n\x1a\n', 50_000),
  },
  {
    kind: 'pdf',
    title: 'Hostel rules',
    mimeType: 'application/pdf',
    bytes: fileBytes('%PDF-1.4\n', 70_000),
  },
  {
    kind: 'note',
    title: 'Lab reminder',
    mimeType: TEXT,
    bytes: utf8('Bring the lab coat on Thursday. '),
  },
  {
    kind: 'webpage',
    title: 'Library hours',
    mimeType: TEXT,
    sourceUrl: 'https://library.iitgn.ac.in/hours',
    bytes: utf8('The library is open until midnight during exams.'),
  },
  { kind: 'audio', title: 'Lecture clip', mimeType: 'audio/mpeg', bytes: fileBytes('ID3', 90_000) },
  {
    kind: 'video',
    title: 'Lab demo',
    mimeType: 'video/mp4',
    bytes: fileBytes('\0\0\0\x18ftypmp42', 120_000),
  },
];

describe('P11 all six formats', () => {
  it('syncs one item of each kind with its type and source link, byte for byte', async () => {
    pilot = await startPilotServer();
    const phone = await device();
    for (const { bytes, ...meta } of SIX) phone.library.add(meta, bytes);
    expect((await phone.engine.runOnce()).uploaded).toBe(6);

    const laptop = await device();
    await laptop.engine.runOnce();
    const catalogue = await laptop.engine.catalogue();
    expect(catalogue).toHaveLength(6);
    for (const fixture of SIX) {
      const entry = catalogue.find((item) => item.title === fixture.title)!;
      expect(entry).toMatchObject({ kind: fixture.kind, mimeType: fixture.mimeType });
      expect(entry.sourceUrl).toBe(fixture.sourceUrl);
      expect(sha256(await laptop.engine.download(entry.globalId))).toBe(sha256(fixture.bytes));
    }
  });

  it('accepts the largest video and the longest note, and refuses one byte more', async () => {
    pilot = await startPilotServer(250_000_000, { chunkBytes: 4 * 1024 * 1024 });
    const phone = await device();
    const video = fileBytes('\0\0\0\x18ftypmp42', LIMITS.maxVideoBytes);
    const note = utf8('\u{1D11E}'.repeat(LIMITS.maxTextCodePoints));
    phone.library.add({ kind: 'video', title: 'Longest lab demo', mimeType: 'video/mp4' }, video);
    phone.library.add({ kind: 'note', title: 'Longest note', mimeType: TEXT }, note);
    expect((await phone.engine.runOnce()).uploaded).toBe(2);

    const laptop = await device({ downloadRangeBytes: 16 * 1024 * 1024 });
    await laptop.engine.runOnce();
    const entry = (await laptop.engine.catalogue()).find((item) => item.kind === 'video')!;
    expect(sha256(await laptop.engine.download(entry.globalId))).toBe(sha256(video));

    await expect(
      phone.api.beginUpload(randomUUID(), {
        opId: randomUUID(),
        epoch: phone.epoch,
        item: {
          kind: 'video',
          title: 'Too long',
          mimeType: 'video/mp4',
          byteLength: LIMITS.maxVideoBytes + 1,
          contentSha256: sha256(video),
          createdAt: 1,
        },
      }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
  }, 120_000);
});

describe('P11 quota counts stored bytes', () => {
  async function begin(byteLength: number) {
    const phone = await device();
    const bytes = fileBytes('%PDF-1.4\n', byteLength);
    const { uploadId } = await phone.api.beginUpload(randomUUID(), {
      opId: randomUUID(),
      epoch: phone.epoch,
      item: {
        kind: 'pdf',
        title: 'Notes',
        mimeType: 'application/pdf',
        byteLength,
        contentSha256: sha256(bytes),
        createdAt: 1,
      },
    });
    return { phone, bytes, uploadId };
  }

  it('refuses a chunk that is longer or shorter than its place in the declared file', async () => {
    pilot = await startPilotServer();
    // 40,000 bytes in 32 KiB chunks: chunk 0 is 32,768 bytes and chunk 1 is 7,232.
    const { phone, bytes, uploadId } = await begin(40_000);
    await expect(phone.api.putChunk(uploadId, 1, new Uint8Array(32 * 1024))).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    await expect(phone.api.putChunk(uploadId, 0, bytes.slice(0, 100))).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    await phone.api.putChunk(uploadId, 0, bytes.slice(0, 32 * 1024));
    await phone.api.putChunk(uploadId, 1, bytes.slice(32 * 1024));
    const { item } = await phone.api.completeUpload(uploadId, {
      opId: randomUUID(),
      epoch: phone.epoch,
    });
    expect(item.byteLength).toBe(40_000);
  });

  it('publishes nothing for an upload over the quota and reports a clear error', async () => {
    pilot = await startPilotServer(100_000);
    const phone = await device();
    phone.library.add(
      { kind: 'pdf', title: 'First', mimeType: 'application/pdf' },
      fileBytes('%PDF-1.4\n', 60_000),
    );
    phone.library.add(
      { kind: 'pdf', title: 'Second', mimeType: 'application/pdf' },
      fileBytes('%PDF-1.4\nsecond', 60_000),
    );
    const result = await phone.engine.runOnce();
    expect(result).toMatchObject({ uploaded: 1, failed: 1, quotaExceeded: true });
    const { changes } = await phone.api.changes(phone.epoch, 0);
    expect(changes.map((change) => change.item.title)).toEqual(['First']);
    expect(await pilot.store.committedBytes('campus-recall-pilot:subject-a')).toBe(60_000);

    // The waiting item goes up once space is freed, without being added again.
    const first = (await phone.engine.catalogue()).find((item) => item.title === 'First')!;
    await phone.engine.deleteCloudItem(first.globalId);
    expect(await phone.engine.runOnce()).toMatchObject({ uploaded: 1, failed: 0 });
    expect((await phone.engine.catalogue()).map((item) => item.title)).toEqual(['Second']);
  });
});

describe('P11 ranged downloads of originals', () => {
  async function stored(length: number) {
    const phone = await device();
    const bytes = fileBytes('ID3', length);
    phone.library.add({ kind: 'audio', title: 'Lecture clip', mimeType: 'audio/mpeg' }, bytes);
    await phone.engine.runOnce();
    const [entry] = await phone.engine.catalogue();
    return { phone, bytes, url: `${pilot!.base}/items/${entry.globalId}/original` };
  }

  it('serves byte ranges so media can be fetched in parts', async () => {
    pilot = await startPilotServer();
    const { phone, bytes, url } = await stored(100_000);
    const full = await phone.net.fetchImpl(url);
    expect(full.headers.get('accept-ranges')).toBe('bytes');

    const part = await phone.net.fetchImpl(url, { headers: { range: 'bytes=10-19' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe('bytes 10-19/100000');
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(bytes.slice(10, 20));

    const tail = await phone.net.fetchImpl(url, { headers: { range: 'bytes=99990-' } });
    expect(new Uint8Array(await tail.arrayBuffer())).toEqual(bytes.slice(99_990));
    const suffix = await phone.net.fetchImpl(url, { headers: { range: 'bytes=-5' } });
    expect(new Uint8Array(await suffix.arrayBuffer())).toEqual(bytes.slice(99_995));

    const beyond = await phone.net.fetchImpl(url, { headers: { range: 'bytes=100000-' } });
    expect(beyond.status).toBe(416);
    expect(beyond.headers.get('content-range')).toBe('bytes */100000');
  });

  it('downloads a large original in ranges, retries a lost part and checks the whole hash', async () => {
    pilot = await startPilotServer();
    const { bytes } = await stored(100_000);
    const laptop = await device({ downloadRangeBytes: 32 * 1024 });
    await laptop.engine.runOnce();
    const [entry] = await laptop.engine.catalogue();
    laptop.net.controls.log.length = 0;
    laptop.net.controls.loseResponse = /\/original$/;
    expect(sha256(await laptop.engine.download(entry.globalId))).toBe(sha256(bytes));
    // Four parts of at most 32 KiB, plus one retry of the lost part.
    expect(laptop.net.controls.log.filter((line) => line.endsWith('/original'))).toHaveLength(5);
  });
});

describe('P12 entry from INSIIT and direct Google sign-in', () => {
  it('opens from an INSIIT link and strips anything that looks like a credential', () => {
    expect(readEntry('https://recall.example/?from=insiit#/library')).toEqual({
      from: 'insiit',
      cleanUrl: 'https://recall.example/#/library',
      strippedCredentials: false,
    });
    expect(
      readEntry(
        'https://recall.example/?id_token=abc&from=insiit&code=1#/settings?access_token=x&tab=sync',
      ),
    ).toEqual({
      from: 'insiit',
      cleanUrl: 'https://recall.example/#/settings?tab=sync',
      strippedCredentials: true,
    });
    expect(readEntry('https://recall.example/#/search')).toEqual({
      cleanUrl: 'https://recall.example/#/search',
      strippedCredentials: false,
    });
  });

  it('never accepts a token from a URL to open a session', async () => {
    pilot = await startPilotServer();
    const net = deviceFetch();
    const res = await net.fetchImpl(
      `${pilot.base}/session?idToken=${encodeURIComponent(idToken())}`,
      { method: 'POST' },
    );
    expect(res.status).toBe(400);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('reports the public Firebase web configuration only when it is set', async () => {
    pilot = await startPilotServer(5_000_000, {
      firebaseWeb: { apiKey: 'public-web-key', authDomain: 'recall.example.test' },
    });
    expect(await (await fetch(`${pilot.base}/config`)).json()).toEqual({
      signIn: 'google',
      projectId: 'campus-recall-pilot',
      firebase: { apiKey: 'public-web-key', authDomain: 'recall.example.test' },
    });
  });

  it('reads the web configuration from the environment, both values or neither', () => {
    const base = { PILOT_FIREBASE_PROJECT_ID: 'campus-recall-pilot' };
    expect(loadConfig(base).firebaseWeb).toBeUndefined();
    expect(
      loadConfig({
        ...base,
        PILOT_FIREBASE_API_KEY: 'public-web-key',
        PILOT_FIREBASE_AUTH_DOMAIN: 'recall.example.test',
      }).firebaseWeb,
    ).toEqual({ apiKey: 'public-web-key', authDomain: 'recall.example.test' });
    expect(() => loadConfig({ ...base, PILOT_FIREBASE_API_KEY: 'public-web-key' })).toThrow(
      /PILOT_FIREBASE_AUTH_DOMAIN/,
    );
  });

  function fakeFirebase(getIdToken: () => Promise<string>) {
    const calls: string[] = [];
    let parameters: Record<string, string> = {};
    const module: FirebaseAuthModule = {
      initializeApp: (config, name) => {
        calls.push(`app ${name} ${config.projectId}`);
        return { name } as never;
      },
      getApps: () => [],
      initializeAuth: (_app, deps) => {
        calls.push(`auth ${deps?.persistence === module.inMemoryPersistence ? 'memory' : 'other'}`);
        return {} as never;
      },
      inMemoryPersistence: { type: 'NONE' } as never,
      browserPopupRedirectResolver: {} as never,
      GoogleAuthProvider: class {
        setCustomParameters(value: Record<string, string>) {
          parameters = value;
          return this;
        }
      } as never,
      signInWithPopup: async () => {
        calls.push('popup');
        return { user: { getIdToken } } as never;
      },
      signOut: async () => {
        calls.push('signOut');
      },
    };
    return { module, calls, parameters: () => parameters };
  }
  const web = { apiKey: 'public-web-key', authDomain: 'recall.example.test', projectId: 'p' };

  it('gets one Google ID token without keeping a Firebase login on the device', async () => {
    const fake = fakeFirebase(async () => 'firebase-id-token');
    expect(await googleIdToken(web, async () => fake.module)).toBe('firebase-id-token');
    expect(fake.parameters()).toMatchObject({ hd: 'iitgn.ac.in', prompt: 'select_account' });
    expect(fake.calls).toEqual(['app campus-recall-pilot p', 'auth memory', 'popup', 'signOut']);
  });

  it('signs out of Firebase even when getting the token fails', async () => {
    const fake = fakeFirebase(async () => {
      throw new Error('token failed');
    });
    await expect(googleIdToken(web, async () => fake.module)).rejects.toThrow('token failed');
    expect(fake.calls.at(-1)).toBe('signOut');
  });
});
