// Pilot server settings from environment variables, checked before anything starts.
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
  return {
    kind: 'durable',
    databaseUrl,
    schema,
    blob: accountUrl
      ? { accountUrl, container, ...(clientId ? { clientId } : {}) }
      : { connectionString: connectionString!, container },
  };
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

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
  const googleId = env.PILOT_GOOGLE_CLIENT_ID || undefined;
  const clientSecret = env.PILOT_GOOGLE_CLIENT_SECRET || undefined;
  if (!googleId !== !clientSecret)
    throw new Error('Set PILOT_GOOGLE_CLIENT_ID and PILOT_GOOGLE_CLIENT_SECRET together.');
  if (googleId && devKeyFile)
    throw new Error('Use either Google sign-in or a development key, not both.');
  const clientId = googleId ?? (devKeyFile ? 'campus-recall-pilot-dev' : undefined);
  if (!clientId)
    throw new Error(
      'Set PILOT_GOOGLE_CLIENT_ID and PILOT_GOOGLE_CLIENT_SECRET (or a local development key).',
    );
  const quotaBytes = Number(env.PILOT_QUOTA_BYTES ?? 200_000_000);
  if (!Number.isSafeInteger(quotaBytes) || quotaBytes < 1)
    throw new Error('PILOT_QUOTA_BYTES must be a positive whole number.');
  return {
    clientId,
    ...(clientSecret ? { clientSecret } : {}),
    origin,
    port,
    host: env.PILOT_HOST ?? '127.0.0.1',
    staticDir: env.PILOT_STATIC_DIR ?? 'dist',
    quotaBytes,
    allowedEmailDomain: 'iitgn.ac.in',
    devKeyFile,
    storage: loadStorage(env, local),
  };
}
