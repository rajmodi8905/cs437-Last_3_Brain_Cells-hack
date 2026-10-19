import { describe, expect, it } from 'vitest';
import { UnavailableEngineClient } from '../../src/engine/unavailable.js';

describe('UnavailableEngineClient', () => {
  it('rejects production engine operations without fake results', async () => {
    const engine = new UnavailableEngineClient();
    await expect(engine.search('anything')).rejects.toMatchObject({ detail: { code: 'ENGINE_UNAVAILABLE' } });
  });
});