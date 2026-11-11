/// <reference types="node" />
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../server/config';

const G = { PILOT_GOOGLE_CLIENT_ID: 'c', PILOT_GOOGLE_CLIENT_SECRET: 's' };
const DURABLE = {
  PILOT_DATABASE_URL: 'postgres://pilot@db.internal:5432/pilot',
  PILOT_BLOB_ACCOUNT_URL: 'https://campusrecallpilot.blob.core.windows.net',
};
const PUBLIC = { ...G, ...DURABLE, PILOT_ORIGIN: 'https://recall.example.in' };

// Stand-in secret files; the values are made up for these tests.
const dir = mkdtempSync(join(tmpdir(), 'campus-recall-telegram-config-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const secret = (name: string, value: string) => {
  const path = join(dir, name);
  writeFileSync(path, value);
  return path;
};
const FAKE_TOKEN = '123456789:TEST-fake-token-for-tests-only_0123456789';
const TG = {
  PILOT_TELEGRAM_BOT_TOKEN_FILE: secret('bot_token', `${FAKE_TOKEN}\n`),
  PILOT_TELEGRAM_PRIVACY_URL: 'https://recall.example.in/telegram-privacy',
  PILOT_TELEGRAM_CONTACT_EMAIL: 'team@iitgn.ac.in',
};
const WEBHOOK = {
  PILOT_TELEGRAM_MODE: 'webhook',
  PILOT_TELEGRAM_WEBHOOK_SECRET_FILE: secret('webhook_secret', 'webhook-secret-0123456789abcdef'),
};
const WA = {
  PILOT_WHATSAPP_VERIFY_TOKEN_FILE: secret('verify_token', 'test-verify-token'),
  PILOT_WHATSAPP_APP_SECRET_FILE: secret('app_secret', 'test-app-secret'),
  PILOT_WHATSAPP_ACCESS_TOKEN_FILE: secret('access_token', 'test-access-token'),
  PILOT_WHATSAPP_PHONE_NUMBER_ID: '100200300',
  PILOT_WHATSAPP_PRIVACY_URL: 'https://recall.example.in/whatsapp-privacy',
  PILOT_WHATSAPP_CONTACT_EMAIL: 'team@iitgn.ac.in',
};

describe('Telegram channel configuration', () => {
  it('is off when no Telegram setting is given', () => {
    expect(loadConfig(PUBLIC)).not.toHaveProperty('telegram');
  });

  it('reads every setting with long polling by default, the token taken from its file', () => {
    expect(loadConfig({ ...PUBLIC, ...TG }).telegram).toEqual({
      botToken: FAKE_TOKEN,
      mode: 'polling',
      privacyUrl: 'https://recall.example.in/telegram-privacy',
      contactEmail: 'team@iitgn.ac.in',
      noticeVersion: '1',
      engineHost: { distDir: '.cache/engine-host-dist', modelsDir: '.models' },
    });
  });

  it('takes webhook mode with its secret file, allowed users and the engine host folders', () => {
    expect(
      loadConfig({
        ...PUBLIC,
        ...TG,
        ...WEBHOOK,
        PILOT_TELEGRAM_ALLOWED_USERS: ' 700000001, @Student_A ,student_b',
        PILOT_TELEGRAM_NOTICE_VERSION: '2026-11-24',
        PILOT_ENGINE_HOST_DIST: '/app/engine-host',
        PILOT_ENGINE_HOST_STATE_DIR: '/app/engine-state',
      }).telegram,
    ).toMatchObject({
      mode: 'webhook',
      webhookSecret: 'webhook-secret-0123456789abcdef',
      allowedUsers: { ids: ['700000001'], usernames: ['student_a', 'student_b'] },
      noticeVersion: '2026-11-24',
      engineHost: { distDir: '/app/engine-host', stateDir: '/app/engine-state' },
    });
  });

  it('runs together with the WhatsApp channel, sharing the engine host settings', () => {
    const config = loadConfig({ ...PUBLIC, ...TG, ...WA, PILOT_ENGINE_HOST_MODELS: '/m' });
    expect(config.whatsapp?.engineHost).toEqual(config.telegram?.engineHost);
    expect(config.telegram?.engineHost.modelsDir).toBe('/m');
  });

  it.each(Object.keys(TG))('refuses the channel without %s', (name) => {
    expect(() => loadConfig({ ...PUBLIC, ...TG, [name]: undefined })).toThrow(
      new RegExp(`missing: ${name}`),
    );
  });

  it.each([
    ['PILOT_TELEGRAM_MODE', 'webhook'],
    ['PILOT_TELEGRAM_ALLOWED_USERS', '1'],
    ['PILOT_TELEGRAM_NOTICE_VERSION', '2'],
    ['PILOT_TELEGRAM_WEBHOOK_SECRET_FILE', '/tmp/x'],
    ['PILOT_TELEGRAM_LOCAL_TRIAL', '1'],
  ])('refuses %s without the channel', (name, value) => {
    expect(() => loadConfig({ ...PUBLIC, [name]: value })).toThrow();
  });

  it('never puts the token or file contents into an error', () => {
    const notAToken = secret('not_a_token', 'hello-this-is-not-a-token');
    const messages = [
      { PILOT_TELEGRAM_BOT_TOKEN_FILE: join(dir, 'missing') },
      { PILOT_TELEGRAM_BOT_TOKEN_FILE: secret('empty', '\n') },
      { PILOT_TELEGRAM_BOT_TOKEN_FILE: notAToken },
    ].map((change) => {
      try {
        loadConfig({ ...PUBLIC, ...TG, ...change });
      } catch (caught) {
        return (caught as Error).message;
      }
      return 'no error';
    });
    expect(messages).toEqual([
      'PILOT_TELEGRAM_BOT_TOKEN_FILE names a file that cannot be read.',
      'PILOT_TELEGRAM_BOT_TOKEN_FILE names an empty file.',
      'PILOT_TELEGRAM_BOT_TOKEN_FILE must hold a bot token from BotFather.',
    ]);
  });

  it.each([
    ['an unknown mode', { PILOT_TELEGRAM_MODE: 'push' }],
    ['webhook mode without its secret', { PILOT_TELEGRAM_MODE: 'webhook' }],
    [
      'a webhook secret in polling mode',
      { PILOT_TELEGRAM_WEBHOOK_SECRET_FILE: WEBHOOK.PILOT_TELEGRAM_WEBHOOK_SECRET_FILE },
    ],
    [
      'a short webhook secret',
      { ...WEBHOOK, PILOT_TELEGRAM_WEBHOOK_SECRET_FILE: secret('short', 'abc') },
    ],
    ['a privacy URL over plain HTTP', { PILOT_TELEGRAM_PRIVACY_URL: 'http://x.in/privacy' }],
    ['a contact that is not an email address', { PILOT_TELEGRAM_CONTACT_EMAIL: 'the team' }],
    [
      'an allowed user that is neither an ID nor a username',
      { PILOT_TELEGRAM_ALLOWED_USERS: '+91 98' },
    ],
    ['an empty allowed list', { PILOT_TELEGRAM_ALLOWED_USERS: ' , ' }],
  ])('refuses %s', (_name, change) => {
    expect(() => loadConfig({ ...PUBLIC, ...TG, ...change })).toThrow();
  });

  it('needs an HTTPS origin for webhook mode', () => {
    expect(() =>
      loadConfig({ ...TG, ...WEBHOOK, PILOT_DEV_KEY_FILE: '/tmp/dev-private.pem' }),
    ).toThrow(/HTTPS PILOT_ORIGIN/);
  });
});

describe('Telegram local trial', () => {
  const TRIAL = { ...TG, PILOT_TELEGRAM_LOCAL_TRIAL: '1' };

  it('runs long polling on a local origin with memory storage and no sign-in of its own', () => {
    const config = loadConfig(TRIAL);
    expect(config).toMatchObject({
      origin: 'http://127.0.0.1:4600',
      host: '127.0.0.1',
      clientId: 'campus-recall-local-trial',
      storage: { kind: 'memory' },
      localTrial: true,
      telegram: { mode: 'polling' },
    });
  });

  it("accepts a tunnel's HTTPS origin for app links", () => {
    expect(
      loadConfig({ ...TRIAL, PILOT_ORIGIN: 'https://quiet-river-1234.trycloudflare.com' }),
    ).toMatchObject({ storage: { kind: 'memory' }, localTrial: true });
  });

  it('links Telegram users with development sign-in, also behind a tunnel, on memory storage', () => {
    const DEV = { PILOT_DEV_KEY_FILE: '/tmp/dev-private.pem' };
    expect(loadConfig({ ...TRIAL, ...DEV })).toMatchObject({
      clientId: 'campus-recall-pilot-dev',
      devKeyFile: '/tmp/dev-private.pem',
      storage: { kind: 'memory' },
      localTrial: true,
    });
    expect(
      loadConfig({
        ...TRIAL,
        ...DEV,
        PILOT_ORIGIN: 'https://quiet-river-1234.trycloudflare.com',
      }),
    ).toMatchObject({ devKeyFile: '/tmp/dev-private.pem', storage: { kind: 'memory' } });
  });

  it.each([
    [
      'without the Telegram settings',
      { PILOT_TELEGRAM_LOCAL_TRIAL: '1' } as Record<string, string>,
    ],
    ['when listening on every interface', { ...TRIAL, PILOT_HOST: '0.0.0.0' }],
    [
      'with development sign-in on every interface',
      { ...TRIAL, PILOT_HOST: '0.0.0.0', PILOT_DEV_KEY_FILE: '/tmp/dev-private.pem' },
    ],
    [
      'with development sign-in behind a tunnel on durable storage',
      {
        ...TRIAL,
        ...DURABLE,
        PILOT_ORIGIN: 'https://quiet-river-1234.trycloudflare.com',
        PILOT_DEV_KEY_FILE: '/tmp/dev-private.pem',
      },
    ],
    [
      'with development sign-in and Google sign-in together',
      { ...TRIAL, ...G, PILOT_DEV_KEY_FILE: '/tmp/dev-private.pem' },
    ],
    ['with a value other than 0 or 1', { ...TRIAL, PILOT_TELEGRAM_LOCAL_TRIAL: 'yes' }],
  ])('is refused %s', (_name, env) => {
    expect(() => loadConfig(env)).toThrow();
  });

  it('never allows development sign-in on a public origin without the trial', () => {
    expect(() =>
      loadConfig({ ...PUBLIC, ...TG, PILOT_DEV_KEY_FILE: '/tmp/dev-private.pem' }),
    ).toThrow(/only allowed on a local origin/);
    expect(() =>
      loadConfig({
        ...TG,
        ...DURABLE,
        PILOT_ORIGIN: 'https://quiet-river-1234.trycloudflare.com',
        PILOT_TELEGRAM_LOCAL_TRIAL: '0',
        PILOT_DEV_KEY_FILE: '/tmp/dev-private.pem',
      }),
    ).toThrow(/only allowed on a local origin/);
  });
});
