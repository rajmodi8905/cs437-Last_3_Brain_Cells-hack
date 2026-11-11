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
  /**
   * A short trial of the WhatsApp channel on a developer's computer behind an HTTPS tunnel
   * (docs/pilot/whatsapp-setup.md). Present only when it is on.
   */
  localTrial?: true;
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
  engineHost: {
    /** The engine host build (`npm run build:engine-host`). */
    distDir: string;
    /** Pinned model files named by SHA-256 (`npm run models:download`). */
    modelsDir: string;
    /** A writable directory for Chromium's profile; a temporary one when absent. */
    stateDir?: string;
  };
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
  'PILOT_ENGINE_HOST_DIST',
  'PILOT_ENGINE_HOST_MODELS',
  'PILOT_ENGINE_HOST_STATE_DIR',
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
  const stateDir = env.PILOT_ENGINE_HOST_STATE_DIR || undefined;
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
    engineHost: {
      distDir: env.PILOT_ENGINE_HOST_DIST || '.cache/engine-host-dist',
      modelsDir: env.PILOT_ENGINE_HOST_MODELS || '.models',
      ...(stateDir ? { stateDir } : {}),
    },
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
  if (devKeyFile && !local)
    throw new Error('A development signing key is only allowed on a local origin.');
  const host = env.PILOT_HOST ?? '127.0.0.1';
  const whatsapp = loadWhatsApp(env);
  // A WhatsApp trial on a developer's computer: Meta and phones reach it through an HTTPS
  // tunnel, so the origin is public, but the server listens on loopback only and its data is
  // local and short-lived. Development sign-in stays off (anyone with the tunnel's address could
  // use it); the app is opened from the bot's one-time links.
  if (
    env.PILOT_WHATSAPP_LOCAL_TRIAL !== undefined &&
    !['0', '1'].includes(env.PILOT_WHATSAPP_LOCAL_TRIAL)
  )
    throw new Error('PILOT_WHATSAPP_LOCAL_TRIAL must be 0 or 1.');
  const localTrial = env.PILOT_WHATSAPP_LOCAL_TRIAL === '1';
  if (localTrial) {
    if (!whatsapp)
      throw new Error('PILOT_WHATSAPP_LOCAL_TRIAL needs the WhatsApp channel settings.');
    if (local || url.protocol !== 'https:')
      throw new Error(
        "PILOT_WHATSAPP_LOCAL_TRIAL needs the tunnel's HTTPS origin as PILOT_ORIGIN.",
      );
    if (!LOOPBACK_LISTEN.has(host))
      throw new Error('PILOT_WHATSAPP_LOCAL_TRIAL needs PILOT_HOST to be a loopback address.');
  }
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
    ...(localTrial ? { localTrial: true as const } : {}),
  };
}
