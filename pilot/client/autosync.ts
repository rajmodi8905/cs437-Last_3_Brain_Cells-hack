// Auto-sync for the app: sign-in, explicit inclusion, a sync loop and the cloud list.
// UI-agnostic; the Settings section subscribes to its view.
import type { CampusRecallServices } from '../../src/app/services';
import type { IndexedSegment, ItemKind, SearchableSegment, SourceLocation } from '../../src/shared';
import { plainMessage } from '../../src/app/plainError';
import {
  ApiFailure,
  createApiClient,
  type ApiClient,
  type ChangeItem,
  type SessionInfo,
} from './api';
import { applyEntry, type SignInResult } from './entry';
import { IndexedDbSyncStateStore } from './idb';
import { repositoryLibrary } from './library';
import { SyncEngine, type SyncResult } from './sync';
import type { SyncSnapshot } from './types';

export interface AutoSyncView {
  /** `offline`: the service cannot be reached; the last account's kept items are shown. */
  status: 'local-only' | 'loading' | 'unavailable' | 'offline' | 'signed-out' | 'signed-in';
  signInMode?: 'google' | 'dev';
  /** Google sign-in is configured on this server. */
  googleReady: boolean;
  /** The user arrived through the INSIIT link. */
  entry?: 'insiit';
  /** The cloud item open in the viewer, and where in it. */
  opened?: { globalId: string; location?: SourceLocation };
  email?: string;
  included: boolean;
  syncing: boolean;
  syncedCount: number;
  /** Cloud items that are not saved on this device. */
  cloudOnly: ChangeItem[];
  conflicts: { title: string; remoteTitle: string }[];
  blocked: boolean;
  /** Sync paused on this device. */
  paused: boolean;
  /** The cloud library was removed or reset; nothing syncs until the user starts again. */
  needsResync: boolean;
  /** Cloud items kept on this device for offline use. */
  offlineIds: string[];
  /** Sign-out could not reach the server, so its session may still be valid. */
  signOutPending: boolean;
  error?: string;
  /** How a Google sign-in that came back without a session ended. */
  signInResult?: string;
}

const SYNC_EVERY_MS = 15_000;

/** The engine hook search uses to include cloud items (see LocalEngine.extraSegments). */
interface CloudSearchHook {
  extraSegments?: (kind?: ItemKind) => Promise<SearchableSegment[]>;
}
/** The app's Dexie repository exposes its segments table; other repositories do not. */
interface WithSegments {
  database?: {
    segments: {
      where(index: string): { equals(value: string): { toArray(): Promise<IndexedSegment[]> } };
    };
  };
}

const controllers = new WeakMap<CampusRecallServices, AutoSyncController>();
/** One controller per app, so syncing continues on every screen, not only Settings. */
export function getAutoSync(services: CampusRecallServices) {
  let controller = controllers.get(services);
  if (!controller) {
    controller = new AutoSyncController(services);
    controllers.set(services, controller);
  }
  return controller;
}
const LIBRARY_ID_KEY = 'pilot-library-id';
const ACTIVATED_KEY = 'pilot-auto-sync-activated';
/** The account last signed in here, so its kept-offline items open without a network. */
const LAST_ACCOUNT_KEY = 'pilot-last-account';
/** Set until the server confirms sign-out; while set, the old session is never restored. */
const SIGN_OUT_PENDING_KEY = 'pilot-sign-out-pending';
const SIGN_OUT_PENDING_MESSAGE =
  'Could not reach the sync service to sign out, so this device may still be signed in. Connect to the internet and sign out again.';
const SIGN_OUT_PENDING_REMOVED_MESSAGE =
  'Synced copies were removed from this device, but the sync service could not be reached to sign out, so this device may still be signed in. Connect to the internet and sign out again.';

export class AutoSyncController {
  private api: ApiClient;
  private view: AutoSyncView = {
    status: 'local-only',
    googleReady: false,
    included: false,
    syncing: false,
    syncedCount: 0,
    cloudOnly: [],
    conflicts: [],
    blocked: false,
    paused: false,
    needsResync: false,
    offlineIds: [],
    signOutPending: false,
  };
  private listeners = new Set<() => void>();
  private engine?: SyncEngine;
  private state?: IndexedDbSyncStateStore;
  private session?: SessionInfo;
  private timer?: ReturnType<typeof setInterval>;
  private unsubscribeLibrary?: () => void;
  private debounce?: ReturnType<typeof setTimeout>;
  private running?: Promise<SyncResult | undefined>;
  private started?: Promise<void>;

