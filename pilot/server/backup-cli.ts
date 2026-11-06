/// <reference types="node" />
// Operator commands, run with the server's environment:
//   node .cache/pilot-server/backup.mjs list
//   node .cache/pilot-server/backup.mjs now
//   node .cache/pilot-server/backup.mjs verify
//   node .cache/pilot-server/backup.mjs restore <database/...jsonl.gz> [--schema <name>]
// `restore` writes into PILOT_DATABASE_URL, which must point at an empty database (or name an
// empty schema); it never overwrites data.
import {
  backupDatabase,
  listBackups,
  pruneBackups,
  restoreDatabase,
  verifyObjects,
} from './backup';
import { AzureBlobObjectStore, managedIdentityCredential } from './blob';
import { loadConfig } from './config';
import { PostgresPilotStore } from './postgres';

const config = loadConfig(process.env);
const { storage } = config;
if (storage.kind !== 'durable')
  throw new Error('Backups need PostgreSQL and Blob storage settings.');
const container = (name: string) =>
  AzureBlobObjectStore.open(
    'connectionString' in storage.blob
      ? { connectionString: storage.blob.connectionString, container: name }
      : {
          accountUrl: storage.blob.accountUrl,
          container: name,
          credential: managedIdentityCredential({ clientId: storage.blob.clientId }),
        },
  );
const backups = await container(storage.backup.container);
const [command, ...rest] = process.argv.slice(2);

if (command === 'list') {
  for (const key of await listBackups(backups)) console.log(key);
} else if (command === 'now' || command === 'verify') {
  const store = await PostgresPilotStore.open({
    connectionString: storage.databaseUrl,
    schema: storage.schema,
  });
  try {
    if (command === 'now') {
      const { key, counts } = await backupDatabase({ store, target: backups });
      await pruneBackups(backups, storage.backup.keep);
      console.log(`Stored ${key}`, counts);
    } else {
      const result = await verifyObjects({
        store,
        objects: await container(storage.blob.container),
      });
      console.log(`Checked ${result.checked} objects; missing: ${result.missing.length}`);
      for (const key of result.missing) console.log(`missing ${key}`);
      if (result.missing.length) process.exitCode = 1;
    }
  } finally {
    await store.close();
  }
} else if (command === 'restore' && rest[0]) {
  const schemaFlag = rest.indexOf('--schema');
  const schema = schemaFlag >= 0 ? rest[schemaFlag + 1] : storage.schema;
  const { store, counts } = await restoreDatabase({
    source: backups,
    key: rest[0],
    connectionString: storage.databaseUrl,
    schema,
  });
  try {
    console.log(`Restored ${rest[0]} into schema ${schema}`, counts);
    const result = await verifyObjects({ store, objects: await container(storage.blob.container) });
    console.log(`Checked ${result.checked} objects; missing: ${result.missing.length}`);
    for (const key of result.missing) console.log(`missing ${key}`);
    if (result.missing.length) process.exitCode = 1;
  } finally {
    await store.close();
  }
} else {
  console.error('Usage: backup.mjs list | now | verify | restore <key> [--schema <name>]');
  process.exitCode = 2;
}
