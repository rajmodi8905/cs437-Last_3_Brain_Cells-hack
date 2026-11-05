import { describe, expect, it } from 'vitest';
import { loadConfig } from '../server/config';

const G = { PILOT_GOOGLE_CLIENT_ID: 'c', PILOT_GOOGLE_CLIENT_SECRET: 's' };

describe('Pilot server configuration', () => {
  it('uses Google sign-in with a configured OAuth client', () => {
    expect(
      loadConfig({
        PILOT_GOOGLE_CLIENT_ID: '1234-pilot.apps.googleusercontent.com',
        PILOT_GOOGLE_CLIENT_SECRET: 'client-secret',
        PILOT_ORIGIN: 'https://recall.example.in',
        PILOT_PORT: '8080',
        PILOT_HOST: '0.0.0.0',
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
    });
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
  ])('refuses %s', (_name, env) => {
    expect(() => loadConfig(env)).toThrow();
  });
});
