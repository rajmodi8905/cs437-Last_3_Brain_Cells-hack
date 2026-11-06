import { describe, expect, it } from 'vitest';
import { loadConfig } from '../server/config';

const G = { PILOT_GOOGLE_CLIENT_ID: 'c', PILOT_GOOGLE_CLIENT_SECRET: 's' };
const DURABLE = {
  PILOT_DATABASE_URL: 'postgres://pilot@db.internal:5432/pilot',
  PILOT_BLOB_ACCOUNT_URL: 'https://campusrecallpilot.blob.core.windows.net',
};

describe('Pilot server configuration', () => {
  it('uses Google sign-in with a configured OAuth client', () => {
    expect(
      loadConfig({
        PILOT_GOOGLE_CLIENT_ID: '1234-pilot.apps.googleusercontent.com',
        PILOT_GOOGLE_CLIENT_SECRET: 'client-secret',
        PILOT_ORIGIN: 'https://recall.example.in',
        PILOT_PORT: '8080',
        PILOT_HOST: '0.0.0.0',
        ...DURABLE,
      }),
    ).toEqual({
      clientId: '1234-pilot.apps.googleusercontent.com',
      clientSecret: 'client-secret',
      origin: 'https://recall.example.in',
      port: 8080,
      host: '0.0.0.0',
      staticDir: 'dist',
      quotaBytes: 200_000_000,
      allowedEmailDomain: 'iitgn.ac.in',
      devKeyFile: undefined,
      trustProxy: false,
      signInPerMinute: 10,
      storage: {
        kind: 'durable',
        databaseUrl: 'postgres://pilot@db.internal:5432/pilot',
        schema: 'pilot',
        blob: {
          accountUrl: 'https://campusrecallpilot.blob.core.windows.net',
          container: 'pilot',
        },
      },
    });
  });

  it('keeps data in memory only on a local origin', () => {
    expect(loadConfig({ PILOT_DEV_KEY_FILE: '/tmp/k.pem' }).storage).toEqual({ kind: 'memory' });
    expect(() => loadConfig({ ...G, PILOT_ORIGIN: 'https://recall.example.in' })).toThrow(
      /PILOT_DATABASE_URL/,
    );
  });

  it('uses Azurite or another storage connection string only on a local origin', () => {
    const local = {
      ...G,
      PILOT_ORIGIN: 'http://localhost:4600',
      PILOT_DATABASE_URL: 'postgres://pilot@127.0.0.1:5432/pilot',
      PILOT_BLOB_CONNECTION_STRING: 'UseDevelopmentStorage=true',
      PILOT_BLOB_CONTAINER: 'dev',
      PILOT_DATABASE_SCHEMA: 'dev_pilot',
    };
    expect(loadConfig(local).storage).toEqual({
      kind: 'durable',
      databaseUrl: 'postgres://pilot@127.0.0.1:5432/pilot',
      schema: 'dev_pilot',
      blob: { connectionString: 'UseDevelopmentStorage=true', container: 'dev' },
    });
    expect(() => loadConfig({ ...local, PILOT_ORIGIN: 'https://recall.example.in' })).toThrow(
      /managed identity/,
    );
  });

  it('picks a user-assigned managed identity when its client ID is given', () => {
    expect(
      loadConfig({
        ...G,
        ...DURABLE,
        PILOT_ORIGIN: 'https://recall.example.in',
        PILOT_MANAGED_IDENTITY_CLIENT_ID: '00000000-0000-0000-0000-000000000001',
      }).storage,
    ).toMatchObject({ blob: { clientId: '00000000-0000-0000-0000-000000000001' } });
  });

  it('allows a development signing key only on a local origin', () => {
    expect(
      loadConfig({
        PILOT_DEV_KEY_FILE: '/tmp/dev-private.pem',
        PILOT_ORIGIN: 'http://127.0.0.1:4600',
      }),
    ).toMatchObject({ clientId: 'campus-recall-pilot-dev', devKeyFile: '/tmp/dev-private.pem' });
    expect(
      loadConfig({
        PILOT_DEV_KEY_FILE: '/tmp/dev-private.pem',
        PILOT_ORIGIN: 'http://localhost:4600',
      }),
    ).toMatchObject({ origin: 'http://localhost:4600' });
    expect(() =>
      loadConfig({
        PILOT_DEV_KEY_FILE: '/tmp/dev-private.pem',
        PILOT_ORIGIN: 'https://recall.example.in',
        PILOT_GOOGLE_CLIENT_ID: 'c.apps.googleusercontent.com',
        PILOT_GOOGLE_CLIENT_SECRET: 's',
      }),
    ).toThrow(/local origin/);
  });

  it.each([
    ['no Google client and no development key', {}],
    ['a Google client ID without its secret', { PILOT_GOOGLE_CLIENT_ID: 'c' }],
    ['a Google client secret without its ID', { PILOT_GOOGLE_CLIENT_SECRET: 's' }],
    ['an origin with a path', { ...G, PILOT_ORIGIN: 'https://x.in/app' }],
    ['plain HTTP on a public origin', { ...G, PILOT_ORIGIN: 'http://x.in' }],
    ['a non-numeric port', { ...G, PILOT_PORT: 'eighty' }],
    ['a zero quota', { ...G, PILOT_QUOTA_BYTES: '0' }],
    ['a trust-proxy value that is not 0 or 1', { ...G, PILOT_TRUST_PROXY: 'yes' }],
    ['a sign-in limit that is not a positive number', { ...G, PILOT_SIGN_IN_PER_MINUTE: '0' }],
    ['a database without object storage', { ...G, PILOT_DATABASE_URL: 'postgres://x/y' }],
    [
      'object storage without a database',
      { ...G, PILOT_BLOB_ACCOUNT_URL: 'https://a.blob.core.windows.net' },
    ],
    [
      'a storage account URL that is not HTTPS',
      { ...G, ...DURABLE, PILOT_BLOB_ACCOUNT_URL: 'http://a.blob.core.windows.net' },
    ],
    ['a schema name that is not plain', { ...G, ...DURABLE, PILOT_DATABASE_SCHEMA: 'pilot; drop' }],
  ])('refuses %s', (_name, env) => {
    expect(() => loadConfig(env)).toThrow();
  });
});
