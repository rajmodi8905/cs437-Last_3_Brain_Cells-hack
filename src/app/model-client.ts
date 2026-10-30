import type { ModelCalls, ModelMethod, ModelRequest, ModelResponse } from './model-protocol';
export type { DocumentEmbedding, Transcript } from './model-protocol';
export class ModelClient {
  private worker?: Worker;
  private nextId = 0;
  private pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (cause: Error) => void; request: ModelRequest }
  >();
  private forceWasm = false;
  private disposal?: Promise<void>;
  device?: 'webgpu' | 'wasm';
  private start() {
    if (this.worker) return;
    this.worker = new Worker(new URL('../engine/model.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.onmessage = ({ data }: MessageEvent<ModelResponse>) => {
      const pending = this.pending.get(data.id);
      if (!pending) return;
      if (
        'error' in data &&
        data.retryWasm &&
        !this.forceWasm &&
        pending.request.method !== 'dispose'
      ) {
        this.worker?.terminate();
        this.worker = undefined;
        this.forceWasm = true;
        this.start();
        for (const request of this.pending.values()) this.send(request.request);
        return;
      }
      this.pending.delete(data.id);
      if ('error' in data) pending.reject(new Error(data.error));
      else {
        this.device = data.device;
        pending.resolve(data.value);
      }
    };
    this.worker.onerror = (event) => {
      this.failAll(new Error(event.message || 'Local model worker stopped.'));
      this.worker?.terminate();
      this.worker = undefined;
    };
  }
  private failAll(cause: Error) {
    for (const pending of this.pending.values()) pending.reject(cause);
    this.pending.clear();
  }
  private call<K extends ModelMethod>(
    method: K,
    args: ModelCalls[K]['args'],
  ): Promise<ModelCalls[K]['result']> {
    if (this.disposal)
      return Promise.reject(new Error('Local models are stopping. Retry shortly.'));
    this.start();
    const id = ++this.nextId;
    const request = {
      id,
      method,
      args,
      forceWasm: this.forceWasm,
      base: new URL(import.meta.env.BASE_URL, document.baseURI).href,
    } as ModelRequest;
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as ModelCalls[K]['result']),
        reject,
        request,
      });
      try {
        this.send(request);
      } catch (cause) {
        this.pending.delete(id);
        reject(cause);
      }
    });
  }
  private send(request: ModelRequest) {
    this.worker!.postMessage({ ...request, forceWasm: this.forceWasm });
  }
  documents(text: string, title: string) {
    return this.call('documents', { text, title });
  }
  query(text: string) {
    return this.call('query', { text });
  }
  image(blob: Blob) {
    return this.call('image', { blob });
  }
  transcribe(samples: Float32Array) {
    return this.call('transcribe', { samples });
  }
  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    const worker = this.worker;
    this.failAll(new Error('Processing stopped.'));
    if (!worker) return Promise.resolve();
    // Give idle GPU sessions a chance to release before destroying their context.
    // A stuck/in-flight worker still has a bounded shutdown and cannot block reopen.
    const shutdown = new Promise<void>((resolve) => {
      const id = ++this.nextId;
      const finish = () => {
        clearTimeout(timer);
        this.pending.delete(id);
        worker.terminate();
        if (this.worker === worker) this.worker = undefined;
        resolve();
      };
      const timer = setTimeout(finish, 2000);
      const request: ModelRequest = {
        id,
        method: 'dispose',
        args: {},
        base: new URL(import.meta.env.BASE_URL, document.baseURI).href,
        forceWasm: this.forceWasm,
      };
      this.pending.set(id, { resolve: finish, reject: finish, request });
      try {
        worker.postMessage(request);
      } catch {
        finish();
      }
    });
    this.disposal = shutdown.finally(() => {
      this.disposal = undefined;
    });
    return this.disposal;
  }
}
