import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApiClient } from '../client/api';
import { deviceFetch, idToken, sha256, startPilotServer } from './helpers';

let pilot: Awaited<ReturnType<typeof startPilotServer>>;
beforeEach(async () => {
  pilot = await startPilotServer();
});
afterEach(() => pilot.close());

const pdf = new TextEncoder().encode('%PDF-1.4\n' + 'Guests need a pass. '.repeat(200));

async function account(token = idToken()) {
  const api = createApiClient({ base: pilot.base, fetch: deviceFetch().fetchImpl });
  const session = await api.signIn(token);
  return { api, epoch: session.vault.epoch };
}
async function upload(device: Awaited<ReturnType<typeof account>>) {
  const globalId = randomUUID();
  const begun = await device.api.beginUpload(globalId, {
    opId: randomUUID(),
    epoch: device.epoch,
    item: {
      kind: 'pdf',
      title: 'Hostel mess rules',
      mimeType: 'application/pdf',
      byteLength: pdf.length,
      contentSha256: sha256(pdf),
      createdAt: 1_762_000_000_000,
    },
  });
  await device.api.putChunk(begun.uploadId, 0, pdf);
  await device.api.completeUpload(begun.uploadId, { opId: randomUUID(), epoch: device.epoch });
  return globalId;
}

describe('P10 removing the cloud library', () => {
  it('needs the current epoch and an explicit confirmation', async () => {
    const a = await account();
    await expect(a.api.removeVault({ epoch: a.epoch, confirm: 'yes' })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    await expect(
      a.api.removeVault({ epoch: 9, confirm: 'remove-cloud-library' }),
    ).rejects.toMatchObject({ code: 'VAULT_RESET' });
  });

  it('deletes every cloud copy and starts a new epoch that old writes cannot use', async () => {
    const a = await account();
    const globalId = await upload(a);
    const { vault } = await a.api.removeVault({ epoch: a.epoch, confirm: 'remove-cloud-library' });
    expect(vault.epoch).toBe(2);
    await expect(a.api.original(globalId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(a.api.changes(1, 0)).rejects.toMatchObject({ code: 'RESYNC_REQUIRED' });
    expect((await a.api.changes(2, 0)).changes).toEqual([]);
    await expect(
      a.api.beginUpload(randomUUID(), {
        opId: randomUUID(),
        epoch: 1,
        item: {
          kind: 'pdf',
          title: 'Old device',
          mimeType: 'application/pdf',
          byteLength: pdf.length,
          contentSha256: sha256(pdf),
          createdAt: 1,
        },
      }),
    ).rejects.toMatchObject({ code: 'VAULT_RESET' });
    expect(await pilot.store.committedBytes('campus-recall-pilot:subject-a')).toBe(0);
    expect((await a.api.restoreSession())?.vault.epoch).toBe(2);
  });

  it('cancels an upload that was in progress when the library was removed', async () => {
    const a = await account();
    const begun = await a.api.beginUpload(randomUUID(), {
      opId: randomUUID(),
      epoch: 1,
      item: {
        kind: 'pdf',
        title: 'Half sent',
        mimeType: 'application/pdf',
        byteLength: pdf.length,
        contentSha256: sha256(pdf),
        createdAt: 1,
      },
    });
    await a.api.putChunk(begun.uploadId, 0, pdf);
    await a.api.removeVault({ epoch: 1, confirm: 'remove-cloud-library' });
    await expect(
      a.api.completeUpload(begun.uploadId, { opId: randomUUID(), epoch: 1 }),
    ).rejects.toMatchObject({ code: 'VAULT_RESET' });
    expect(await pilot.store.committedBytes('campus-recall-pilot:subject-a')).toBe(0);
  });

  it("leaves other accounts' libraries alone", async () => {
    const a = await account();
    const b = await account(idToken({ sub: 'subject-b', email: 'b@iitgn.ac.in' }));
    const bItem = await upload(b);
    await a.api.removeVault({ epoch: a.epoch, confirm: 'remove-cloud-library' });
    expect(sha256(await b.api.original(bItem))).toBe(sha256(pdf));
  });
});
