// Auto-sync for the app: sign-in, explicit inclusion, a sync loop and the cloud list.
// UI-agnostic; the Settings section subscribes to its view.
import type { CampusRecallServices } from '../../src/app/services';
import {
  ApiFailure,
  createApiClient,
  type ApiClient,
  type ChangeItem,
  type SessionInfo,
} from './api';
import { IndexedDbSyncStateStore } from './idb';
import { repositoryLibrary } from './library';
import { SyncEngine } from './sync';
import type { SyncSnapshot } from './types';

export interface AutoSyncView {
  status: 'loading' | 'unavailable' | 'signed-out' | 'signed-in';
  signInMode?: 'google' | 'dev';
  email?: string;
  included: boolean;
  syncing: boolean;
  syncedCount: number;
  /** Cloud items that are not saved on this device. */
  cloudOnly: ChangeItem[];
  conflicts: { title: string; remoteTitle: string }[];
  blocked: boolean;
  error?: string;
}

const SYNC_EVERY_MS = 15_000;
const LIBRARY_ID_KEY = 'pilot-library-id';

export class AutoSyncController {
  private api: ApiClient;
  private view: AutoSyncView = {
    status: 'loading',
    included: false,
    syncing: false,
    syncedCount: 0,
    cloudOnly: [],
    conflicts: [],
    blocked: false,
  };
  private listeners = new Set<() => void>();
  private engine?: SyncEngine;
  private state?: IndexedDbSyncStateStore;
  private session?: SessionInfo;
  private timer?: ReturnType<typeof setInterval>;
  private unsubscribeLibrary?: () => void;
  private debounce?: ReturnType<typeof setTimeout>;
  private running?: Promise<void>;

  constructor(
    private services: CampusRecallServices,
    apiBase = '/api/v1',
  ) {
    this.api = createApiClient({ base: apiBase });
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getView = () => this.view;
  private set(patch: Partial<AutoSyncView>) {
    this.view = { ...this.view, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  async start() {
    try {
      const config = await this.api.config();
      this.set({ signInMode: config.signIn });
    } catch {
      this.set({ status: 'unavailable' });
      return;
    }
    const session = await this.api.restoreSession().catch(() => undefined);
    if (session) await this.attach(session);
    else this.set({ status: 'signed-out' });
  }

  async signInDev(email: string) {
    await this.signIn(() => this.api.devToken(email.trim()));
  }

  private async signIn(token: () => Promise<string>) {
    this.set({ error: undefined });
    try {
      await this.attach(await this.api.signIn(await token()));
    } catch (cause) {
      this.set({ status: 'signed-out', error: messageFor(cause) });
    }
  }

  private async attach(session: SessionInfo) {
    this.detach();
    this.session = session;
    let libraryId = await this.services.preferences.get<string>(LIBRARY_ID_KEY);
    if (!libraryId) {
      libraryId = globalThis.crypto.randomUUID();
      await this.services.preferences.set(LIBRARY_ID_KEY, libraryId);
    }
    const library = repositoryLibrary(this.services.library);
    this.state = new IndexedDbSyncStateStore(session.account);
    this.engine = new SyncEngine({
      api: this.api,
      // A rename from another device changes what search embeds, so re-index it.
      library: {
        ...library,
        renameItem: async (id, title) => {
          await library.renameItem(id, title);
          void this.services.engine.indexItem(id);
        },
      },
      state: this.state,
      libraryId,
    });
    const snapshot = await this.state.load();
    this.set({ status: 'signed-in', email: session.email, error: undefined });
    await this.refresh(snapshot);
    if (snapshot.included) this.startLoop();
  }

  async include() {
    if (!this.engine || !this.session) return;
    try {
      await this.engine.include(this.session.vault.epoch);
    } catch (cause) {
      this.set({ error: messageFor(cause) });
      return;
    }
    this.startLoop();
    await this.syncNow();
  }

  /** One sync pass at a time; later calls wait for the current one. */
  syncNow(): Promise<void> {
    if (this.running) return this.running;
    this.running = (async () => {
      if (!this.engine || !this.state) return;
      this.set({ syncing: true });
      try {
        const result = await this.engine.runOnce();
        this.set({
          blocked: result.blocked === 'library-mismatch',
          error: result.failed ? 'Some changes could not be sent yet. Retrying.' : undefined,
        });
      } catch (cause) {
        this.set({ error: messageFor(cause) });
      } finally {
        await this.refresh(await this.state.load());
        this.set({ syncing: false });
        this.running = undefined;
      }
    })();
    return this.running;
  }

  async download(globalId: string): Promise<{ blob: Blob; name: string }> {
    if (!this.engine) throw new Error('Sign in first.');
    const item = this.view.cloudOnly.find((candidate) => candidate.globalId === globalId);
    const bytes = await this.engine.download(globalId);
    const extension = EXTENSIONS[item?.mimeType ?? ''] ?? '';
    return {
      blob: new Blob([bytes as BlobPart], { type: item?.mimeType }),
      name: `${item?.title ?? 'original'}${extension}`,
    };
  }

  async signOut() {
    await this.api.signOut().catch(() => undefined);
    this.detach();
    this.set({
      status: 'signed-out',
      email: undefined,
      included: false,
      syncedCount: 0,
      cloudOnly: [],
      conflicts: [],
      blocked: false,
    });
  }

  dispose() {
    this.detach();
    this.listeners.clear();
  }

  private startLoop() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.syncNow(), SYNC_EVERY_MS);
    this.unsubscribeLibrary = this.services.subscribeLibrary(
      () => {
        clearTimeout(this.debounce);
        this.debounce = setTimeout(() => void this.syncNow(), 800);
      },
      () => undefined,
    );
  }

  private detach() {
    clearInterval(this.timer);
    clearTimeout(this.debounce);
    this.timer = undefined;
    this.unsubscribeLibrary?.();
    this.unsubscribeLibrary = undefined;
    this.state?.close();
    this.state = undefined;
    this.engine = undefined;
    this.session = undefined;
  }

  private async refresh(snapshot: SyncSnapshot) {
    const live = snapshot.mappings.filter((m) => m.state !== 'deleted');
    const mapped = new Set(live.map((m) => m.globalId));
    this.set({
      included: snapshot.included,
      syncedCount: live.filter((m) => m.state === 'synced').length,
      cloudOnly: Object.values(snapshot.catalogue)
        .filter((item) => !mapped.has(item.globalId))
        .sort((a, b) => (a.title ?? '').localeCompare(b.title ?? '')),
      conflicts: live
        .filter((m) => m.state === 'conflict')
        .map((m) => ({ title: m.syncedTitle, remoteTitle: m.remoteTitle ?? '' })),
    });
  }
}

const EXTENSIONS: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'video/mp4': '.mp4',
  'text/plain;charset=utf-8': '.txt',
};

function messageFor(cause: unknown) {
  if (cause instanceof ApiFailure) {
    if (cause.code === 'NOT_ELIGIBLE')
      return 'Only verified IITGN accounts (@iitgn.ac.in) can sign in.';
    if (cause.code === 'UNAUTHENTICATED') return 'Sign-in did not work. Try again.';
    return cause.message;
  }
  return cause instanceof Error ? cause.message : String(cause);
}
