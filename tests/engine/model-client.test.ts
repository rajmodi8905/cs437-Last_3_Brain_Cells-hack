// @vitest-environment jsdom
import { it, expect, vi, afterEach } from 'vitest';
import { ModelClient } from '../../src/app/model-client';
class FakeWorker {
  static instances: FakeWorker[] = [];
  static acknowledgeDispose = true;
  messages: any[] = [];
  onmessage?: ({ data }: { data: any }) => void;
  onerror?: ({ message }: { message: string }) => void;
  terminated = false;
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(message: any) {
    this.messages.push(message);
    if (message.method === 'dispose' && FakeWorker.acknowledgeDispose)
      queueMicrotask(() => this.reply({ id: message.id, value: undefined, device: 'wasm' }));
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
  FakeWorker.acknowledgeDispose = true;
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
it('releases an idle GPU model before terminating its worker and shares concurrent disposal', async () => {
  FakeWorker.acknowledgeDispose = false;
  vi.stubGlobal('Worker', FakeWorker);
  const client = new ModelClient();
  const query = client.query('one');
  const worker = FakeWorker.instances[0];
  worker.reply({ id: 1, value: new Float32Array([1]), device: 'webgpu' });
  await query;
  const first = client.dispose();
  const second = client.dispose();
  expect(worker.terminated).toBe(false);
  expect(worker.messages.filter((m) => m.method === 'dispose')).toHaveLength(1);
  const release = worker.messages.at(-1);
  worker.reply({ id: release.id, value: undefined, device: 'webgpu' });
  await Promise.all([first, second]);
  expect(worker.terminated).toBe(true);
});
it('bounds cleanup when the worker does not respond and permits a fresh worker afterward', async () => {
  FakeWorker.acknowledgeDispose = false;
  vi.useFakeTimers();
  vi.stubGlobal('Worker', FakeWorker);
  try {
    const client = new ModelClient();
    const query = client.query('one');
    const worker = FakeWorker.instances[0];
    worker.reply({ id: 1, value: new Float32Array([1]), device: 'webgpu' });
    await query;
    const disposal = client.dispose();
    await vi.runAllTimersAsync();
    await disposal;
    expect(worker.terminated).toBe(true);
    const next = client.query('two');
    const fresh = FakeWorker.instances[1];
    fresh.reply({ id: fresh.messages[0].id, value: new Float32Array([1]), device: 'wasm' });
    await next;
  } finally {
    vi.useRealTimers();
  }
});
it('rejects interrupted requests and new calls during cleanup without replaying disposal on GPU error', async () => {
  vi.stubGlobal('Worker', FakeWorker);
  FakeWorker.acknowledgeDispose = false;
  const client = new ModelClient();
  const request = client.query('private pending query');
  const rejected = expect(request).rejects.toThrow('Processing stopped');
  const worker = FakeWorker.instances[0];
  const disposal = client.dispose();
  await rejected;
  await expect(client.query('new query')).rejects.toThrow('stopping');
  const release = worker.messages.at(-1);
  worker.reply({ id: release.id, error: 'GPU lost during release', retryWasm: true });
  await disposal;
  expect(FakeWorker.instances).toHaveLength(1);
  expect(worker.terminated).toBe(true);
});
