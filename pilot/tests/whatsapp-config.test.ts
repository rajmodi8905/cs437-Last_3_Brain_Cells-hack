/// <reference types="node" />
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../server/config';
import { GRAPH_API_VERSION } from '../server/whatsapp/graph';

const G = { PILOT_GOOGLE_CLIENT_ID: 'c', PILOT_GOOGLE_CLIENT_SECRET: 's' };
const DURABLE = {
  PILOT_DATABASE_URL: 'postgres://pilot@db.internal:5432/pilot',
  PILOT_BLOB_ACCOUNT_URL: 'https://campusrecallpilot.blob.core.windows.net',
};
const PUBLIC = { ...G, ...DURABLE, PILOT_ORIGIN: 'https://recall.example.in' };

// Stand-in secret files; the values are made up for these tests.
const dir = mkdtempSync(join(tmpdir(), 'campus-recall-whatsapp-config-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const secret = (name: string, value: string) => {
  const path = join(dir, name);
  writeFileSync(path, value);
  return path;
};
const WA = {
  PILOT_WHATSAPP_VERIFY_TOKEN_FILE: secret('verify_token', 'test-verify-token\n'),
  PILOT_WHATSAPP_APP_SECRET_FILE: secret('app_secret', 'test-app-secret'),
  PILOT_WHATSAPP_ACCESS_TOKEN_FILE: secret('access_token', '  test-access-token  \n'),
  PILOT_WHATSAPP_PHONE_NUMBER_ID: '100200300',
  PILOT_WHATSAPP_PRIVACY_URL: 'https://recall.example.in/whatsapp-privacy',
  PILOT_WHATSAPP_CONTACT_EMAIL: 'team@iitgn.ac.in',
};

describe('WhatsApp channel configuration', () => {
  it('is off, with nothing added to the settings, when no WhatsApp setting is given', () => {
    const config = loadConfig(PUBLIC);
    expect(config).not.toHaveProperty('whatsapp');
    expect(config).not.toHaveProperty('localTrial');
  });

  it('reads every setting, with secrets taken from their files', () => {
    expect(loadConfig({ ...PUBLIC, ...WA }).whatsapp).toEqual({
      verifyToken: 'test-verify-token',
      appSecret: 'test-app-secret',
      accessToken: 'test-access-token',
      phoneNumberId: '100200300',
      graphVersion: GRAPH_API_VERSION,
      privacyUrl: 'https://recall.example.in/whatsapp-privacy',
      contactEmail: 'team@iitgn.ac.in',
      noticeVersion: '1',
      engineHost: { distDir: '.cache/engine-host-dist', modelsDir: '.models' },
    });
  });

  it('takes the optional Graph version, notice version and engine host folders', () => {
    expect(
      loadConfig({
        ...PUBLIC,
        ...WA,
        PILOT_WHATSAPP_GRAPH_VERSION: 'v25.0',
        PILOT_WHATSAPP_NOTICE_VERSION: '2026-11-23',
        PILOT_ENGINE_HOST_DIST: '/app/engine-host',
        PILOT_ENGINE_HOST_MODELS: '/app/models',
        PILOT_ENGINE_HOST_STATE_DIR: '/app/engine-state',
      }).whatsapp,
    ).toMatchObject({
      graphVersion: 'v25.0',
      noticeVersion: '2026-11-23',
      engineHost: {
        distDir: '/app/engine-host',
        modelsDir: '/app/models',
        stateDir: '/app/engine-state',
      },
    });
  });

  it('runs on a local origin with memory storage and development sign-in', () => {
    const config = loadConfig({ ...WA, PILOT_DEV_KEY_FILE: '/tmp/dev-private.pem' });
    expect(config.storage).toEqual({ kind: 'memory' });
    expect(config.whatsapp?.phoneNumberId).toBe('100200300');
  });

  it('needs durable storage on a public origin', () => {
    expect(() => loadConfig({ ...G, ...WA, PILOT_ORIGIN: 'https://recall.example.in' })).toThrow(
      /durable storage/,
    );
  });

  it.each(Object.keys(WA))('refuses the channel without %s', (name) => {
    const env: Record<string, string | undefined> = { ...PUBLIC, ...WA, [name]: undefined };
    expect(() => loadConfig(env)).toThrow(new RegExp(`missing: ${name}`));
  });

  it.each([
    ['PILOT_WHATSAPP_GRAPH_VERSION', 'v25.0'],
    ['PILOT_WHATSAPP_NOTICE_VERSION', '2'],
    ['PILOT_ENGINE_HOST_DIST', '.cache/engine-host-dist'],
    ['PILOT_ENGINE_HOST_MODELS', '.models'],
    ['PILOT_ENGINE_HOST_STATE_DIR', '/tmp/engine'],
  ])('refuses %s without the channel', (name, value) => {
    expect(() => loadConfig({ ...PUBLIC, [name]: value })).toThrow(/only applies/);
  });

  it('never puts a secret value or path contents into an error', () => {
    const empty = secret('empty', '\n');
    const twoLines = secret('two_lines', 'test-app-secret\nsecond-line');
    const errors = [
      { PILOT_WHATSAPP_APP_SECRET_FILE: join(dir, 'missing') },
      { PILOT_WHATSAPP_APP_SECRET_FILE: empty },
      { PILOT_WHATSAPP_APP_SECRET_FILE: twoLines },
    ].map((change) => {
      try {
        loadConfig({ ...PUBLIC, ...WA, ...change });
      } catch (caught) {
        return (caught as Error).message;
      }
      return 'no error';
    });
    expect(errors).toEqual([
      'PILOT_WHATSAPP_APP_SECRET_FILE names a file that cannot be read.',
      'PILOT_WHATSAPP_APP_SECRET_FILE names an empty file.',
      'PILOT_WHATSAPP_APP_SECRET_FILE must hold one value on one line.',
    ]);
  });

  it.each([
    ['a phone number ID that is not numeric', { PILOT_WHATSAPP_PHONE_NUMBER_ID: '+15551234' }],
    ['a Graph version that is not vNN.N', { PILOT_WHATSAPP_GRAPH_VERSION: '27' }],
    ['a privacy URL over plain HTTP', { PILOT_WHATSAPP_PRIVACY_URL: 'http://x.in/privacy' }],
    ['a privacy URL that is not a URL', { PILOT_WHATSAPP_PRIVACY_URL: 'privacy page' }],
    ['a contact that is not an email address', { PILOT_WHATSAPP_CONTACT_EMAIL: 'the team' }],
    ['a notice version with spaces', { PILOT_WHATSAPP_NOTICE_VERSION: 'version one' }],
  ])('refuses %s', (_name, change) => {
    expect(() => loadConfig({ ...PUBLIC, ...WA, ...change })).toThrow();
  });
});

describe('WhatsApp local trial behind an HTTPS tunnel', () => {
  const TUNNEL = 'https://quiet-river-1234.trycloudflare.com';
  const TRIAL = { ...WA, PILOT_ORIGIN: TUNNEL, PILOT_WHATSAPP_LOCAL_TRIAL: '1' };

  it('accepts the tunnel origin with memory storage and no sign-in of its own', () => {
    const config = loadConfig(TRIAL);
    expect(config).toMatchObject({
      origin: TUNNEL,
      host: '127.0.0.1',
      clientId: 'campus-recall-local-trial',
      storage: { kind: 'memory' },
      localTrial: true,
    });
    expect(config.clientSecret).toBeUndefined();
    expect(config.devKeyFile).toBeUndefined();
  });

  it('accepts local Docker PostgreSQL and Azurite', () => {
    expect(
      loadConfig({
        ...TRIAL,
        PILOT_DATABASE_URL: 'postgres://pilot@127.0.0.1:5432/pilot',
        PILOT_BLOB_CONNECTION_STRING: 'UseDevelopmentStorage=true',
      }).storage,
    ).toMatchObject({ kind: 'durable', blob: { connectionString: 'UseDevelopmentStorage=true' } });
  });

  it('never allows development sign-in on the tunnel', () => {
    expect(() => loadConfig({ ...TRIAL, PILOT_DEV_KEY_FILE: '/tmp/dev-private.pem' })).toThrow(
      /local origin/,
    );
  });

  it.each([
    ['without the WhatsApp settings', { ...TRIAL, PILOT_WHATSAPP_PHONE_NUMBER_ID: undefined }],
    [
      'without any WhatsApp setting',
      { PILOT_ORIGIN: TUNNEL, PILOT_WHATSAPP_LOCAL_TRIAL: '1' } as Record<string, string>,
    ],
    ['on a local origin', { ...TRIAL, PILOT_ORIGIN: 'http://127.0.0.1:4600' }],
    ['when listening on every interface', { ...TRIAL, PILOT_HOST: '0.0.0.0' }],
    ['with a value other than 0 or 1', { ...TRIAL, PILOT_WHATSAPP_LOCAL_TRIAL: 'yes' }],
  ])('is refused %s', (_name, env) => {
    expect(() => loadConfig(env)).toThrow();
  });

  it('leaves a tunnel origin without the trial under the public rules', () => {
    expect(() => loadConfig({ ...TRIAL, ...G, PILOT_WHATSAPP_LOCAL_TRIAL: '0' })).toThrow(
      /durable storage/,
    );
  });
});
