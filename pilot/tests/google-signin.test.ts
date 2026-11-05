/// <reference types="node" />
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clientId, clock, idToken, origin, startPilotServer } from './helpers';

const CALLBACK = `${origin}/api/v1/auth/google/callback`;
const AUTHORIZE = 'https://accounts.example.test/o/oauth2/v2/auth';

/** A stand-in for Google's token endpoint: records each exchange and answers with `reply`. */
let google: Server;
let tokenUrl = '';
let exchanges: URLSearchParams[] = [];
let reply: (form: URLSearchParams) => { status: number; body: unknown };
let pilot: Awaited<ReturnType<typeof startPilotServer>>;
const startedAt = clock.now;

beforeEach(async () => {
  exchanges = [];
  reply = () => ({ status: 200, body: { id_token: idToken() } });
  google = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const form = new URLSearchParams(body);
    exchanges.push(form);
    const { status, body: out } = reply(form);
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(out));
  });
  await new Promise<void>((resolve) => google.listen(0, '127.0.0.1', resolve));
  tokenUrl = `http://127.0.0.1:${(google.address() as AddressInfo).port}/token`;
  pilot = await startPilotServer(5_000_000, {
    google: { clientSecret: 'client-secret', authorizeUrl: AUTHORIZE, tokenUrl },
  });
});
afterEach(async () => {
  clock.now = startedAt;
  await pilot.close();
  await new Promise<void>((resolve) => google.close(() => resolve()));
});

/** A browser's view of one response: where it goes next and which cookies it sets. */
async function visit(path: string, cookies: Record<string, string> = {}) {
  const res = await fetch(`${pilot.base}${path}`, {
    redirect: 'manual',
    headers: {
      cookie: Object.entries(cookies)
        .map(([name, value]) => `${name}=${value}`)
        .join('; '),
    },
  });
  const set: Record<string, string> = {};
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(';');
    const [name, ...value] = pair.split('=');
    set[name] = line;
    set[`${name}=`] = value.join('=');
  }
  return {
    status: res.status,
    location: res.headers.get('location') ?? '',
    set,
    headers: res.headers,
  };
}

async function start() {
  const res = await visit('/auth/google/start');
  const to = new URL(res.location);
  return {
    res,
    to,
    state: to.searchParams.get('state')!,
    nonce: to.searchParams.get('nonce')!,
    challenge: to.searchParams.get('code_challenge')!,
    login: { recall_login: res.set['recall_login='] },
  };
}
const callback = (state: string, extra = 'code=google-code') =>
  `/auth/google/callback?${extra}&state=${encodeURIComponent(state)}`;

