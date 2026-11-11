import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnyRecallServices } from '../../src/app/services';
import { AutoSyncController } from '../client/autosync';

const values = new Map<string, unknown>();
function services() {
  return {
    engine: {},
    preferences: {
      get: async <T>(key: string) => values.get(key) as T | undefined,
      set: async (key: string, value: unknown) => {
        values.set(key, value);
      },
    },
  } as unknown as AnyRecallServices;
}
afterEach(() => {
  vi.restoreAllMocks();
  values.clear();
});
describe('P01 explicit sync activation', () => {
  it('starts and restarts Local only without any pilot API or identity request', async () => {
    const network = vi.spyOn(globalThis, 'fetch');
    const controller = new AutoSyncController(services());
    await controller.start();
    await controller.start();
    expect(controller.getView().status).toBe('local-only');
    expect(network).not.toHaveBeenCalled();
    controller.dispose();
    await new AutoSyncController(services()).start();
    expect(network).not.toHaveBeenCalled();
  });
  it('contacts config/session only after explicit activation, remembers it, and can leave setup', async () => {
    const network = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) =>
        String(input).endsWith('/config')
          ? Response.json({ signIn: 'google' })
          : Response.json({ error: { code: 'UNAUTHENTICATED' } }, { status: 401 }),
      );
    const controller = new AutoSyncController(services());
    await controller.start();
    await controller.activate();
    expect(network).toHaveBeenCalledTimes(2);
    expect(controller.getView().status).toBe('signed-out');
    controller.dispose();
    const resumed = new AutoSyncController(services());
    await resumed.start();
    expect(network).toHaveBeenCalledTimes(4);
    await resumed.useLocalOnly();
    expect(resumed.getView().status).toBe('local-only');
    resumed.dispose();
    await new AutoSyncController(services()).start();
    expect(network).toHaveBeenCalledTimes(4);
  });
});
