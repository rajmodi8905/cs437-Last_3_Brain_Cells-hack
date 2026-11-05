import { describe, expect, it } from 'vitest';
import { loadConfig } from '../server/config';

describe('Pilot server configuration', () => {
  it('uses Google keys with a configured Firebase project', () => {
    expect(
      loadConfig({
        PILOT_FIREBASE_PROJECT_ID: 'campus-recall-pilot',
        PILOT_ORIGIN: 'https://recall.example.in',
        PILOT_PORT: '8080',
        PILOT_HOST: '0.0.0.0',
      }),
    ).toEqual({
      projectId: 'campus-recall-pilot',
      origin: 'https://recall.example.in',
      port: 8080,
      host: '0.0.0.0',
      staticDir: 'dist',
      quotaBytes: 200_000_000,
      allowedEmailDomain: 'iitgn.ac.in',
      devPublicKeyFile: undefined,
    });
  });

  it('allows a development signing key only on a local origin', () => {
    expect(
      loadConfig({
        PILOT_DEV_PUBLIC_KEY_FILE: '/tmp/dev.pem',
        PILOT_ORIGIN: 'http://127.0.0.1:4600',
      }),
    ).toMatchObject({ projectId: 'campus-recall-pilot-dev', devPublicKeyFile: '/tmp/dev.pem' });
    expect(
      loadConfig({
        PILOT_DEV_PUBLIC_KEY_FILE: '/tmp/dev.pem',
        PILOT_ORIGIN: 'http://localhost:4600',
      }),
    ).toMatchObject({ origin: 'http://localhost:4600' });
    expect(() =>
      loadConfig({
        PILOT_DEV_PUBLIC_KEY_FILE: '/tmp/dev.pem',
        PILOT_ORIGIN: 'https://recall.example.in',
        PILOT_FIREBASE_PROJECT_ID: 'campus-recall-pilot',
      }),
    ).toThrow(/local origin/);
  });

  it.each([
    ['no Firebase project and no development key', {}],
    ['an origin with a path', { PILOT_FIREBASE_PROJECT_ID: 'p', PILOT_ORIGIN: 'https://x.in/app' }],
    [
      'plain HTTP on a public origin',
      { PILOT_FIREBASE_PROJECT_ID: 'p', PILOT_ORIGIN: 'http://x.in' },
    ],
    ['a non-numeric port', { PILOT_FIREBASE_PROJECT_ID: 'p', PILOT_PORT: 'eighty' }],
    ['a zero quota', { PILOT_FIREBASE_PROJECT_ID: 'p', PILOT_QUOTA_BYTES: '0' }],
  ])('refuses %s', (_name, env) => {
    expect(() => loadConfig(env)).toThrow();
  });
});