describe('P12 Google sign-in run by the pilot server', () => {
  it('starts at Google with state, nonce, PKCE and the IITGN account hint', async () => {
    const first = await start();
    expect(first.res.status).toBe(302);
    expect(`${first.to.origin}${first.to.pathname}`).toBe(AUTHORIZE);
    expect(Object.fromEntries(first.to.searchParams)).toMatchObject({
      client_id: clientId,
      redirect_uri: CALLBACK,
      response_type: 'code',
      scope: 'openid email',
      code_challenge_method: 'S256',
      hd: 'iitgn.ac.in',
      prompt: 'select_account',
    });
    for (const value of [first.state, first.nonce, first.challenge])
      expect(value).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    expect(first.res.set.recall_login).toMatch(
      /^recall_login=[A-Za-z0-9_-]{43,}; Path=\/api\/v1\/auth; Max-Age=600; HttpOnly; Secure; SameSite=Lax$/,
    );
    const second = await start();
    expect(second.state).not.toBe(first.state);
    expect(second.nonce).not.toBe(first.nonce);
  });

  it('signs in when Google returns, proving the code with the matching verifier', async () => {
    const attempt = await start();
    reply = () => ({ status: 200, body: { id_token: idToken({ nonce: attempt.nonce }) } });
    const back = await visit(callback(attempt.state), attempt.login);
    expect(back.status).toBe(303);
    expect(back.location).toBe(`${origin}/#/settings`);
    expect(back.headers.get('referrer-policy')).toBe('no-referrer');
    expect(back.set.recall_session).toMatch(
      /; Path=\/api; Max-Age=\d+; HttpOnly; Secure; SameSite=Lax$/,
    );
    expect(back.set.recall_login).toMatch(/^recall_login=; .*Max-Age=0/);

    expect(exchanges).toHaveLength(1);
    const form = Object.fromEntries(exchanges[0]);
    expect(form).toMatchObject({
      grant_type: 'authorization_code',
      code: 'google-code',
      client_id: clientId,
      client_secret: 'client-secret',
      redirect_uri: CALLBACK,
    });
    expect(createHash('sha256').update(form.code_verifier).digest('base64url')).toBe(
      attempt.challenge,
    );

    const session = await fetch(`${pilot.base}/session`, {
      headers: { cookie: `recall_session=${back.set['recall_session=']}` },
    });
    expect(session.status).toBe(200);
    expect(await session.json()).toMatchObject({ email: 'student.a@iitgn.ac.in' });
  });

  it('accepts each sign-in attempt once', async () => {
    const attempt = await start();
    reply = () => ({ status: 200, body: { id_token: idToken({ nonce: attempt.nonce }) } });
    expect((await visit(callback(attempt.state), attempt.login)).set.recall_session).toBeDefined();
    const replay = await visit(callback(attempt.state), attempt.login);
    expect(replay.location).toBe(`${origin}/?signin=failed#/settings`);
    expect(replay.set.recall_session).toBeUndefined();
    expect(exchanges).toHaveLength(1);
  });

  it("refuses a return with the wrong state, or without this browser's sign-in cookie", async () => {
    const attempt = await start();
    const wrongState = await visit(callback('not-the-state'), attempt.login);
    expect(wrongState.location).toBe(`${origin}/?signin=failed#/settings`);

    // Someone else's attempt finished in this browser (login CSRF): no cookie, no session.
    const other = await start();
    const noCookie = await visit(callback(other.state));
    expect(noCookie.location).toBe(`${origin}/?signin=failed#/settings`);
    expect(noCookie.set.recall_session).toBeUndefined();
    expect(exchanges).toHaveLength(0);
  });

  it('refuses an attempt older than ten minutes', async () => {
    const attempt = await start();
    clock.now += 601;
    const late = await visit(callback(attempt.state), attempt.login);
    expect(late.location).toBe(`${origin}/?signin=failed#/settings`);
    expect(exchanges).toHaveLength(0);
  });

  it("refuses an ID token minted for another attempt's nonce", async () => {
    const attempt = await start();
    reply = () => ({ status: 200, body: { id_token: idToken({ nonce: 'another-nonce' }) } });
    const back = await visit(callback(attempt.state), attempt.login);
    expect(back.location).toBe(`${origin}/?signin=failed#/settings`);
    expect(back.set.recall_session).toBeUndefined();
  });

  it('refuses personal Google accounts and other domains as not eligible', async () => {
    for (const over of [{ hd: undefined }, { hd: 'example.edu', email: 'student@example.edu' }]) {
      const attempt = await start();
      reply = () => ({
        status: 200,
        body: { id_token: idToken({ nonce: attempt.nonce, ...over }) },
      });
      const back = await visit(callback(attempt.state), attempt.login);
      expect(back.location).toBe(`${origin}/?signin=not-eligible#/settings`);
      expect(back.set.recall_session).toBeUndefined();
    }
  });

  it('reports a cancelled sign-in, and a failure at Google, without a session', async () => {
    const cancelled = await start();
    const back = await visit(callback(cancelled.state, 'error=access_denied'), cancelled.login);
    expect(back.location).toBe(`${origin}/?signin=cancelled#/settings`);
    expect(exchanges).toHaveLength(0);

    const failing = await start();
    reply = () => ({ status: 400, body: { error: 'invalid_grant' } });
    const failed = await visit(callback(failing.state), failing.login);
    expect(failed.location).toBe(`${origin}/?signin=failed#/settings`);
    expect(failed.set.recall_session).toBeUndefined();
  });
});

describe('P12 without Google sign-in configured', () => {
  it('has no Google sign-in routes', async () => {
    const plain = await startPilotServer();
    try {
      for (const path of ['/auth/google/start', callback('x')])
        expect((await fetch(`${plain.base}${path}`, { redirect: 'manual' })).status).toBe(404);
    } finally {
      await plain.close();
    }
  });
});
