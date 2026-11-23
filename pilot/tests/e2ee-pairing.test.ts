/// <reference types="node" />
// E5 of docs/pilot/e2ee-design.md: a new device gets the recovery secret from a device that has
// it, through the server, and a server that swaps a key is caught.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApiClient } from '../client/api';
import {
  MemoryLocalLibrary,
  MemoryOfflineStore,
  MemoryRemoteIndexStore,
  MemorySyncStateStore,
  MemoryVaultSecretStore,
} from '../client/memory';
import { SyncEngine } from '../client/sync';
import {
  decodeRecoveryCode,
  newPairingKeys,
  newRecoverySecret,
  openPairingSecret,
  pairingCheckNumber,
  pairingCommitment,
  sealPairingSecret,
  toBase64url,
} from '../contract/e2ee';
import { deviceFetch, idToken, sha256, startPilotServer } from './helpers';

describe('E5 pairing crypto', () => {
  it('gives both devices the same check number and the new device the secret', async () => {
    const fresh = await newPairingKeys();
    const old = await newPairingKeys();
    const ctx = { pairingId: 'p-1', newPublicKey: fresh.publicKey, oldPublicKey: old.publicKey };
    expect(await pairingCheckNumber(fresh.publicKey, old.publicKey)).toMatch(/^\d{6}$/);
    const secret = newRecoverySecret();
    const sealed = await sealPairingSecret(old, ctx, secret);
    expect(
      Buffer.from(await openPairingSecret(fresh, ctx, sealed)).equals(Buffer.from(secret)),
    ).toBe(true);
  });

  it('binds the secret to the pairing and both keys', async () => {
    const fresh = await newPairingKeys();
    const old = await newPairingKeys();
    const other = await newPairingKeys();
    const ctx = { pairingId: 'p-1', newPublicKey: fresh.publicKey, oldPublicKey: old.publicKey };
    const sealed = await sealPairingSecret(old, ctx, newRecoverySecret());
    await expect(
      openPairingSecret(fresh, { ...ctx, pairingId: 'p-2' }, sealed),
    ).rejects.toMatchObject({ code: 'TAMPERED' });
    await expect(openPairingSecret(other, ctx, sealed)).rejects.toMatchObject({ code: 'TAMPERED' });
  });

  it('commits to one key: another key has another commitment and check number', async () => {
    const fresh = await newPairingKeys();
    const old = await newPairingKeys();
    const swapped = await newPairingKeys();
    expect(await pairingCommitment(fresh.publicKey)).not.toBe(
      await pairingCommitment(swapped.publicKey),
    );
    expect(await pairingCheckNumber(fresh.publicKey, old.publicKey)).not.toBe(
      await pairingCheckNumber(fresh.publicKey, swapped.publicKey),
    );
  });
});

let pilot: Awaited<ReturnType<typeof startPilotServer>>;
beforeEach(async () => {
  pilot = await startPilotServer();
});
afterEach(() => pilot.close());

/**
 * A signed-in, included device. `rewrite` lets a test play a dishonest server by changing a
 * JSON response before the device reads it; every request body is recorded.
 */
async function device(rewrite?: (line: string, body: Record<string, unknown>) => void) {
  const net = deviceFetch();
  const bodies: string[] = [];
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    if (typeof init.body === 'string') bodies.push(init.body);
    const res = await net.fetchImpl(input, init);
    const line = `${init.method ?? 'GET'} ${new URL(String(input)).pathname.replace(/^\/api\/v1/, '')}`;
    if (!rewrite || !res.headers.get('content-type')?.includes('json')) return res;
    const body = (await res.json()) as Record<string, unknown>;
    rewrite(line, body);
    return new Response(JSON.stringify(body), { status: res.status, headers: res.headers });
  };
  const api = createApiClient({ base: pilot.base, fetch: fetchImpl });
  const library = new MemoryLocalLibrary();
  const vaultSecret = new MemoryVaultSecretStore();
  const engine = new SyncEngine({
    api,
    library,
    state: new MemorySyncStateStore(),
    remoteIndex: new MemoryRemoteIndexStore(),
    offline: new MemoryOfflineStore(),
    vaultSecret,
    libraryId: 'library',
  });
  const session = await api.signIn(idToken());
  await engine.include(session.vault.epoch);
  return { bodies, library, engine, vaultSecret };
}

