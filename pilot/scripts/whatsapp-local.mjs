// Runs the pilot server on this computer with the WhatsApp channel on, for a trial with Meta's
// test number through an HTTPS tunnel (docs/pilot/whatsapp-setup.md, "Try it locally").
//
//   npm run pilot:whatsapp-local -- --origin https://<tunnel host> [--port 4600]
//
// Settings come from a private folder outside the repository, ~/.config/campus-recall/whatsapp/
// (or CAMPUS_RECALL_WHATSAPP_DIR): the files app_secret, verify_token and access_token, and
// settings.env with plain settings. This script never reads the three secret files; it passes
// their paths, and the server reads them. Nothing secret goes on a command line or in the output.
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
const dir =
  process.env.CAMPUS_RECALL_WHATSAPP_DIR || join(homedir(), '.config', 'campus-recall', 'whatsapp');
if (!existsSync(dir)) fail(`Create ${dir} first (see docs/pilot/whatsapp-setup.md).`);

// The secrets: only checked to exist and be private; their contents are read by the server.
const secrets = {
  PILOT_WHATSAPP_APP_SECRET_FILE: 'app_secret',
  PILOT_WHATSAPP_VERIFY_TOKEN_FILE: 'verify_token',
  PILOT_WHATSAPP_ACCESS_TOKEN_FILE: 'access_token',
};
for (const name of Object.values(secrets)) {
  const path = join(dir, name);
  if (!existsSync(path)) fail(`Missing ${path}.`);
  if (statSync(path).mode & 0o077)
    console.warn(`${path} can be read by other users; run: chmod 600 "${path}"`);
}

// settings.env: KEY=VALUE lines of plain settings. Only the server's own settings are used;
// the rest (app ID, account ID, test number) are kept there for the setup steps.
const settingsPath = join(dir, 'settings.env');
if (!existsSync(settingsPath)) fail(`Missing ${settingsPath}.`);
const PASSED = new Set([
  'PILOT_ORIGIN',
  'PILOT_WHATSAPP_PHONE_NUMBER_ID',
  'PILOT_WHATSAPP_GRAPH_VERSION',
  'PILOT_WHATSAPP_PRIVACY_URL',
  'PILOT_WHATSAPP_CONTACT_EMAIL',
  'PILOT_WHATSAPP_NOTICE_VERSION',
]);
const settings = {};
for (const line of readFileSync(settingsPath, 'utf8').split(/\r?\n/)) {
  const match = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
  if (!match || line.trimStart().startsWith('#')) continue;
  const [, key, raw] = match;
  if (PASSED.has(key)) settings[key] = raw.replace(/^(['"])(.*)\1$/, '$2');
}

const origin = values.origin ?? process.env.PILOT_ORIGIN ?? settings.PILOT_ORIGIN;
if (!origin)
  fail(
    'Start a tunnel first (for example: cloudflared tunnel --url http://127.0.0.1:4600), then pass its address: --origin https://<tunnel host>',
  );
if (!URL.canParse(origin) || new URL(origin).protocol !== 'https:')
  fail("--origin must be the tunnel's https:// address.");
const contact =
  values.contact ??
  process.env.PILOT_WHATSAPP_CONTACT_EMAIL ??
  settings.PILOT_WHATSAPP_CONTACT_EMAIL;
if (!contact)
  fail(
    'Give the contact email that HELP shows: --contact you@iitgn.ac.in (or PILOT_WHATSAPP_CONTACT_EMAIL in settings.env).',
  );
if (!settings.PILOT_WHATSAPP_PHONE_NUMBER_ID)
  fail(`Add PILOT_WHATSAPP_PHONE_NUMBER_ID to ${settingsPath}.`);

// What the server needs on disk; each is made by one documented command.
for (const [path, command] of [
  ['dist/index.html', 'npm run build'],
  ['.cache/engine-host-dist/asset-manifest.json', 'npm run build:engine-host'],
  ['.models', 'npm run models:download'],
]) {
  if (!existsSync(path)) fail(`Missing ${path}; run ${command} first.`);
}
execFileSync(process.execPath, ['pilot/scripts/build-server.mjs'], { stdio: 'inherit' });

const env = { ...process.env };
// Development sign-in is refused on a tunnel; a stray setting would only stop the server.
delete env.PILOT_DEV_KEY_FILE;
Object.assign(env, settings, {
  PILOT_ORIGIN: new URL(origin).origin,
  PILOT_HOST: '127.0.0.1',
  PILOT_PORT: values.port,
  PILOT_WHATSAPP_LOCAL_TRIAL: '1',
  PILOT_WHATSAPP_CONTACT_EMAIL: contact,
  PILOT_WHATSAPP_PRIVACY_URL:
    settings.PILOT_WHATSAPP_PRIVACY_URL ??
    'https://github.com/rajmodi8905/cs437-Last_3_Brain_Cells-hack/blob/main/docs/pilot/whatsapp-privacy.md',
});
for (const [name, file] of Object.entries(secrets)) env[name] = join(dir, file);

console.log(`Tunnel origin: ${env.PILOT_ORIGIN} -> http://127.0.0.1:${values.port}`);
console.log(`Meta callback URL: ${env.PILOT_ORIGIN}/api/v1/whatsapp/webhook`);
console.log(`Meta verify token: the value in ${join(dir, 'verify_token')}`);
const server = spawn(process.execPath, ['.cache/pilot-server/main.mjs'], {
  env,
  stdio: 'inherit',
});
// Ctrl+C reaches the server too; it stops the bot and Chromium, then exits.
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal));
server.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
