// @vitest-environment jsdom
import { it, expect, vi, afterEach } from 'vitest';
import { ModelClient } from '../../src/app/model-client';
class FakeWorker {
  static instances: FakeWorker[] = [];
  messages: any[] = [];
  onmessage?: ({ data }: { data: any }) => void;
  onerror?: ({ message }: { message: string }) => void;
  terminated = false;
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(message: any) {
    this.messages.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  reply(data: any) {
    this.onmessage?.({ data });
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  FakeWorker.instances = [];
});
it('replays pure pending requests once in a fresh WASM worker and preserves IDs', async () => {
  vi.stubGlobal('Worker', FakeWorker);
  const client = new ModelClient();
  const first = client.query('private query');
  const second = client.documents('private note', 'title');
  const original = FakeWorker.instances[0];
  original.reply({ id: 1, error: 'GPU lost', retryWasm: true });
  expect(original.terminated).toBe(true);
  const fallback = FakeWorker.instances[1];
  expect(fallback.messages.map((m) => ({ id: m.id, forceWasm: m.forceWasm }))).toEqual([
    { id: 1, forceWasm: true },
    { id: 2, forceWasm: true },
  ]);
  fallback.reply({ id: 1, value: new Float32Array([1]), device: 'wasm' });
  fallback.reply({ id: 2, value: [], device: 'wasm' });
  expect(await first).toEqual(new Float32Array([1]));
  expect(await second).toEqual([]);
  await client.dispose();
});
it('rejects requests after worker failure and permits a subsequent fresh worker', async () => {
  vi.stubGlobal('Worker', FakeWorker);
  const client = new ModelClient();
  const rejected = client.query('one');
  const assertion = expect(rejected).rejects.toThrow('Worker failed');
  FakeWorker.instances[0].onerror?.({ message: 'Worker failed' });
  await assertion;
  const next = client.query('two');
  expect(FakeWorker.instances).toHaveLength(2);
  FakeWorker.instances[1].reply({ id: 2, value: new Float32Array([1]), device: 'wasm' });
  await next;
  await client.dispose();
});