/** The phone has an encrypted library with one note; the laptop is locked out of it. */
async function phoneAndLaptop(rewriteLaptop?: Parameters<typeof device>[0]) {
  const phone = await device();
  const code = await phone.engine.turnOnEncryption();
  phone.library.add(
    { kind: 'note', title: 'Hostel locker', mimeType: 'text/plain' },
    new TextEncoder().encode('Locker 42'),
  );
  await phone.engine.runOnce();
  const laptop = await device(rewriteLaptop);
  expect(await laptop.engine.runOnce()).toMatchObject({ locked: true });
  return { phone, laptop, code };
}

describe('E5 pairing through the server', () => {
  it('unlocks the new device once both say the numbers match, and leaves no record', async () => {
    const { phone, laptop, code } = await phoneAndLaptop();
    const started = await laptop.engine.startPairing();
    const record = () =>
      pilot.store.findPairing('google:subject-a', sha256(new TextEncoder().encode(started.code)));
    expect(await record()).toBeDefined();
    expect(await laptop.engine.pairingStep()).toEqual({ stage: 'waiting' });
    expect(await phone.engine.claimPairing(started.code)).toEqual({ stage: 'waiting' });
    const onLaptop = await laptop.engine.pairingStep();
    const onPhone = await phone.engine.pairingStep();
    expect(onLaptop.stage).toBe('compare');
    expect(onPhone).toEqual(onLaptop);

    expect(await phone.engine.confirmPairing()).toEqual({ stage: 'done' });
    // The secret has arrived, but the laptop takes it only once its student confirms too.
    expect((await laptop.engine.pairingStep()).stage).toBe('compare');
    expect(await laptop.engine.encryption()).toEqual({ on: true, unlocked: false });
    expect(await laptop.engine.confirmPairing()).toEqual({ stage: 'done' });

    expect(await laptop.engine.encryption()).toEqual({ on: true, unlocked: true });
    expect(await laptop.engine.recoveryCode()).toBe(code);
    expect(await laptop.engine.runOnce()).toMatchObject({ failed: 0 });
    expect((await laptop.engine.catalogue()).map((item) => item.title)).toEqual(['Hostel locker']);
    expect(await record()).toBeUndefined();

    // E8: the secret crossed the server only sealed.
    const secret = await decodeRecoveryCode(code);
    for (const body of [...phone.bodies, ...laptop.bodies])
      for (const form of [code, toBase64url(secret), Buffer.from(secret).toString('hex')])
        expect(body).not.toContain(form);
  });

  it('lets a confirmation on the new device come first', async () => {
    const { phone, laptop } = await phoneAndLaptop();
    const started = await laptop.engine.startPairing();
    await phone.engine.claimPairing(started.code);
    await laptop.engine.pairingStep();
    await phone.engine.pairingStep();
    expect((await laptop.engine.confirmPairing()).stage).toBe('compare');
    await phone.engine.confirmPairing();
    expect(await laptop.engine.pairingStep()).toEqual({ stage: 'done' });
  });

  it('shows different numbers when the server swaps the key the new device sees', async () => {
    const attacker = await newPairingKeys();
    const { phone, laptop } = await phoneAndLaptop((line, body) => {
      if (line.startsWith('GET /pairing/') && body.oldPublicKey)
        body.oldPublicKey = attacker.publicKey;
    });
    const started = await laptop.engine.startPairing();
    await phone.engine.claimPairing(started.code);
    const onLaptop = await laptop.engine.pairingStep();
    const onPhone = await phone.engine.pairingStep();
    expect(onLaptop.stage).toBe('compare');
    expect(onPhone.stage).toBe('compare');
    expect(onLaptop).not.toEqual(onPhone);
  });

  it('refuses a new device key that does not match its commitment', async () => {
    const attacker = await newPairingKeys();
    const phone = await device((line, body) => {
      if (line.startsWith('GET /pairing/') && body.newPublicKey)
        body.newPublicKey = attacker.publicKey;
    });
    await phone.engine.turnOnEncryption();
    const laptop = await device();
    await laptop.engine.runOnce();
    const started = await laptop.engine.startPairing();
    await phone.engine.claimPairing(started.code);
    await laptop.engine.pairingStep();
    await expect(phone.engine.pairingStep()).rejects.toMatchObject({ code: 'TAMPERED' });
    await expect(phone.engine.confirmPairing()).rejects.toThrow(/Start again/);
  });

  it('needs the key on the device that is asked, and a code from the same account', async () => {
    const { laptop } = await phoneAndLaptop();
    const started = await laptop.engine.startPairing();
    const other = await device();
    await other.engine.runOnce();
    await expect(other.engine.claimPairing(started.code)).rejects.toThrow(/key/);
  });
});
