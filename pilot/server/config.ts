// Pilot server settings from environment variables, checked before anything starts.
import { readFileSync } from 'node:fs';
import { GRAPH_API_VERSION } from './whatsapp/graph';

export interface PilotConfig {
  /** Google OAuth client ID, or a fixed local ID with a development key. */
  clientId: string;
  /** Google OAuth client secret; absent only with a development key. */
  clientSecret?: string;
  origin: string;
  port: number;
  host: string;
  staticDir: string;
  quotaBytes: number;
  allowedEmailDomain: string;
  /** PEM private key for locally signed development tokens; only allowed on a local origin. */
  devKeyFile?: string;
  storage: StorageConfig;
  /** Behind our own HTTPS proxy, which appends the client address to X-Forwarded-For. */
  trustProxy: boolean;
  signInPerMinute: number;
  /** The opt-in WhatsApp channel (docs/pilot/whatsapp.md); absent, the channel is off. */
  whatsapp?: WhatsAppConfig;
  /** The opt-in Telegram channel (docs/pilot/telegram.md); absent, the channel is off. */
  telegram?: TelegramConfig;
  /**
   * A short trial of a chat channel on a developer's computer (docs/pilot/whatsapp-setup.md,
   * docs/pilot/telegram-setup.md). Present only when it is on.
   */
  localTrial?: true;
}

export interface EngineHostConfig {
  /** The engine host build (`npm run build:engine-host`). */
  distDir: string;
  /** Pinned model files named by SHA-256 (`npm run models:download`). */
  modelsDir: string;
  /** A writable directory for Chromium's profile; a temporary one when absent. */
  stateDir?: string;
}

export interface TelegramConfig {
  /** The bot token, read from its file; never logged, never in a command line. */
  botToken: string;
  /** `polling` (long polling, no public address needed) or `webhook`. */
  mode: 'polling' | 'webhook';
  /** The webhook's secret token, read from its file; webhook mode only. */
  webhookSecret?: string;
  /** Only these users may use the bot (a demo); absent, everyone may. */
  allowedUsers?: { ids: string[]; usernames: string[] };
  privacyUrl: string;
  contactEmail: string;
  noticeVersion: string;
  /** The same engine host as the WhatsApp channel; one is started for both. */
  engineHost: EngineHostConfig;
}

export interface WhatsAppConfig {
  /** Secrets, read from their files; never logged. */
  verifyToken: string;
  appSecret: string;
  accessToken: string;
  phoneNumberId: string;
  graphVersion: string;
  privacyUrl: string;
  contactEmail: string;
  noticeVersion: string;
  engineHost: EngineHostConfig;
}

export type StorageConfig =
  | { kind: 'memory' }
  | {
      kind: 'durable';
      /** PostgreSQL connection URL; it may contain a password, so it is never logged. */
      databaseUrl: string;
      schema: string;
      blob:
        | { accountUrl: string; container: string; clientId?: string }
        | { connectionString: string; container: string };
      /** Database backups go to their own container in the same account. */
      backup: { container: string; everyHours: number; keep: number };
    };

const SCHEMA = /^[a-z_][a-z0-9_]{0,62}$/;
const CONTAINER = /^[a-z0-9](?!.*--)[a-z0-9-]{1,61}[a-z0-9]$/;

