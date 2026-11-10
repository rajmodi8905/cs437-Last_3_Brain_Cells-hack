export interface DocumentEmbedding {
  text: string;
  vector: Float32Array;
}
export interface Transcript {
  text: string;
  chunks: Array<{ text: string; timestamp: [number, number | null] }>;
}
export interface ModelCalls {
  documents: { args: { text: string; title: string }; result: DocumentEmbedding[] };
  query: { args: { text: string }; result: Float32Array };
  image: { args: { blob: Blob }; result: Float32Array };
  transcribe: { args: { samples: Float32Array }; result: Transcript };
  dispose: { args: Record<string, never>; result: undefined };
}
export type ModelMethod = keyof ModelCalls;
export type ModelRequest = {
  [K in ModelMethod]: {
    id: number;
    method: K;
    args: ModelCalls[K]['args'];
    base: string;
    forceWasm: boolean;
    /** S16: the student's own model, for the custom-model worker. */
    customModel?: CustomWorkerModel;
  };
}[ModelMethod];
/** What the custom-model worker needs to load and use a student's own model (S16). */
export interface CustomWorkerModel {
  repo: string;
  revision: string;
  dtype: 'q8' | 'fp32';
  pooling: 'mean' | 'cls';
  queryPrefix: string;
  documentPrefix: string;
}
export type ModelResponse =
  | { id: number; value: unknown; device: 'webgpu' | 'wasm' }
  | { id: number; error: string; retryWasm: boolean };