  constructor(
    private services: CampusRecallServices,
    private apiBase = '/api/v1',
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

  /** Safe to call more than once; the first call does the work. */
  start() {
    this.started ??= this.resumeActivated();
    return this.started;
  }

  private async resumeActivated() {
    // Drops entry and credential-like parameters from the address before anything else runs.
    const entry = typeof location !== 'undefined' ? applyEntry() : undefined;
    if (entry?.from === 'insiit') this.set({ entry: 'insiit' });
    if (entry?.signIn) this.set({ signInResult: SIGN_IN_MESSAGES[entry.signIn] });
    if (await this.services.preferences.get<boolean>(SIGN_OUT_PENDING_KEY)) {
      this.set({ signOutPending: true, error: SIGN_OUT_PENDING_MESSAGE });
      // Finishing an earlier sign-out does not wait for the user to turn sync on again.
      if (!(await this.services.preferences.get<boolean>(ACTIVATED_KEY))) {
        await this.finishSignOut();
        return;
      }
    }
    if (await this.services.preferences.get<boolean>(ACTIVATED_KEY)) await this.begin();
  }

  /** Explicit permission to contact the sync service; library inclusion is a separate choice. */
  async activate() {
    await this.start();
    this.set({ signInResult: undefined });
    await this.services.preferences.set(ACTIVATED_KEY, true);
    await this.begin();
  }

  private async begin() {
    this.set({ status: 'loading' });
    try {
      const config = await this.api.config();
      this.set({ signInMode: config.signIn, googleReady: config.signIn === 'google' });
    } catch (cause) {
      await this.unreachable(cause);
      return;
    }
    if (this.view.signOutPending && !(await this.finishSignOut())) {
      this.set({ status: 'unavailable' });
      return;
    }
    let session: SessionInfo | undefined;
    try {
      session = await this.api.restoreSession();
    } catch (cause) {
      await this.unreachable(cause);
      return;
    }
    if (session) {
      await this.attach(session);
      return;
    }
    // The session ended on the server (expired or signed out elsewhere): stop showing this
    // account's kept items to whoever opens the app offline next.
    await this.services.preferences.set(LAST_ACCOUNT_KEY, undefined);
    this.set({ status: 'signed-out' });
  }

  /**
   * Only a request that never got an answer means the device is offline. A server that answers
   * with an error is reachable but failing, so it is reported as unavailable, not offline.
   */
  private async unreachable(cause: unknown) {
    if (cause instanceof ApiFailure) this.set({ status: 'unavailable' });
    else await this.openOffline();
  }

  /**
   * Ends a session that an earlier sign-out could not reach the server to end. True once the
   * server has no session for this device.
   */
  async finishSignOut() {
    try {
      // Restoring only fetches the CSRF token that sign-out needs; nothing is attached.
      if (await this.api.restoreSession()) await this.api.signOut();
    } catch {
      this.set({ signOutPending: true, error: SIGN_OUT_PENDING_MESSAGE });
      return false;
    }
    await this.services.preferences.set(SIGN_OUT_PENDING_KEY, false);
    this.set({ signOutPending: false, error: undefined });
    return true;
  }

  /** Without the service, opens the last account's local state so kept items still open. */
  private async openOffline() {
    const last = await this.services.preferences.get<{ account: string; email: string }>(
      LAST_ACCOUNT_KEY,
    );
    if (!last || this.view.signOutPending) {
      this.set({ status: 'unavailable' });
      return;
    }
    await this.connect(last.account);
    if (!this.state) return;
    const snapshot = await this.state.load();
    this.set({ status: 'offline', email: last.email });
    await this.refresh(snapshot);
  }

  /** Leave setup without contacting sign-in or polling again on the next reload. */
  async useLocalOnly() {
    await this.services.preferences.set(ACTIVATED_KEY, false);
    this.detach();
    this.set({ status: 'local-only', error: undefined, signInResult: undefined });
  }

  /** Leaves for Google; the server finishes sign-in and brings the user back to Settings. */
  signInGoogle(go: (url: string) => void = (url) => location.assign(url)) {
    if (!this.view.googleReady) return;
    this.set({ signInResult: undefined });
    go(`${this.apiBase}/auth/google/start`);
  }

  async signInDev(email: string) {
    await this.signIn(() => this.api.devToken(email.trim()));
  }

  private async signIn(token: () => Promise<string>) {
    this.set({ error: undefined, signInResult: undefined });
    try {
      await this.attach(await this.api.signIn(await token()));
    } catch (cause) {
      this.set({ status: 'signed-out', error: messageFor(cause) });
    }
  }

  private async attach(session: SessionInfo) {
    await this.connect(session.account);
    this.session = session;
    await this.services.preferences.set(LAST_ACCOUNT_KEY, {
      account: session.account,
      email: session.email,
    });
    const snapshot = await this.state!.load();
    this.set({ status: 'signed-in', email: session.email, error: undefined });
    await this.refresh(snapshot);
    if (snapshot.included) this.startLoop();
  }

  /** Opens an account's sync state on this device and the engine over it. */
  private async connect(account: string) {
    this.detach();
    let libraryId = await this.services.preferences.get<string>(LIBRARY_ID_KEY);
    if (!libraryId) {
      libraryId = globalThis.crypto.randomUUID();
      await this.services.preferences.set(LIBRARY_ID_KEY, libraryId);
    }
    const database = (this.services.library as WithSegments).database;
    const library = repositoryLibrary(
      this.services.library,
      database ? (id) => database.segments.where('itemId').equals(id).toArray() : undefined,
    );
    this.state = new IndexedDbSyncStateStore(account);
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
      remoteIndex: this.state.remoteIndex,
      offline: this.state.offline,
      libraryId,
    });
    const engine = this.engine;
    (this.services.engine as CloudSearchHook).extraSegments = async (kind) =>
      (await engine.cloudSegments()).filter((segment) => !kind || segment.itemKind === kind);
  }

  /** Resolves true once the library is included and its first sync pass has run. */
  async include(): Promise<boolean> {
    if (!this.engine || !this.session) return false;
    try {
      await this.engine.include(this.session.vault.epoch);
    } catch (cause) {
      this.set({ error: messageFor(cause) });
      return false;
    }
    this.startLoop();
    await this.syncNow();
    return true;
  }

  /**
   * One sync pass at a time; later calls wait for the current one. Resolves with the pass's
   * result, or undefined when it did not run or failed (the view then explains why).
   */
  syncNow(): Promise<SyncResult | undefined> {
    if (this.running) return this.running;
    this.running = (async () => {
      if (!this.engine || !this.state) return undefined;
      this.set({ syncing: true });
      try {
        const result = await this.withSyncLock(() => this.engine!.runOnce());
        if (!result) return undefined;
        this.set({
          blocked: result.blocked === 'library-mismatch',
          error: result.quotaExceeded
            ? 'Your cloud library is full. New items wait on this device until you delete something from the cloud library.'
            : result.failed
              ? 'Some changes could not be sent yet. Retrying.'
              : undefined,
        });
        return result;
      } catch (cause) {
        this.set({ error: messageFor(cause) });
        return undefined;
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
    return {
      blob: new Blob([bytes as BlobPart], { type: item?.mimeType }),
      name: fileNameFor(item),
    };
  }

  /** Export includes every account original, including items already on this device. */
  async exportCloudLibrary(): Promise<Blob[]> {
    const session = this.session;
    if (!session) throw new Error('Sign in first.');
    const { exportCloudVault } = await import('./export');
    return exportCloudVault({
      api: this.api,
      epoch: session.vault.epoch,
      assertAccount: () => {
        if (this.session !== session)
          throw new Error('Your account changed. Start the export again.');
      },
    });
  }

  /** Opens a cloud item in the viewer, at a page or time when search found one. */
  open(globalId: string, location?: SourceLocation) {
    this.set({ opened: { globalId, location } });
  }

  closeViewer() {
    if (this.view.opened) this.set({ opened: undefined });
  }

  async setPaused(paused: boolean) {
    await this.engine?.setPaused(paused);
    if (!paused) await this.syncNow();
    else if (this.state) await this.refresh(await this.state.load());
  }

  async keepOffline(globalId: string) {
    await this.engine?.keepOffline(globalId);
    if (this.state) await this.refresh(await this.state.load());
  }

  async removeDownload(globalId: string) {
    await this.engine?.removeDownload(globalId);
    if (this.state) await this.refresh(await this.state.load());
  }

  async deleteCloudItem(globalId: string) {
    await this.engine?.deleteCloudItem(globalId);
    if (this.state) await this.refresh(await this.state.load());
  }

  async removeCloudLibrary() {
    if (!this.engine || !this.session) return;
    const { vault } = await this.engine.removeCloudLibrary();
    this.session = { ...this.session, vault };
    this.stopLoop();
    if (this.state) await this.refresh(await this.state.load());
  }

  /** After the cloud library was removed elsewhere: forget old cloud state, opted out. */
  async startAgain() {
    const session = await this.api.restoreSession();
    if (!session || !this.engine) return;
    this.session = session;
    await this.engine.startAgain(session.vault.epoch);
    this.stopLoop();
    if (this.state) await this.refresh(await this.state.load());
  }

  /** `removeLocalCopies` also deletes this account's sync state and offline copies here. */
  async signOut(removeLocalCopies = false) {
    await this.services.preferences.set(ACTIVATED_KEY, false);
    await this.services.preferences.set(LAST_ACCOUNT_KEY, undefined);
    // Recorded first, so a closed tab or failed request never leaves the session restorable.
    await this.services.preferences.set(SIGN_OUT_PENDING_KEY, true);
    let ended = true;
    try {
      await this.api.signOut();
    } catch (cause) {
      // No session left on the server is a finished sign-out too.
      ended = cause instanceof ApiFailure && cause.code === 'UNAUTHENTICATED';
    }
    if (ended) await this.services.preferences.set(SIGN_OUT_PENDING_KEY, false);
    const state = this.state;
    this.detach();
    if (removeLocalCopies) await state?.destroy();
    this.set({
      signOutPending: !ended,
      error: ended
        ? undefined
        : removeLocalCopies
          ? SIGN_OUT_PENDING_REMOVED_MESSAGE
          : SIGN_OUT_PENDING_MESSAGE,
      status: 'local-only',
      email: undefined,
      opened: undefined,
      included: false,
      syncedCount: 0,
      cloudOnly: [],
      conflicts: [],
      blocked: false,
      paused: false,
      needsResync: false,
      offlineIds: [],
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

  /** One tab syncs an account at a time; other tabs skip that pass. */
  private async withSyncLock<T>(work: () => Promise<T>): Promise<T | undefined> {
    const locks = (globalThis.navigator as Navigator | undefined)?.locks;
    if (!locks || !this.session) return work();
    return locks.request(
      `campus-recall-sync-${this.session.account}`,
      { ifAvailable: true },
      async (lock) => (lock ? work() : undefined),
    );
  }

  private stopLoop() {
    clearInterval(this.timer);
    clearTimeout(this.debounce);
    this.timer = undefined;
    this.unsubscribeLibrary?.();
    this.unsubscribeLibrary = undefined;
  }

  private detach() {
    delete (this.services.engine as CloudSearchHook).extraSegments;
    this.stopLoop();
    this.state?.close();
    this.state = undefined;
    this.engine = undefined;
    this.session = undefined;
  }

  private async refresh(snapshot: SyncSnapshot) {
    const offlineIds = (await this.engine?.offlineIds()) ?? [];
    const live = snapshot.mappings.filter((m) => m.state !== 'deleted');
    const mapped = new Set(live.map((m) => m.globalId));
    this.set({
      included: snapshot.included,
      paused: !!snapshot.paused,
      needsResync: !!snapshot.needsResync,
      offlineIds,
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

const SIGN_IN_MESSAGES: Record<SignInResult, string> = {
  cancelled: 'Sign-in was cancelled.',
  'not-eligible': 'Only IITGN Google accounts (@iitgn.ac.in) can sign in.',
  failed: 'Sign-in did not finish. Try again.',
};

/** A download name: the title plus the extension of the original's type. */
export function fileNameFor(item?: Pick<ChangeItem, 'title' | 'mimeType'>) {
  return `${item?.title ?? 'original'}${EXTENSIONS[item?.mimeType ?? ''] ?? ''}`;
}

/** What a finished Sync now pass did, or undefined when the view already explains a problem. */
export function syncSummary(result: SyncResult | undefined) {
  if (!result || result.failed || result.quotaExceeded || result.blocked) return undefined;
  if (result.paused || result.needsResync) return undefined;
  const changes = result.uploaded + result.renamed + result.deleted;
  return changes ? `${changes} change${changes === 1 ? '' : 's'} synced.` : 'Up to date.';
}

function messageFor(cause: unknown) {
  if (cause instanceof ApiFailure) {
    if (cause.code === 'NOT_ELIGIBLE')
      return 'Only verified IITGN accounts (@iitgn.ac.in) can sign in.';
    if (cause.code === 'UNAUTHENTICATED') return 'Sign-in did not work. Try again.';
  }
  return plainMessage(cause);
}