function loadStorage(env: Record<string, string | undefined>, local: boolean): StorageConfig {
  const databaseUrl = env.PILOT_DATABASE_URL || undefined;
  const accountUrl = env.PILOT_BLOB_ACCOUNT_URL || undefined;
  const connectionString = env.PILOT_BLOB_CONNECTION_STRING || undefined;
  if (!databaseUrl && !accountUrl && !connectionString) {
    if (!local)
      throw new Error(
        'A public pilot needs durable storage: set PILOT_DATABASE_URL and PILOT_BLOB_ACCOUNT_URL.',
      );
    return { kind: 'memory' };
  }
  if (!databaseUrl || (!accountUrl && !connectionString))
    throw new Error('Set PILOT_DATABASE_URL together with Blob storage, or neither.');
  if (accountUrl && connectionString)
    throw new Error('Use PILOT_BLOB_ACCOUNT_URL or PILOT_BLOB_CONNECTION_STRING, not both.');
  if (connectionString && !local)
    throw new Error(
      'A storage connection string is for local development; on Azure use PILOT_BLOB_ACCOUNT_URL with the managed identity.',
    );
  const schema = env.PILOT_DATABASE_SCHEMA ?? 'pilot';
  if (!SCHEMA.test(schema))
    throw new Error('PILOT_DATABASE_SCHEMA must be a plain lowercase name.');
  const container = env.PILOT_BLOB_CONTAINER ?? 'pilot';
  if (!CONTAINER.test(container))
    throw new Error('PILOT_BLOB_CONTAINER must be a valid Blob container name.');
  if (accountUrl) {
    const url = URL.canParse(accountUrl) ? new URL(accountUrl) : undefined;
    if (url?.protocol !== 'https:' || url.origin !== accountUrl.replace(/\/$/, ''))
      throw new Error('PILOT_BLOB_ACCOUNT_URL must be the HTTPS account endpoint.');
  }
  const clientId = env.PILOT_MANAGED_IDENTITY_CLIENT_ID || undefined;
  const backupContainer = env.PILOT_BACKUP_CONTAINER ?? 'pilot-backups';
  if (!CONTAINER.test(backupContainer))
    throw new Error('PILOT_BACKUP_CONTAINER must be a valid Blob container name.');
  if (backupContainer === container)
    throw new Error('Backups need a separate container from the originals.');
  const everyHours = Number(env.PILOT_BACKUP_EVERY_HOURS ?? 24);
  if (!Number.isInteger(everyHours) || everyHours < 1 || everyHours > 168)
    throw new Error('PILOT_BACKUP_EVERY_HOURS must be a whole number from 1 to 168.');
  const keep = Number(env.PILOT_BACKUP_KEEP ?? 14);
  if (!Number.isInteger(keep) || keep < 2 || keep > 365)
    throw new Error('PILOT_BACKUP_KEEP must be a whole number from 2 to 365.');
  return {
    kind: 'durable',
    databaseUrl,
    schema,
    blob: accountUrl
      ? { accountUrl, container, ...(clientId ? { clientId } : {}) }
      : { connectionString: connectionString!, container },
    backup: { container: backupContainer, everyHours, keep },
  };
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const LOOPBACK_LISTEN = new Set(['127.0.0.1', '::1', 'localhost']);

/** Settings the channel cannot run without; all of them or none. */
const WHATSAPP_REQUIRED = [
  'PILOT_WHATSAPP_VERIFY_TOKEN_FILE',
  'PILOT_WHATSAPP_APP_SECRET_FILE',
  'PILOT_WHATSAPP_ACCESS_TOKEN_FILE',
  'PILOT_WHATSAPP_PHONE_NUMBER_ID',
  'PILOT_WHATSAPP_PRIVACY_URL',
  'PILOT_WHATSAPP_CONTACT_EMAIL',
] as const;
/** Optional settings that mean nothing without the channel. */
const WHATSAPP_OPTIONAL = [
  'PILOT_WHATSAPP_GRAPH_VERSION',
  'PILOT_WHATSAPP_NOTICE_VERSION',
] as const;
/** The engine host's settings, for either chat channel. */
const ENGINE_HOST_OPTIONAL = [
  'PILOT_ENGINE_HOST_DIST',
  'PILOT_ENGINE_HOST_MODELS',
  'PILOT_ENGINE_HOST_STATE_DIR',
] as const;
/** Settings the Telegram channel cannot run without; all of them or none. */
const TELEGRAM_REQUIRED = [
  'PILOT_TELEGRAM_BOT_TOKEN_FILE',
  'PILOT_TELEGRAM_PRIVACY_URL',
  'PILOT_TELEGRAM_CONTACT_EMAIL',
] as const;
const TELEGRAM_OPTIONAL = [
  'PILOT_TELEGRAM_MODE',
  'PILOT_TELEGRAM_WEBHOOK_SECRET_FILE',
  'PILOT_TELEGRAM_ALLOWED_USERS',
  'PILOT_TELEGRAM_NOTICE_VERSION',
] as const;

/** One secret value from its file. Errors name the setting, never the path's contents. */
function readSecretFile(name: string, path: string) {
  let value: string;
  try {
    value = readFileSync(path, 'utf8').trim();
  } catch {
    throw new Error(`${name} names a file that cannot be read.`);
  }
  if (!value) throw new Error(`${name} names an empty file.`);
  if (/\s/.test(value)) throw new Error(`${name} must hold one value on one line.`);
  return value;
}

function loadEngineHost(env: Record<string, string | undefined>): EngineHostConfig {
  const stateDir = env.PILOT_ENGINE_HOST_STATE_DIR || undefined;
  return {
    distDir: env.PILOT_ENGINE_HOST_DIST || '.cache/engine-host-dist',
    modelsDir: env.PILOT_ENGINE_HOST_MODELS || '.models',
    ...(stateDir ? { stateDir } : {}),
  };
}

function loadWhatsApp(env: Record<string, string | undefined>): WhatsAppConfig | undefined {
  const set = (name: string) => !!env[name];
  if (!WHATSAPP_REQUIRED.some(set)) {
    const stray = WHATSAPP_OPTIONAL.find(set);
    if (stray) throw new Error(`${stray} only applies with the WhatsApp channel settings.`);
    return undefined;
  }
  const missing = WHATSAPP_REQUIRED.filter((name) => !set(name));
  if (missing.length)
    throw new Error(`Set every WhatsApp setting or none; missing: ${missing.join(', ')}.`);
  const phoneNumberId = env.PILOT_WHATSAPP_PHONE_NUMBER_ID!;
  if (!/^\d{1,32}$/.test(phoneNumberId))
    throw new Error("PILOT_WHATSAPP_PHONE_NUMBER_ID must be Meta's numeric phone number ID.");
  const graphVersion = env.PILOT_WHATSAPP_GRAPH_VERSION || GRAPH_API_VERSION;
  if (!/^v\d{1,3}\.\d{1,2}$/.test(graphVersion))
    throw new Error('PILOT_WHATSAPP_GRAPH_VERSION must look like v27.0.');
  const privacyUrl = env.PILOT_WHATSAPP_PRIVACY_URL!;
  if (!URL.canParse(privacyUrl) || new URL(privacyUrl).protocol !== 'https:')
    throw new Error('PILOT_WHATSAPP_PRIVACY_URL must be an HTTPS address.');
  const contactEmail = env.PILOT_WHATSAPP_CONTACT_EMAIL!;
  if (contactEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail))
    throw new Error('PILOT_WHATSAPP_CONTACT_EMAIL must be an email address.');
  const noticeVersion = env.PILOT_WHATSAPP_NOTICE_VERSION || '1';
  if (!/^[\w.-]{1,40}$/.test(noticeVersion))
    throw new Error('PILOT_WHATSAPP_NOTICE_VERSION must be a short plain label.');
  return {
    verifyToken: readSecretFile(
      'PILOT_WHATSAPP_VERIFY_TOKEN_FILE',
      env.PILOT_WHATSAPP_VERIFY_TOKEN_FILE!,
    ),
    appSecret: readSecretFile(
      'PILOT_WHATSAPP_APP_SECRET_FILE',
      env.PILOT_WHATSAPP_APP_SECRET_FILE!,
    ),
    accessToken: readSecretFile(
      'PILOT_WHATSAPP_ACCESS_TOKEN_FILE',
      env.PILOT_WHATSAPP_ACCESS_TOKEN_FILE!,
    ),
    phoneNumberId,
    graphVersion,
    privacyUrl,
    contactEmail,
    noticeVersion,
    engineHost: loadEngineHost(env),
  };
}

