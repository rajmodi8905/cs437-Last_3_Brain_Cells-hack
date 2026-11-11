// Compose mounts these files only into the services that need them. Never print their values.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const readSecret = async (file) => {
  const value = (await readFile(file, 'utf8')).trim();
  if (!value) throw new Error('A required deployment secret file is empty.');
  return value;
};

if (process.env.PILOT_GOOGLE_CLIENT_SECRET_FILE) {
  process.env.PILOT_GOOGLE_CLIENT_SECRET = await readSecret(
    process.env.PILOT_GOOGLE_CLIENT_SECRET_FILE,
  );
}
if (process.env.PILOT_DATABASE_PASSWORD_FILE) {
  const password = await readSecret(process.env.PILOT_DATABASE_PASSWORD_FILE);
  process.env.PILOT_DATABASE_URL = `postgresql://pilot:${encodeURIComponent(password)}@postgres:5432/pilot`;
}

// The WhatsApp secrets are read by the server from their files (config.ts), so they never enter
// the environment that the engine host's Chromium inherits. Only check them here.
for (const name of [
  'PILOT_WHATSAPP_VERIFY_TOKEN_FILE',
  'PILOT_WHATSAPP_APP_SECRET_FILE',
  'PILOT_WHATSAPP_ACCESS_TOKEN_FILE',
]) {
  if (process.env[name]) await readSecret(process.env[name]);
}

const [script, ...args] = process.argv.slice(2);
if (!['/app/server/main.mjs', '/app/server/backup.mjs'].includes(script))
  throw new Error('Use the bundled main.mjs or backup.mjs entrypoint.');
process.argv = [process.execPath, script, ...args];
await import(pathToFileURL(script).href);
