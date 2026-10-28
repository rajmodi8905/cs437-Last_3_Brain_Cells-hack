import { afterAll, beforeAll, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { CampusRecallDatabase, DexieLibraryRepository } from '../../src/storage';

let parent: string;
let output: string;
const databases: CampusRecallDatabase[] = [];
const fresh = () => {
  const db = new CampusRecallDatabase(`qa-kit-${crypto.randomUUID()}`);
  databases.push(db);
  return new DexieLibraryRepository(db);
};
const archive = async (name: string) => new Blob([await readFile(join(output, name))]);

beforeAll(async () => {
  parent = await mkdtemp(join(tmpdir(), 'campus-recall-qa-'));
  output = join(parent, 'kit');
  execFileSync(process.execPath, ['scripts/prepare-qa-kit.mjs', '--output-dir', output]);
});
afterAll(async () => {
  await Promise.all(databases.map((db) => db.delete()));
  if (parent) await rm(parent, { recursive: true, force: true });
});

it('provides a real restorable 30-item library with exact original hashes and no indexes', async () => {
  const repository = fresh();
  const imported = await repository.importArchive(await archive('library-30.zip'));
  expect(imported.importedIds).toHaveLength(30);
  const records = await repository.listItems();
  expect(new Set(records.map((item) => item.kind)).size).toBe(6);
  expect(records.every((item) => item.status === 'queued')).toBe(true);
  expect(await repository.database.segments.count()).toBe(0);
  expect(await repository.database.jobs.count()).toBe(30);
  const expected = JSON.parse(await readFile(join(output, 'expected.json'), 'utf8'));
  for (const entry of expected.records) {
    const item = records.find((record) => record.contentSha256 === entry.sha256)!;
    expect(item).toBeDefined();
    const bytes = await (await repository.getOriginal(item.id))!.arrayBuffer();
    expect(createHash('sha256').update(new Uint8Array(bytes)).digest('hex')).toBe(entry.sha256);
    expect(item.title).toBe(entry.title);
    expect(item.sourceUrl).toBe(entry.sourceUrl);
  }
  const zipped = unzipSync(new Uint8Array(await (await archive('library-30.zip')).arrayBuffer()));
  expect(Object.keys(zipped)).toHaveLength(31);
  expect(
    Object.keys(zipped).every((path) => path === 'manifest.json' || path.startsWith('originals/')),
  ).toBe(true);
});

it('keeps duplicate titles distinct and repeated restores report actual content duplicates', async () => {
  const repository = fresh();
  const zip = await archive('same-title.zip');
  expect((await repository.importArchive(zip)).importedIds).toHaveLength(2);
  const records = await repository.listItems();
  expect(new Set(records.map((item) => item.title)).size).toBe(1);
  expect(new Set(records.map((item) => item.contentSha256)).size).toBe(2);
  const again = await repository.importArchive(zip);
  expect(again.importedIds).toEqual([]);
  expect(again.skippedDuplicateIds).toHaveLength(2);
});

it.each(['invalid-version.zip', 'invalid-hash.zip', 'missing-original.zip', 'invalid-path.zip'])(
  'provides %s that the real importer rejects without changing an existing library',
  async (name) => {
    const repository = fresh();
    const sentinel = await repository.save({
      kind: 'note',
      text: 'Existing private library sentinel',
    });
    await expect(repository.importArchive(await archive(`invalid/${name}`))).rejects.toMatchObject({
      detail: { code: 'INVALID_ARCHIVE' },
    });
    expect((await repository.listItems()).map((item) => item.id)).toEqual([sentinel.id]);
    expect(await (await repository.getOriginal(sentinel.id))!.text()).toBe(
      'Existing private library sentinel',
    );
    expect(await repository.database.jobs.count()).toBe(1);
  },
);

it('hashes every delivered artifact and leaves test results unasserted', async () => {
  const manifest = JSON.parse(await readFile(join(output, 'kit-manifest.json'), 'utf8'));
  for (const file of manifest.files) {
    const bytes = await readFile(join(output, file.path));
    expect(bytes.byteLength).toBe(file.bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);
  }
  expect(manifest.evidenceStatus).toBe('Test materials only; no tester results recorded.');
  const ledger = await readFile(join(output, 'run-ledger.md'), 'utf8');
  expect(ledger).toContain('Not run');
});

it('refuses to overwrite an existing kit and its tester notes', async () => {
  expect(() =>
    execFileSync(process.execPath, ['scripts/prepare-qa-kit.mjs', '--output-dir', output], {
      stdio: 'pipe',
    }),
  ).toThrow();
  expect(await readFile(join(output, 'run-ledger.md'), 'utf8')).toContain('Not run');
});
