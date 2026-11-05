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
  };
}
