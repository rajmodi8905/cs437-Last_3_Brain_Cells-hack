// Pilot server settings from environment variables, checked before anything starts.
export interface PilotConfig {
  projectId: string;
  origin: string;
  port: number;
  host: string;
  staticDir: string;
  quotaBytes: number;
  allowedEmailDomain: string;
  /** PEM public key for locally signed test tokens; only allowed on a local origin. */
  devPublicKeyFile?: string;
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
  const devPublicKeyFile = env.PILOT_DEV_PUBLIC_KEY_FILE || undefined;
  if (devPublicKeyFile && !local)
    throw new Error('A development signing key is only allowed on a local origin.');
  const projectId =
    env.PILOT_FIREBASE_PROJECT_ID || (devPublicKeyFile ? 'campus-recall-pilot-dev' : undefined);
  if (!projectId) throw new Error('Set PILOT_FIREBASE_PROJECT_ID (or a local development key).');
  const quotaBytes = Number(env.PILOT_QUOTA_BYTES ?? 200_000_000);
  if (!Number.isSafeInteger(quotaBytes) || quotaBytes < 1)
    throw new Error('PILOT_QUOTA_BYTES must be a positive whole number.');
  return {
    projectId,
    origin,
    port,
    host: env.PILOT_HOST ?? '127.0.0.1',
    staticDir: env.PILOT_STATIC_DIR ?? 'dist',
    quotaBytes,
    allowedEmailDomain: 'iitgn.ac.in',
    devPublicKeyFile,
  };
}