/** Comma-separated numeric user IDs and @usernames. */
function parseAllowedUsers(value: string) {
  const ids: string[] = [];
  const usernames: string[] = [];
  for (const raw of value.split(',')) {
    const entry = raw.trim();
    if (!entry) continue;
    if (/^[1-9]\d{0,19}$/.test(entry)) ids.push(entry);
    else if (/^@?[A-Za-z][A-Za-z0-9_]{3,31}$/.test(entry))
      usernames.push(entry.replace(/^@/, '').toLowerCase());
    else
      throw new Error(
        'PILOT_TELEGRAM_ALLOWED_USERS must list numeric Telegram user IDs or @usernames, separated by commas.',
      );
  }
  if (!ids.length && !usernames.length)
    throw new Error('PILOT_TELEGRAM_ALLOWED_USERS names nobody; leave it unset to allow everyone.');
  return { ids, usernames };
}

function loadTelegram(env: Record<string, string | undefined>): TelegramConfig | undefined {
  const set = (name: string) => !!env[name];
  if (!TELEGRAM_REQUIRED.some(set)) {
    const stray = TELEGRAM_OPTIONAL.find(set);
    if (stray) throw new Error(`${stray} only applies with the Telegram channel settings.`);
    return undefined;
  }
  const missing = TELEGRAM_REQUIRED.filter((name) => !set(name));
  if (missing.length)
    throw new Error(`Set every Telegram setting or none; missing: ${missing.join(', ')}.`);
  const mode = env.PILOT_TELEGRAM_MODE || 'polling';
  if (mode !== 'polling' && mode !== 'webhook')
    throw new Error('PILOT_TELEGRAM_MODE must be polling or webhook.');
  if (mode === 'polling' && set('PILOT_TELEGRAM_WEBHOOK_SECRET_FILE'))
    throw new Error(
      'PILOT_TELEGRAM_WEBHOOK_SECRET_FILE only applies with PILOT_TELEGRAM_MODE=webhook.',
    );
  if (mode === 'webhook' && !set('PILOT_TELEGRAM_WEBHOOK_SECRET_FILE'))
    throw new Error('PILOT_TELEGRAM_MODE=webhook needs PILOT_TELEGRAM_WEBHOOK_SECRET_FILE.');
  const privacyUrl = env.PILOT_TELEGRAM_PRIVACY_URL!;
  if (!URL.canParse(privacyUrl) || new URL(privacyUrl).protocol !== 'https:')
    throw new Error('PILOT_TELEGRAM_PRIVACY_URL must be an HTTPS address.');
  const contactEmail = env.PILOT_TELEGRAM_CONTACT_EMAIL!;
  if (contactEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail))
    throw new Error('PILOT_TELEGRAM_CONTACT_EMAIL must be an email address.');
  const noticeVersion = env.PILOT_TELEGRAM_NOTICE_VERSION || '1';
  if (!/^[\w.-]{1,40}$/.test(noticeVersion))
    throw new Error('PILOT_TELEGRAM_NOTICE_VERSION must be a short plain label.');
  const botToken = readSecretFile(
    'PILOT_TELEGRAM_BOT_TOKEN_FILE',
    env.PILOT_TELEGRAM_BOT_TOKEN_FILE!,
  );
  // BotFather's format: the bot's numeric ID, a colon and a secret part.
  if (!/^\d{3,20}:[A-Za-z0-9_-]{30,80}$/.test(botToken))
    throw new Error('PILOT_TELEGRAM_BOT_TOKEN_FILE must hold a bot token from BotFather.');
  let webhookSecret: string | undefined;
  if (mode === 'webhook') {
    webhookSecret = readSecretFile(
      'PILOT_TELEGRAM_WEBHOOK_SECRET_FILE',
      env.PILOT_TELEGRAM_WEBHOOK_SECRET_FILE!,
    );
    // Telegram accepts 1 to 256 of these characters as a secret token.
    if (!/^[A-Za-z0-9_-]{16,256}$/.test(webhookSecret))
      throw new Error(
        'PILOT_TELEGRAM_WEBHOOK_SECRET_FILE must hold 16 to 256 letters, digits, _ or -.',
      );
  }
  const allowed = env.PILOT_TELEGRAM_ALLOWED_USERS;
  return {
    botToken,
    mode,
    ...(webhookSecret ? { webhookSecret } : {}),
    ...(allowed ? { allowedUsers: parseAllowedUsers(allowed) } : {}),
    privacyUrl,
    contactEmail,
    noticeVersion,
    engineHost: loadEngineHost(env),
  };
}

