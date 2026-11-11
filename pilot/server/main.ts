/// <reference types="node" />
// Local pilot server: the built PWA and the API on one origin. Run with `npm run pilot:server`.
import { createHash, createPrivateKey, createPublicKey, createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { cleanUpPilot, createPilotHandler } from './app';
import { loadConfig } from './config';
import { backupDatabase, pruneBackups } from './backup';
import { AzureBlobObjectStore, managedIdentityCredential } from './blob';
import { MemoryObjectStore, MemoryPilotStore } from './memory';
import { PostgresPilotStore } from './postgres';
import { createStaticHandler } from './static';
import { googleKeySource, staticKeySource } from './tokens';
import { startWhatsAppBot } from './whatsapp/conversation';
import { PlaywrightEngineHost, type EngineHost } from './whatsapp/engine-host';
import { createGraphClient } from './whatsapp/graph';
import { createWhatsAppIndexer } from './whatsapp/indexer';
import { PostgresBotStore } from './whatsapp/postgres';
import { MemoryBotStore } from './whatsapp/store';
import { WEBHOOK_PATH } from './whatsapp/webhook';

const config = loadConfig(process.env);
const devKey = config.devKeyFile ? createPrivateKey(readFileSync(config.devKeyFile)) : undefined;

/** Signs a Google-shaped ID token, so local sign-in goes through the same identity checks. */
const devSigner = devKey
  ? (email: string) => {
      const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
      const now = Math.floor(Date.now() / 1000);
      const header = part({ alg: 'RS256', kid: 'dev-key', typ: 'JWT' });
      const payload = part({
        iss: 'https://accounts.google.com',
        aud: config.clientId,
        sub: `dev-${createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 24)}`,
        iat: now,
        exp: now + 3600,
        email,
        email_verified: true,
        // Like Google, only Workspace accounts carry a hosted domain: here, the email's own.
        hd: email.slice(email.lastIndexOf('@') + 1).toLowerCase(),
      });
      const signer = createSign('RSA-SHA256');
      signer.update(`${header}.${payload}`);
      return `${header}.${payload}.${signer.sign(devKey).toString('base64url')}`;
    }
  : undefined;

const { storage } = config;
const store =
  storage.kind === 'durable'
    ? await PostgresPilotStore.open({
        connectionString: storage.databaseUrl,
        schema: storage.schema,
      })
    : new MemoryPilotStore();
const openContainer = (container: string) =>
  storage.kind === 'durable'
    ? AzureBlobObjectStore.open(
        'connectionString' in storage.blob
          ? { connectionString: storage.blob.connectionString, container }
          : {
              accountUrl: storage.blob.accountUrl,
              container,
              credential: managedIdentityCredential({ clientId: storage.blob.clientId }),
            },
      )
    : Promise.resolve(new MemoryObjectStore());
const objects = await openContainer(storage.kind === 'durable' ? storage.blob.container : '');

// The opt-in WhatsApp channel (docs/pilot/whatsapp.md), only with its settings. Its bot state
// lives next to the pilot's own: PostgreSQL with durable storage, memory otherwise.
const { whatsapp } = config;
const bot = whatsapp
  ? store instanceof PostgresPilotStore
    ? new PostgresBotStore(store)
    : new MemoryBotStore()
  : undefined;
/** Started once the engine host is up (below); messages recorded before then wait for it. */
let botRunner: ReturnType<typeof startWhatsAppBot> | undefined;

const api = createPilotHandler({
  clientId: config.clientId,
  allowedEmailDomain: config.allowedEmailDomain,
  origin: config.origin,
  keys: devKey ? staticKeySource({ 'dev-key': createPublicKey(devKey) }) : googleKeySource(),
  store,
  objects,
  quotaBytes: config.quotaBytes,
  devSigner,
  google: config.clientSecret ? { clientSecret: config.clientSecret } : undefined,
  trustProxy: config.trustProxy,
  limits: { signInBurst: config.signInPerMinute, signInPerMinute: config.signInPerMinute },
  ...(whatsapp && bot
    ? {
        whatsapp: {
          verifyToken: whatsapp.verifyToken,
          appSecret: whatsapp.appSecret,
          bot,
          phoneNumberId: whatsapp.phoneNumberId,
          onRecorded: () => botRunner?.wake(),
        },
      }
    : {}),
});
const server = createServer(createStaticHandler(config.staticDir, api));
server.listen(config.port, config.host, () => {
  console.log(`Pilot server on ${config.origin} (listening on ${config.host}:${config.port}).`);
  console.log(
    storage.kind === 'durable'
      ? `Storage: PostgreSQL (schema ${storage.schema}) and Azure Blob (container ${storage.blob.container}).`
      : 'Storage is in memory only: everything is lost when the server stops.',
  );
  if (devKey) console.log('Development sign-in is on: any typed IITGN email can sign in.');
  if (whatsapp)
    console.log(`WhatsApp channel on: Meta's webhook is ${config.origin}${WEBHOOK_PATH}.`);
  if (config.localTrial)
    console.log(
      'Local WhatsApp trial: the app has no sign-in of its own here; open it from a WhatsApp link.',
    );
});

// Clean up expired sessions, sign-in attempts and abandoned uploads now and every 10 minutes.
const cleanUp = () =>
  cleanUpPilot({ store, objects }).catch((cause: unknown) =>
    console.error('Pilot clean-up failed', cause),
  );
void cleanUp();
setInterval(cleanUp, 10 * 60_000).unref();

// Database backups: one at start-up, then on the configured schedule, keeping the newest few.
if (storage.kind === 'durable' && store instanceof PostgresPilotStore) {
  const target = await openContainer(storage.backup.container);
  const backUp = async () => {
    try {
      const { key } = await backupDatabase({ store, target });
      const removed = await pruneBackups(target, storage.backup.keep);
      console.log(`Backup ${key} stored; ${removed.length} older removed.`);
    } catch (cause) {
      console.error('Pilot backup failed', cause);
    }
  };
  void backUp();
  setInterval(backUp, storage.backup.everyHours * 3600_000).unref();
}

// The WhatsApp bot: the engine host (headless Chromium with the app's engine) is started first,
// then the worker. If the engine host cannot start, the bot still runs: searches are by keyword
// only and index jobs wait in the queue until a later start.
if (whatsapp && bot) {
  // Chromium inherits this process's environment and needs none of the server's secrets.
  for (const name of [
    'PILOT_GOOGLE_CLIENT_SECRET',
    'PILOT_DATABASE_URL',
    'PILOT_BLOB_CONNECTION_STRING',
  ])
    delete process.env[name];
  const { stateDir } = whatsapp.engineHost;
  // A fresh profile on every start: it holds only the model cache and, while one item is being
  // indexed, that item, so nothing from an earlier run is kept.
  const profileDir = stateDir ? join(stateDir, 'chromium-profile') : undefined;
  if (profileDir) await rm(profileDir, { recursive: true, force: true });
  const host = new PlaywrightEngineHost({
    distDir: whatsapp.engineHost.distDir,
    modelsDir: whatsapp.engineHost.modelsDir,
    ...(profileDir ? { profileDir } : {}),
  });
  let engine: EngineHost | undefined = host;

  let stopping = false;
  const shutDown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`${signal}: stopping the WhatsApp bot and the engine host.`);
    setTimeout(() => process.exit(1), 20_000).unref();
    server.close();
    // Waiting confirmations are sent before the worker stops.
    await botRunner
      ?.stop()
      .catch((cause: unknown) => console.error('WhatsApp bot stop failed', cause));
    await host.close().catch((cause: unknown) => console.error('Engine host close failed', cause));
    if (profileDir) await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutDown('SIGTERM'));
  process.on('SIGINT', () => void shutDown('SIGINT'));

  const started = Date.now();
  try {
    await host.start();
    console.log(`WhatsApp engine host ready in ${((Date.now() - started) / 1000).toFixed(1)} s.`);
  } catch (cause) {
    console.error(
      'The WhatsApp engine host could not start. The bot runs with keyword search only; index jobs wait for a restart.',
      cause,
    );
    await host.close().catch(() => undefined);
    engine = undefined;
  }
  if (!stopping)
    botRunner = startWhatsAppBot({
      bot,
      store,
      objects,
      graph: createGraphClient({
        accessToken: whatsapp.accessToken,
        phoneNumberId: whatsapp.phoneNumberId,
        version: whatsapp.graphVersion,
      }),
      quotaBytes: config.quotaBytes,
      ...(engine
        ? {
            engine,
            onIndexJob: createWhatsAppIndexer({
              store,
              objects,
              engine,
              quotaBytes: config.quotaBytes,
            }),
          }
        : {}),
      origin: config.origin,
      privacyUrl: whatsapp.privacyUrl,
      contactEmail: whatsapp.contactEmail,
      noticeVersion: whatsapp.noticeVersion,
    });
}
