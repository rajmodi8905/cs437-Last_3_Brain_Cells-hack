/// <reference types="node" />
// Database backups: a consistent JSON-lines snapshot of every pilot table, gzipped, with a
// manifest (format, database version, row counts, SHA-256). Restores go only into an empty
// database of the same version, after the hash is checked, in one transaction.
// Originals and index bundles stay in Blob storage, protected there by soft delete and
// versioning; `verifyObjects` checks that a restored database's objects still exist.
import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { BACKUP_TABLES, DATABASE_VERSION, PostgresPilotStore, type BackupTable } from './postgres';
import type { ObjectStore } from './store';

const FORMAT = 'campus-recall-pilot-database-backup';
const PREFIX = 'database/';
const DATA = /^database\/(\d{4}-\d\d-\d\dT\d\d-\d\d-\d\dZ)\.jsonl\.gz$/;

export interface BackupManifest {
  format: typeof FORMAT;
  version: 1;
  databaseVersion: number;
  createdAt: string;
  sha256: string;
  bytes: number;
  counts: Record<BackupTable, number>;
}

const stamp = (ms: number) =>
  new Date(ms)
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replaceAll(':', '-');
const manifestKey = (key: string) => key.replace(/\.jsonl\.gz$/, '.json');
const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value, null, 2));

/** Takes a backup and stores it with its manifest; returns where it went. */
export async function backupDatabase(options: {
  store: PostgresPilotStore;
  target: ObjectStore;
  now?: () => number;
}) {
  const createdAt = (options.now ?? Date.now)();
  const counts = Object.fromEntries(BACKUP_TABLES.map((table) => [table, 0])) as Record<
    BackupTable,
    number
  >;
  const lines = [
    JSON.stringify({
      format: FORMAT,
      version: 1,
      databaseVersion: DATABASE_VERSION,
      createdAt: new Date(createdAt).toISOString(),
    }),
  ];
  await options.store.exportRows((table, row) => {
    counts[table]++;
    lines.push(JSON.stringify({ table, row }));
  });
  lines.push(JSON.stringify({ end: true, counts }));
  const data = gzipSync(Buffer.from(lines.join('\n') + '\n'));
  const key = `${PREFIX}${stamp(createdAt)}.jsonl.gz`;
  const manifest: BackupManifest = {
    format: FORMAT,
    version: 1,
    databaseVersion: DATABASE_VERSION,
    createdAt: new Date(createdAt).toISOString(),
    sha256: createHash('sha256').update(data).digest('hex'),
    bytes: data.length,
    counts,
  };
  await options.target.put(key, new Uint8Array(data));
  // The manifest goes last: a backup without one is incomplete and is never restored.
  await options.target.put(manifestKey(key), json(manifest));
  return { key, counts };
}

/** Complete backups (data and manifest present), newest first. */
export async function listBackups(target: ObjectStore) {
  const keys = new Set(await target.list(PREFIX));
  return [...keys]
    .filter((key) => DATA.test(key) && keys.has(manifestKey(key)))
    .sort()
    .reverse();
}

/** Deletes all but the newest `keep` backups; returns the deleted backups' data keys. */
export async function pruneBackups(target: ObjectStore, keep: number) {
  const old = (await listBackups(target)).slice(keep);
  for (const key of old) {
    await target.delete(manifestKey(key));
    await target.delete(key);
  }
  return old;
}

/**
 * Restores a backup into `schema`, which must be empty (a fresh database or a new schema).
 * Nothing is written unless the data matches its manifest and this code's database version.
 */
export async function restoreDatabase(options: {
  source: ObjectStore;
  key: string;
  connectionString: string;
  schema?: string;
}) {
  if (!DATA.test(options.key)) throw new Error('Not a database backup key.');
  const manifestBytes = await options.source.get(manifestKey(options.key));
  const data = await options.source.get(options.key);
  if (!manifestBytes || !data) throw new Error('This backup is incomplete or missing.');
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as BackupManifest;
  if (manifest.format !== FORMAT || manifest.version !== 1)
    throw new Error('This is not a pilot database backup.');
  if (createHash('sha256').update(data).digest('hex') !== manifest.sha256)
    throw new Error('The backup data does not match its manifest; it is damaged.');
  if (manifest.databaseVersion !== DATABASE_VERSION)
    throw new Error(
      `The backup is database version ${manifest.databaseVersion}; this code restores version ${DATABASE_VERSION}.`,
    );

  const rows = new Map<BackupTable, unknown[]>(BACKUP_TABLES.map((table) => [table, []]));
  const counts = Object.fromEntries(BACKUP_TABLES.map((table) => [table, 0])) as Record<
    BackupTable,
    number
  >;
  let ended = false;
  for (const line of gunzipSync(data).toString('utf8').split('\n').slice(1)) {
    if (!line) continue;
    const entry = JSON.parse(line) as { table?: BackupTable; row?: unknown; end?: true };
    if (entry.end) {
      ended = true;
      continue;
    }
    if (!entry.table || !rows.has(entry.table)) throw new Error('Unknown table in the backup.');
    rows.get(entry.table)!.push(entry.row);
    counts[entry.table]++;
  }
  if (!ended || JSON.stringify(counts) !== JSON.stringify(manifest.counts))
    throw new Error('The backup is truncated: its rows do not match the manifest.');

  const store = await PostgresPilotStore.open({
    connectionString: options.connectionString,
    schema: options.schema,
  });
  try {
    if (!(await store.isEmpty()))
      throw new Error('The target database is not empty; restore into a fresh one.');
    await store.importRows(rows);
  } catch (cause) {
    await store.close();
    throw cause;
  }
  return { store, counts, manifest };
}

/** Checks that every live item's original and index exist in object storage. */
export async function verifyObjects(options: { store: PostgresPilotStore; objects: ObjectStore }) {
  const keys = await options.store.liveObjectKeys();
  const missing: string[] = [];
  for (const key of keys)
    if (!(await options.objects.get(key, { start: 0, end: 0 }))) missing.push(key);
  return { checked: keys.length, missing };
}
