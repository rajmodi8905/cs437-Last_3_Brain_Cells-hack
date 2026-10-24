import {
  AppOperationError,
  type EngineClient,
  type EngineProgress,
  type ItemKind,
  type ProgressListener,
  type SearchResult,
} from '../shared/index.js';

const unavailable = () =>
  Promise.reject(
    new AppOperationError({
      code: 'ENGINE_UNAVAILABLE',
      message: 'The local processing engine is not available yet.',
      retryable: false,
    }),
  );

export class UnavailableEngineClient implements EngineClient {
  async setupModels(): Promise<void> {
    return unavailable();
  }
  async indexItem(): Promise<void> {
    return unavailable();
  }
  async search(_query: string, _kindFilter?: ItemKind): Promise<SearchResult[]> {
    return unavailable();
  }
  async cancelItem(): Promise<void> {
    return unavailable();
  }
  subscribeProgress(_listener: ProgressListener): () => void {
    return () => undefined;
  }
  async dispose(): Promise<void> {
    return undefined;
  }
}

export type { EngineProgress };
