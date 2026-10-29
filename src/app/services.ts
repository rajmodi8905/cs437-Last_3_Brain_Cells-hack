import { liveQuery } from 'dexie';
import { CampusRecallDatabase, DexieLibraryRepository } from '../storage';
import { LocalEngine } from '../engine';
import { captureWebpage, extractHtml, extractPdfText, validateWebUrl } from '../engine/capture';
import type { EngineClient, LibraryItem, LibraryRepository } from '../shared';

export interface ApplicationEngine extends EngineClient {
  readonly ready: boolean;
  readonly downloadBytes: number;
}
export interface CaptureService {
  captureWebpage: typeof captureWebpage;
  extractHtml: typeof extractHtml;
  extractPdfText: typeof extractPdfText;
  validateWebUrl: typeof validateWebUrl;
}
/** Stable boundary for any future React skin or other presentation layer. */
export interface CampusRecallServices {
  library: LibraryRepository;
  engine: ApplicationEngine;
  capture: CaptureService;
  initialize(): Promise<void>;
  subscribeLibrary(
    next: (items: LibraryItem[]) => void,
    error: (cause: unknown) => void,
  ): () => void;
  preferences: {
    get<T>(key: string): Promise<T | undefined>;
    set(key: string, value: unknown): Promise<void>;
  };
}
export function createCampusRecallServices(): CampusRecallServices {
  const library = new DexieLibraryRepository(new CampusRecallDatabase());
  const engine = new LocalEngine(library);
  return {
    library,
    engine,
    capture: { captureWebpage, extractHtml, extractPdfText, validateWebUrl },
    async initialize() {
      await library.open();
      await engine.initialize();
    },
    subscribeLibrary(next, error) {
      const subscription = liveQuery(() => library.listItems()).subscribe({ next, error });
      return () => subscription.unsubscribe();
    },
    preferences: {
      async get<T>(key: string) {
        return (await library.database.settings.get(key))?.value as T | undefined;
      },
      async set(key, value) {
        await library.database.settings.put({ key, value });
      },
    },
  };
}
