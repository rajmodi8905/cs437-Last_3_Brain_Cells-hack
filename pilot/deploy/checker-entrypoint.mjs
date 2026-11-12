// Local-only Docker entrypoint. The production image never uses this file.
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';

const origin = process.env.PILOT_ORIGIN ?? 'http://localhost:4600';
const url = new URL(origin);
if (
  !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
  !['http:', 'https:'].includes(url.protocol) ||
  url.origin !== origin
)
  throw new Error('The checker stack is only for a localhost origin. Use the production runbook.');
if (process.env.PILOT_GOOGLE_CLIENT_ID || process.env.PILOT_GOOGLE_CLIENT_SECRET)
  throw new Error('The checker stack uses development identities, not Google credentials.');

const key = '/app/checker-state/dev-private.pem';
if (!existsSync(key)) {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  writeFileSync(key, privateKey.export({ type: 'pkcs8', format: 'pem' }), {
    mode: 0o600,
    flag: 'wx',
  });
}
process.env.PILOT_DEV_KEY_FILE = key;
process.env.PILOT_ORIGIN = origin;
console.log(`AnyRecall checker: ${origin}`);
console.log('Local development sign-in: use a synthetic address such as checker@iitgn.ac.in.');
await import('/app/server/main.mjs');
