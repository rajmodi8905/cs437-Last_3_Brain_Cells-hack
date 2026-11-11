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
import { createTelegramApi } from './telegram/api';
import { createTelegramIndexer, refuseTelegramUser, startTelegramBot } from './telegram/bot';
import { createTelegramIntake } from './telegram/intake';
import { describeFailure, startTelegramPolling } from './telegram/poller';
import { PostgresTelegramStore } from './telegram/postgres';
import { MemoryTelegramStore, TELEGRAM_TABLES } from './telegram/store';
import { TELEGRAM_WEBHOOK_PATH } from './telegram/webhook';

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

// The opt-in Telegram channel (docs/pilot/telegram.md), only with its settings: its own tables
// (or memory), the same engine host, and long polling or Telegram's webhook.
const { telegram } = config;
const tgBot = telegram
  ? store instanceof PostgresPilotStore
    ? new PostgresBotStore(store, TELEGRAM_TABLES)
    : new MemoryBotStore()
  : undefined;
const tgState = telegram
  ? store instanceof PostgresPilotStore
    ? new PostgresTelegramStore(store)
    : new MemoryTelegramStore()
  : undefined;
const telegramApi = telegram ? createTelegramApi({ token: telegram.botToken }) : undefined;
let telegramRunner: ReturnType<typeof startTelegramBot> | undefined;
const telegramIntake =
  telegram && tgBot && telegramApi
    ? createTelegramIntake({
        bot: tgBot,
        ...(telegram.allowedUsers
          ? {
              allowed: {
                ids: new Set(telegram.allowedUsers.ids),
                usernames: new Set(telegram.allowedUsers.usernames),
              },
            }
          : {}),
        // Answered at once, even before the bot's worker starts; nothing of theirs is stored.
        onRefused: (refused) => void refuseTelegramUser(telegramApi, refused),
      })
    : undefined;

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
  ...(telegram && tgBot && telegramIntake
    ? {
        telegram: {
          bot: tgBot,
          ...(telegram.mode === 'webhook' && telegram.webhookSecret
            ? {
                webhook: {
                  secretToken: telegram.webhookSecret,
                  intake: telegramIntake,
                  onRecorded: () => telegramRunner?.wake(),
                },
              }
            : {}),
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
  if (telegram)
    console.log(
      telegram.mode === 'webhook'
        ? `Telegram channel on (webhook): ${config.origin}${TELEGRAM_WEBHOOK_PATH}.`
        : 'Telegram channel on (long polling).',
    );
  if (config.localTrial)
    console.log('Local trial: the app has no sign-in of its own here; open it from a bot link.');
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

// The chat bots: the engine host (headless Chromium with the app's engine) is started once for
// both channels, then their workers. If the engine host cannot start, the bots still run:
// searches are by keyword only and index jobs wait in the queue until a later start.
const engineHostConfig = (whatsapp ?? telegram)?.engineHost;
if (engineHostConfig && (bot || tgBot)) {
  // Chromium inherits this process's environment and needs none of the server's secrets.
  for (const name of [
    'PILOT_GOOGLE_CLIENT_SECRET',
    'PILOT_DATABASE_URL',
    'PILOT_BLOB_CONNECTION_STRING',
  ])
    delete process.env[name];
  const { stateDir } = engineHostConfig;
  // A fresh profile on every start: it holds only the model cache and, while one item is being
  // indexed, that item, so nothing from an earlier run is kept.
  const profileDir = stateDir ? join(stateDir, 'chromium-profile') : undefined;
  if (profileDir) await rm(profileDir, { recursive: true, force: true });
  const host = new PlaywrightEngineHost({
    distDir: engineHostConfig.distDir,
    modelsDir: engineHostConfig.modelsDir,
    ...(profileDir ? { profileDir } : {}),
  });
  let engine: EngineHost | undefined = host;
  let polling: ReturnType<typeof startTelegramPolling> | undefined;

  let stopping = false;
  const shutDown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`${signal}: stopping the chat bots and the engine host.`);
    setTimeout(() => process.exit(1), 20_000).unref();
    server.close();
    await polling?.stop().catch(() => undefined);
    // Waiting confirmations are sent before the workers stop.
    await botRunner
      ?.stop()
      .catch((cause: unknown) => console.error('WhatsApp bot stop failed', cause));
    await telegramRunner
      ?.stop()
      .catch((cause: unknown) => console.error('Telegram bot stop failed', describeFailure(cause)));
    await host.close().catch((cause: unknown) => console.error('Engine host close failed', cause));
    if (profileDir) await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutDown('SIGTERM'));
  process.on('SIGINT', () => void shutDown('SIGINT'));

  const started = Date.now();
  try {
    await host.start();
    console.log(`Engine host ready in ${((Date.now() - started) / 1000).toFixed(1)} s.`);
  } catch (cause) {
    console.error(
      'The engine host could not start. The bots run with keyword search only; index jobs wait for a restart.',
      cause,
    );
    await host.close().catch(() => undefined);
    engine = undefined;
  }
  if (!stopping && whatsapp && bot)
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
  if (!stopping && telegram && tgBot && tgState && telegramApi && telegramIntake) {
    const origin = new URL(config.origin);
    telegramRunner = startTelegramBot({
      bot: tgBot,
      state: tgState,
      store,
      objects,
      api: telegramApi,
      quotaBytes: config.quotaBytes,
      ...(engine
        ? {
            engine,
            onIndexJob: createTelegramIndexer({
              store,
              objects,
              engine,
              quotaBytes: config.quotaBytes,
            }),
          }
        : {}),
      origin: config.origin,
      // Telegram buttons and phones cannot open a loopback address.
      appLinks: origin.protocol === 'https:',
      privacyUrl: telegram.privacyUrl,
      contactEmail: telegram.contactEmail,
      noticeVersion: telegram.noticeVersion,
      log: (message, detail) =>
        console.error(message, detail instanceof Error ? describeFailure(detail) : detail),
    });
    const me = await telegramApi.getMe().catch((cause: unknown) => {
      console.error('Telegram getMe failed', describeFailure(cause));
      return undefined;
    });
    if (me?.username) console.log(`Telegram bot @${me.username} is answering.`);
    if (telegram.mode === 'webhook' && telegram.webhookSecret) {
      await telegramApi
        .setWebhook({
          url: `${config.origin}${TELEGRAM_WEBHOOK_PATH}`,
          secretToken: telegram.webhookSecret,
        })
        .then(() => console.log('Telegram webhook set.'))
        .catch((cause: unknown) =>
          console.error('Telegram setWebhook failed', describeFailure(cause)),
        );
    } else
      polling = startTelegramPolling({
        api: telegramApi,
        state: tgState,
        intake: telegramIntake,
        onRecorded: () => telegramRunner?.wake(),
      });
  }
}