export function loadConfig(env: Record<string, string | undefined>): PilotConfig {
  const port = Number(env.PILOT_PORT ?? '4600');
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('PILOT_PORT must be a port number.');
  const origin = env.PILOT_ORIGIN ?? `http://127.0.0.1:${port}`;
  const url = new URL(origin);
  if (url.origin !== origin) throw new Error('PILOT_ORIGIN must be a bare origin without a path.');
  const local = LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== 'https:' && !local)
    throw new Error('PILOT_ORIGIN must use HTTPS unless it is local.');
  const devKeyFile = env.PILOT_DEV_KEY_FILE || undefined;
  // A Telegram local trial behind a tunnel may use one too; checked with the trial below.
  if (devKeyFile && !local && env.PILOT_TELEGRAM_LOCAL_TRIAL !== '1')
    throw new Error('A development signing key is only allowed on a local origin.');
  const host = env.PILOT_HOST ?? '127.0.0.1';
  const whatsapp = loadWhatsApp(env);
  const telegram = loadTelegram(env);
  if (!whatsapp && !telegram) {
    const stray = ENGINE_HOST_OPTIONAL.find((name) => !!env[name]);
    if (stray)
      throw new Error(`${stray} only applies with the WhatsApp or Telegram channel settings.`);
  }
  // A WhatsApp trial on a developer's computer: Meta and phones reach it through an HTTPS
  // tunnel, so the origin is public, but the server listens on loopback only and its data is
  // local and short-lived. Development sign-in stays off (anyone with the tunnel's address could
  // use it); the app is opened from the bot's one-time links.
  if (
    env.PILOT_WHATSAPP_LOCAL_TRIAL !== undefined &&
    !['0', '1'].includes(env.PILOT_WHATSAPP_LOCAL_TRIAL)
  )
    throw new Error('PILOT_WHATSAPP_LOCAL_TRIAL must be 0 or 1.');
  const whatsappTrial = env.PILOT_WHATSAPP_LOCAL_TRIAL === '1';
  if (whatsappTrial) {
    if (!whatsapp)
      throw new Error('PILOT_WHATSAPP_LOCAL_TRIAL needs the WhatsApp channel settings.');
    if (local || url.protocol !== 'https:')
      throw new Error(
        "PILOT_WHATSAPP_LOCAL_TRIAL needs the tunnel's HTTPS origin as PILOT_ORIGIN.",
      );
    if (!LOOPBACK_LISTEN.has(host))
      throw new Error('PILOT_WHATSAPP_LOCAL_TRIAL needs PILOT_HOST to be a loopback address.');
    if (devKeyFile) throw new Error('PILOT_WHATSAPP_LOCAL_TRIAL runs without development sign-in.');
  }
  // A Telegram trial on a developer's computer: long polling needs no public address, so the
  // origin may be local (links then only explain that they need a tunnel) or a tunnel's HTTPS
  // address. As for WhatsApp, the server listens on loopback only and its data is local. Google's
  // OAuth client accepts only the pilot domain's callback, so linking a Telegram user to an
  // account uses development sign-in here; behind a tunnel that is allowed only with memory
  // storage, so a trial never holds anything that lasts. Real IITGN login is tried on the pilot.
  if (
    env.PILOT_TELEGRAM_LOCAL_TRIAL !== undefined &&
    !['0', '1'].includes(env.PILOT_TELEGRAM_LOCAL_TRIAL)
  )
    throw new Error('PILOT_TELEGRAM_LOCAL_TRIAL must be 0 or 1.');
  const telegramTrial = env.PILOT_TELEGRAM_LOCAL_TRIAL === '1';
  if (telegramTrial) {
    if (!telegram)
      throw new Error('PILOT_TELEGRAM_LOCAL_TRIAL needs the Telegram channel settings.');
    if (!local && url.protocol !== 'https:')
      throw new Error(
        "PILOT_TELEGRAM_LOCAL_TRIAL needs a local origin or the tunnel's HTTPS origin.",
      );
    if (!LOOPBACK_LISTEN.has(host))
      throw new Error('PILOT_TELEGRAM_LOCAL_TRIAL needs PILOT_HOST to be a loopback address.');
    const durable =
      env.PILOT_DATABASE_URL || env.PILOT_BLOB_ACCOUNT_URL || env.PILOT_BLOB_CONNECTION_STRING;
    if (devKeyFile && !local && durable)
      throw new Error(
        'PILOT_TELEGRAM_LOCAL_TRIAL with development sign-in behind a tunnel runs on memory storage only.',
      );
  }
  // Telegram only delivers webhooks to HTTPS addresses.
  if (telegram?.mode === 'webhook' && url.protocol !== 'https:')
    throw new Error('PILOT_TELEGRAM_MODE=webhook needs an HTTPS PILOT_ORIGIN.');
  const localTrial = whatsappTrial || telegramTrial;
  const googleId = env.PILOT_GOOGLE_CLIENT_ID || undefined;
  const clientSecret = env.PILOT_GOOGLE_CLIENT_SECRET || undefined;
  if (!googleId !== !clientSecret)
    throw new Error('Set PILOT_GOOGLE_CLIENT_ID and PILOT_GOOGLE_CLIENT_SECRET together.');
  if (googleId && devKeyFile)
    throw new Error('Use either Google sign-in or a development key, not both.');
  const clientId =
    googleId ??
    (devKeyFile ? 'campus-recall-pilot-dev' : localTrial ? 'campus-recall-local-trial' : undefined);
  if (!clientId)
    throw new Error(
      'Set PILOT_GOOGLE_CLIENT_ID and PILOT_GOOGLE_CLIENT_SECRET (or a local development key).',
    );
  const signInPerMinute = Number(env.PILOT_SIGN_IN_PER_MINUTE ?? 10);
  if (!Number.isSafeInteger(signInPerMinute) || signInPerMinute < 1)
    throw new Error('PILOT_SIGN_IN_PER_MINUTE must be a positive whole number.');
  if (env.PILOT_TRUST_PROXY !== undefined && !['0', '1'].includes(env.PILOT_TRUST_PROXY))
    throw new Error('PILOT_TRUST_PROXY must be 0 or 1.');
  const quotaBytes = Number(env.PILOT_QUOTA_BYTES ?? 200_000_000);
  if (!Number.isSafeInteger(quotaBytes) || quotaBytes < 1)
    throw new Error('PILOT_QUOTA_BYTES must be a positive whole number.');
  return {
    clientId,
    ...(clientSecret ? { clientSecret } : {}),
    origin,
    port,
    host,
    staticDir: env.PILOT_STATIC_DIR ?? 'dist',
    quotaBytes,
    allowedEmailDomain: 'iitgn.ac.in',
    devKeyFile,
    storage: loadStorage(env, local || localTrial),
    trustProxy: env.PILOT_TRUST_PROXY === '1',
    signInPerMinute,
    ...(whatsapp ? { whatsapp } : {}),
    ...(telegram ? { telegram } : {}),
    ...(localTrial ? { localTrial: true as const } : {}),
  };
}
