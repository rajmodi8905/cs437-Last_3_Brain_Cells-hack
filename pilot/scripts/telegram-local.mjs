// Runs the pilot server on this computer with the Telegram channel on, by long polling, for a
// trial with the team's bot (docs/pilot/telegram-setup.md, "Try it locally").
//
//   npm run pilot:telegram-local [-- --origin https://<tunnel host>] [--port 4600] [--contact you@iitgn.ac.in]
//
// Settings come from a private folder outside the repository, ~/.config/campus-recall/telegram/
// (or CAMPUS_RECALL_TELEGRAM_DIR): the file bot_token, and optionally settings.env with plain
// PILOT_* settings. This script never reads bot_token; it passes its path, and the server reads
// it. Nothing secret goes on a command line or in the output. Long polling needs no public
// address; --origin (an HTTPS tunnel to this port) is needed for /login and /open links on a
// phone. Google's OAuth client only accepts the pilot domain's callback, so linking a Telegram
// user here uses development sign-in with a throwaway local key (the server allows that only on
// this loopback-bound trial with memory storage); real IITGN login is tried on the pilot.
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const { values } = parseArgs({
  options: {
    origin: { type: 'string' },
    port: { type: 'string', default: '4600' },
    contact: { type: 'string' },
  },
});
if (!/^\d{1,5}$/.test(values.port)) fail('--port must be a port number.');
const dir =
  process.env.CAMPUS_RECALL_TELEGRAM_DIR || join(homedir(), '.config', 'campus-recall', 'telegram');
if (!existsSync(dir)) fail(`Create ${dir} first (see docs/pilot/telegram-setup.md).`);

// The token: only checked to exist and be private; its contents are read by the server.
const tokenPath = join(dir, 'bot_token');
if (!existsSync(tokenPath)) fail(`Missing ${tokenPath}.`);
if (statSync(tokenPath).mode & 0o077)
  console.warn(`${tokenPath} can be read by other users; run: chmod 600 "${tokenPath}"`);

// settings.env (optional): KEY=VALUE lines. Only these plain settings are passed to the server.
const PASSED = new Set([
  'PILOT_TELEGRAM_CONTACT_EMAIL',
  'PILOT_TELEGRAM_PRIVACY_URL',
  'PILOT_TELEGRAM_ALLOWED_USERS',
  'PILOT_TELEGRAM_NOTICE_VERSION',
]);
const settings = {};
const settingsPath = join(dir, 'settings.env');
if (existsSync(settingsPath))
  for (const line of readFileSync(settingsPath, 'utf8').split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || line.trimStart().startsWith('#')) continue;
    const [, key, raw] = match;
    if (PASSED.has(key)) settings[key] = raw.replace(/^(['"])(.*)\1$/, '$2');
  }

let origin = `http://127.0.0.1:${values.port}`;
if (values.origin) {
  if (!URL.canParse(values.origin) || new URL(values.origin).protocol !== 'https:')
    fail("--origin must be the tunnel's https:// address.");
  origin = new URL(values.origin).origin;
}
const contact =
  values.contact ??
  process.env.PILOT_TELEGRAM_CONTACT_EMAIL ??
  settings.PILOT_TELEGRAM_CONTACT_EMAIL;
if (!contact)
  fail(
    'Give the contact email that /help shows: --contact you@iitgn.ac.in (or PILOT_TELEGRAM_CONTACT_EMAIL in settings.env).',
  );

if (!existsSync('dist/index.html')) fail('Missing dist/index.html; run npm run build first.');
// Without these the bot still runs, with search by title keywords only.
for (const [path, command] of [
  ['.cache/engine-host-dist/asset-manifest.json', 'npm run build:engine-host'],
  ['.models', 'npm run models:download'],
]) {
  if (!existsSync(path))
    console.warn(`Missing ${path} (run ${command}); search is by keyword only until then.`);
}
execFileSync(process.execPath, ['pilot/scripts/build-server.mjs'], { stdio: 'inherit' });
// The throwaway development signing key, made once in the ignored .cache/.
execFileSync(process.execPath, ['pilot/scripts/dev-key.mjs'], { stdio: 'inherit' });

const env = { ...process.env };
// Google sign-in, durable storage and webhook settings do not belong to a polling trial.
for (const name of [
  'PILOT_TELEGRAM_WEBHOOK_SECRET_FILE',
  'PILOT_GOOGLE_CLIENT_ID',
  'PILOT_GOOGLE_CLIENT_SECRET',
  'PILOT_DATABASE_URL',
  'PILOT_BLOB_ACCOUNT_URL',
  'PILOT_BLOB_CONNECTION_STRING',
])
  delete env[name];
Object.assign(env, settings, {
  PILOT_DEV_KEY_FILE: '.cache/pilot-dev-key/dev-private.pem',
  PILOT_ORIGIN: origin,
  PILOT_HOST: '127.0.0.1',
  PILOT_PORT: values.port,
  PILOT_TELEGRAM_LOCAL_TRIAL: '1',
  PILOT_TELEGRAM_MODE: 'polling',
  PILOT_TELEGRAM_BOT_TOKEN_FILE: tokenPath,
  PILOT_TELEGRAM_CONTACT_EMAIL: contact,
  PILOT_TELEGRAM_PRIVACY_URL:
    settings.PILOT_TELEGRAM_PRIVACY_URL ??
    'https://github.com/rajmodi8905/cs437-Last_3_Brain_Cells-hack/blob/main/docs/pilot/telegram-privacy.md',
});

console.log(`Local Telegram trial on http://127.0.0.1:${values.port} (long polling).`);
console.log(
  values.origin
    ? `Login and app links open through ${origin}; keep the tunnel running. Linking uses development sign-in: anyone with this address can sign in as any IITGN email while the trial runs.`
    : 'No --origin: /login and /open explain that links need an HTTPS tunnel.',
);
console.log('In Telegram, open your bot, tap Start, then Log in with IITGN. Stop with Ctrl+C.');
const server = spawn(process.execPath, ['.cache/pilot-server/main.mjs'], {
  env,
  stdio: 'inherit',
});
// Ctrl+C reaches the server too; it stops polling, the bot and Chromium, then exits.
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal));
server.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
