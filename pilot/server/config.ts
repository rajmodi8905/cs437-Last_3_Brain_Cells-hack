// Pilot server settings from environment variables, checked before anything starts.
export interface PilotConfig {
  projectId: string;
  origin: string;
  port: number;
  host: string;
  staticDir: string;
  quotaBytes: number;
  allowedEmailDomain: string;
  /** PEM private key for locally signed development tokens; only allowed on a local origin. */
  devKeyFile?: string;
  /** Public Firebase web-app settings for direct Google sign-in. */
  firebaseWeb?: { apiKey: string; authDomain: string };
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
  const projectId =
    env.PILOT_FIREBASE_PROJECT_ID || (devKeyFile ? 'campus-recall-pilot-dev' : undefined);
  if (!projectId) throw new Error('Set PILOT_FIREBASE_PROJECT_ID (or a local development key).');
  const quotaBytes = Number(env.PILOT_QUOTA_BYTES ?? 200_000_000);
  if (!Number.isSafeInteger(quotaBytes) || quotaBytes < 1)
    throw new Error('PILOT_QUOTA_BYTES must be a positive whole number.');
  const apiKey = env.PILOT_FIREBASE_API_KEY || undefined;
  const authDomain = env.PILOT_FIREBASE_AUTH_DOMAIN || undefined;
  if (!apiKey !== !authDomain)
    throw new Error('Set PILOT_FIREBASE_API_KEY and PILOT_FIREBASE_AUTH_DOMAIN together.');
  if (authDomain && (authDomain.includes('/') || !URL.canParse(`https://${authDomain}`)))
    throw new Error('PILOT_FIREBASE_AUTH_DOMAIN must be a host name.');
  return {
    projectId,
    ...(apiKey && authDomain ? { firebaseWeb: { apiKey, authDomain } } : {}),
    origin,
    port,
    host: env.PILOT_HOST ?? '127.0.0.1',
    staticDir: env.PILOT_STATIC_DIR ?? 'dist',
    quotaBytes,
    allowedEmailDomain: 'iitgn.ac.in',
    devKeyFile,
  };
}
