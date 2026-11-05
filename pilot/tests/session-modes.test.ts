import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { deviceFetch, devSigner, origin, startPilotServer } from './helpers';

let pilot: Awaited<ReturnType<typeof startPilotServer>> | undefined;
afterEach(async () => {
  await pilot?.close();
  pilot = undefined;
});

const post = (base: string, path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

describe('Sign-in mode reported to the app', () => {
  it('reports Google sign-in and has no development token endpoint by default', async () => {
    pilot = await startPilotServer();
    const config = await fetch(`${pilot.base}/config`);
    expect(config.status).toBe(200);
    expect(config.headers.get('cache-control')).toBe('no-store');
    expect(await config.json()).toEqual({ signIn: 'google', projectId: 'campus-recall-pilot' });
    const token = await post(pilot.base, '/dev/token', { email: 'student@iitgn.ac.in' });
    expect(token.status).toBe(404);
  });

  it('mints development tokens only when the server was started with a development key', async () => {
    pilot = await startPilotServer(5_000_000, { devSigner });
    expect(await (await fetch(`${pilot.base}/config`)).json()).toMatchObject({ signIn: 'dev' });
    const minted = await post(pilot.base, '/dev/token', { email: 'student@iitgn.ac.in' });
    expect(minted.status).toBe(200);
    const { idToken } = await minted.json();
    const session = await post(pilot.base, '/session', { idToken });
    expect(session.status).toBe(200);
    expect(await session.json()).toMatchObject({ email: 'student@iitgn.ac.in' });
  });

  it('still refuses non-IITGN accounts and other origins in development mode', async () => {
    pilot = await startPilotServer(5_000_000, { devSigner });
    const { idToken } = await (
      await post(pilot.base, '/dev/token', { email: 'x@gmail.com' })
    ).json();
    const session = await post(pilot.base, '/session', { idToken });
    expect(session.status).toBe(403);
    expect((await session.json()).error.code).toBe('NOT_ELIGIBLE');
    const foreign = await post(
      pilot.base,
      '/dev/token',
      { email: 'student@iitgn.ac.in' },
      { origin: 'https://evil.example' },
    );
    expect(foreign.status).toBe(403);
  });
});

describe('Restoring a session after a reload', () => {
  it('returns the current session and a CSRF token that works for writes', async () => {
    pilot = await startPilotServer(5_000_000, { devSigner });
    const net = deviceFetch();
    const { idToken } = await (
      await post(pilot.base, '/dev/token', { email: 'student@iitgn.ac.in' })
    ).json();
    const signedIn = await (
      await net.fetchImpl(`${pilot.base}/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idToken }),
      })
    ).json();
    // After a reload the page only has the cookie.
    const restored = await net.fetchImpl(`${pilot.base}/session`);
    expect(restored.status).toBe(200);
    const body = await restored.json();
    expect(body).toMatchObject({
      email: 'student@iitgn.ac.in',
      account: signedIn.account,
      vault: { epoch: 1 },
    });
    expect(body.csrf).toBe(signedIn.csrf);
    const write = await net.fetchImpl(`${pilot.base}/items/${randomUUID()}/upload`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-recall-csrf': body.csrf },
      body: JSON.stringify({ opId: randomUUID(), epoch: 1, item: { kind: 'pdf' } }),
    });
    expect(write.status).toBe(400);
  });

  it('answers 401 without a session', async () => {
    pilot = await startPilotServer();
    const res = await fetch(`${pilot.base}/session`);
    expect(res.status).toBe(401);
  });
});
