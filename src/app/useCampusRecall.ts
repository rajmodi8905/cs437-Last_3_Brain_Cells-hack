import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppOperationError,
  type EngineProgress,
  type ItemKind,
  type LibraryItem,
  type SearchResult,
  type SourceLocation,
} from '../shared';
import type { CampusRecallServices } from './services';
import { useLibraryItems } from './useLibraryItems';
import { backupCreatedMessage, downloadParts, exportLibrary } from './backup';
import { plainError } from './plainError';
import {
  createPersistenceRequest,
  INSTALL_DECLINED,
  isInstalled,
  type InstallPromptEvent,
} from './phone';
import { navigateFromViewer } from './viewerHistory';
import { GEMMA, type CustomModelConfig, type SearchModel } from '../shared/searchModels';
import {
  REMEMBER_RECENT_SEARCHES,
  RECENT_SEARCHES,
  readRecentSearches,
  withRecentSearch,
} from './recentSearches';
const route = () => window.location.hash.slice(2).split('?')[0] || 'home';
/** A global error and the screen it belongs to. It clears when the student moves on. */
interface ScreenError {
  message: string;
  detail?: string;
  screen: string;
}
const NO_ERROR: ScreenError = { message: '', screen: '' };
export function useCampusRecall(services: CampusRecallServices) {
  const { library: repository, engine } = services;
  const [statusFilter, setStatusFilter] = useState('');
  const [screen, setScreen] = useState(route);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ItemKind>();
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState('');
  // Shown under the search box after an empty search, until the student types.
  const [searchHint, setSearchHint] = useState(false);
  // The last searches that found something. Kept in this device's preferences only: never
  // synced, exported or sent anywhere. The student can turn this off in Settings.
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [rememberSearches, setRememberSearches] = useState(true);
  // Searches finish after an await, so they read the latest list and switch from refs.
  const recent = useRef<string[]>([]);
  const remember = useRef(true);
  const [selected, setSelected] = useState<{ id: string; location?: SourceLocation }>();
  const [toast, setToast] = useState('');
  const [screenError, setScreenError] = useState<ScreenError>(NO_ERROR);
  // Search results are announced politely; focus stays where the student is.
  const [announcement, setAnnouncement] = useState('');
  const [downloadBytes, setDownloadBytes] = useState(0);
  const [ready, setReady] = useState(false);
  // True once the start-up asset check has answered, so "not ready" is known rather than assumed.
  const [setupKnown, setSetupKnown] = useState(false);
  // A plain reason shown in the Search card when a setup started there stopped.
  const [setupError, setSetupError] = useState('');
  const [setup, setSetup] = useState(false);
  // S16: the search model in use, the student's own model, and adding or switching.
  const [searchModel, setSearchModel] = useState<SearchModel>(engine.searchModel ?? GEMMA);
  const [customModel, setCustomModel] = useState<SearchModel | undefined>(engine.customModel);
  const [switchingModel, setSwitchingModel] = useState(false);
  const [addingModel, setAddingModel] = useState('');
  const [addModelError, setAddModelError] = useState('');
  const [progress, setProgress] = useState<EngineProgress>();
  const [itemProgress, setItemProgress] = useState<Record<string, EngineProgress>>({});
  const [introPending, setFirstUse] = useState(false);
  const firstUse = introPending && !['home', 'privacy', 'terms'].includes(screen);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [update, setUpdate] = useState<ServiceWorkerRegistration>();
  const [storage, setStorage] = useState<{ usage?: number; quota?: number; persistent?: boolean }>(
    {},
  );
  const [busy, setBusy] = useState('');
  const [menu, setMenu] = useState<string>();
  const closeMenu = useCallback(() => setMenu(undefined), []);
  const menuOpen = useRef(false);
  useEffect(() => {
    menuOpen.current = !!menu;
  }, [menu]);
  // Chromium's install event, kept for one offer after a save (see installOffer below).
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent>();
  const [installAnswered, setInstallAnswered] = useState(true);
  const [installed, setInstalled] = useState(() => isInstalled());
  const [savedThisSession, setSavedThisSession] = useState(false);
  // Asks the browser to keep the library after saves, at most once per app session.
  const [keepLibrary] = useState(() => createPersistenceRequest(navigator.storage));
  const [rename, setRename] = useState<{ id: string; title: string }>();
  const [deleting, setDeleting] = useState<LibraryItem>();
  const searchInput = useRef<HTMLInputElement>(null);
  const restoreInput = useRef<HTMLInputElement>(null);
  const searchGeneration = useRef(0);
  // A search typed before offline setup. It runs once setup finishes and Search is open.
  const pendingSearch = useRef<string>(undefined);
  /** Shows a plain version of `cause` on screen `on` (the current one by default). */
  const fail = (cause: unknown, on: string = route()) => {
    const { message, detail } = plainError(cause);
    setScreenError({ message, detail, screen: on });
  };
  const setError = (message: string) => (message ? fail(message) : setScreenError(NO_ERROR));
  // Engine failures without an item are shown once each, so a repeating failure is not re-raised.
  const engineFailures = useRef(new Set<string>());
  const { items, error: libraryError } = useLibraryItems(services);
  useEffect(() => {
    if (libraryError) fail(libraryError);
  }, [libraryError]);
  const item = items.find((i) => i.id === selected?.id);
  useEffect(() => {
    const handle = () => {
      const next = route();
      setScreen(next);
      setMenu(undefined);
      setSearchHint(false);
      // An error from the previous screen is stale here.
      setScreenError((current) => (current.screen === next ? current : NO_ERROR));
    };
    window.addEventListener('hashchange', handle);
    return () => window.removeEventListener('hashchange', handle);
  }, []);
  useEffect(() => {
    let alive = true;
    const unsubscribe = engine.subscribeProgress((event) => {
      if (!alive) return;
      if (event.itemId) setItemProgress((p) => ({ ...p, [event.itemId!]: event }));
      else if (event.stage === 'failed') {
        const message = event.message ?? 'Processing stopped.';
        if (!engineFailures.current.has(message)) {
          engineFailures.current.add(message);
          fail(message);
        }
      } else setProgress(event);
    });
    void services
      .initialize()
      .then(async () => {
        const setting = await services.preferences.get<boolean>('intro-seen');
        if (alive) setFirstUse(!setting);
        const answered = await services.preferences.get<boolean>(INSTALL_DECLINED);
        if (alive) setInstallAnswered(!!answered);
        const on = (await services.preferences.get(REMEMBER_RECENT_SEARCHES)) !== false;
        const stored = readRecentSearches(await services.preferences.get(RECENT_SEARCHES));
        if (alive) {
          remember.current = on;
          recent.current = on ? stored : [];
          setRememberSearches(on);
          setRecentSearches(recent.current);
        }
        if (alive) {
          setReady(engine.ready);
          setDownloadBytes(engine.downloadBytes);
          setSetupKnown(true);
        }
      })
      .catch((cause) => {
        if (alive) fail(cause);
        if (alive) setSetupKnown(true);
      });
    const online = () => setOffline(!navigator.onLine);
    window.addEventListener('online', online);
    window.addEventListener('offline', online);
    const keyboard = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchInput.current?.focus();
      }
      if (e.key === 'Escape') {
        // An open item menu closes on its own; the viewer behind it stays open. Cancelling the
        // key also keeps the viewer's CloseWatcher from treating it as a close request.
        if (menuOpen.current) {
          e.preventDefault();
          setMenu(undefined);
          return;
        }
        setSelected(undefined);
        setMenu(undefined);
      }
    };
    window.addEventListener('keydown', keyboard);
    const offered = (event: Event) => {
      // The app shows its own offer after a save instead of the browser's mini bar.
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const installedNow = () => {
      setInstalled(true);
      setInstallPrompt(undefined);
    };
    window.addEventListener('beforeinstallprompt', offered);
    window.addEventListener('appinstalled', installedNow);
    if ('serviceWorker' in navigator)
      void navigator.serviceWorker
        .register(
          `${import.meta.env.BASE_URL}${import.meta.env.DEV ? 'dev-sw.js?dev-sw' : 'sw.js'}`,
          { type: 'module' },
        )
        .then((reg) => {
          if (!alive) return;
          if (reg.waiting) setUpdate(reg);
          reg.addEventListener('updatefound', () => {
            reg.installing?.addEventListener('statechange', () => {
              if (reg.waiting && navigator.serviceWorker.controller) setUpdate(reg);
            });
          });
        })
        .catch(() => {
          /* Dev server does not ship a service worker. */
        });
    return () => {
      alive = false;
      unsubscribe();
      window.removeEventListener('online', online);
      window.removeEventListener('offline', online);
      window.removeEventListener('keydown', keyboard);
      window.removeEventListener('beforeinstallprompt', offered);
      window.removeEventListener('appinstalled', installedNow);
    };
  }, [services, engine]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 6500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (selected && !item) setSelected(undefined);
  }, [items, selected, item]);
  useEffect(() => {
    if (screen !== 'settings') return;
    void Promise.all([navigator.storage?.estimate(), navigator.storage?.persisted?.()]).then(
      ([estimate, persistent]) => setStorage({ ...estimate, persistent }),
    );
  }, [screen, items.length]);
  const notify = (message: string) => setToast(message);
  /** Pins, downloads and calibrates a student's own model; nothing switches yet. */
  const addCustomModel = async (
    repo: string,
    options: Pick<CustomModelConfig, 'pooling' | 'queryPrefix' | 'documentPrefix'>,
  ) => {
    if (!engine.addCustomModel || addingModel) return;
    setAddModelError('');
    setAddingModel('Checking the model on Hugging Face…');
    try {
      const added = await engine.addCustomModel(repo, options, (event) =>
        setAddingModel(
          event.totalBytes
            ? `Downloading and verifying… ${Math.round((event.loadedBytes ?? 0) / 1e6)} of ${Math.round(event.totalBytes / 1e6)} MB`
            : (event.message ?? 'Working…'),
        ),
      );
      setCustomModel(added);
      notify(
        `${added.label} found ${added.custom!.calibration.correct} of ${added.custom!.calibration.total} sample questions and wrongly matched ${added.custom!.calibration.unrelatedMatched} of ${added.custom!.calibration.unrelatedTotal} unrelated ones. Choose it below to switch.`,
      );
    } catch (cause) {
      setAddModelError(plainError(cause).message);
    } finally {
      setAddingModel('');
    }
  };
  /** Downloads and verifies the chosen model if needed, then re-indexes the library with it. */
  const switchSearchModel = async (next: SearchModel) => {
    if (!engine.setSearchModel || switchingModel) return;
    setSwitchingModel(true);
    setError('');
    try {
      await engine.setSearchModel(next);
      setSearchModel(engine.searchModel ?? next);
      setReady(engine.ready);
      setDownloadBytes(engine.downloadBytes);
      const count = items.length;
      notify(
        `Switched to ${next.label}.${
          count
            ? ` Re-indexing your ${count === 1 ? 'item' : `${count} items`}; each one becomes searchable again as soon as it is done.`
            : ''
        }`,
      );
    } catch (cause) {
      fail(cause);
    } finally {
      setSwitchingModel(false);
    }
  };

  /** `closingViewer`: the viewer closes on the way, so the new screen takes its history entry. */
  const navigate = (path: string, closingViewer = false) => {
    if (closingViewer && navigateFromViewer(`#/${path}`)) return;
    location.hash = `/${path}`;
  };
  // Before offline setup, Search shows the download card instead of a global error.
  const waitForSetup = (text: string) => {
    pendingSearch.current = text;
    setResults(null);
    setSearching(false);
  };
  const runSearch = async (
    e?: React.FormEvent,
    override?: { kind?: ItemKind },
    text: string = query,
  ) => {
    e?.preventDefault();
    if (!text.trim()) {
      // A submitted empty search says what to do instead of doing nothing.
      if (e) {
        setSearchHint(true);
        searchInput.current?.focus();
      }
      return;
    }
    setSearchHint(false);
    const generation = ++searchGeneration.current;
    setSearching(true);
    setError('');
    setAnnouncement('');
    setResults(null);
    setSearched(text.trim());
    navigate('search', !!selected);
    setSelected(undefined);
    if (!engine.ready) return waitForSetup(text.trim());
    pendingSearch.current = undefined;
    try {
      const found = await engine.search(text, override ? override.kind : filter);
      if (generation === searchGeneration.current) {
        setResults(found);
        if (found.length) rememberSearch(text.trim());
        const shown = `“${text.trim()}”`;
        setAnnouncement(
          found.length
            ? `${found.length} result${found.length === 1 ? '' : 's'} for ${shown}`
            : `No strong matches for ${shown}`,
        );
      }
    } catch (cause) {
      if (generation !== searchGeneration.current) return;
      if (cause instanceof AppOperationError && cause.detail.code === 'MODEL_NOT_READY') {
        setReady(false);
        waitForSetup(text.trim());
      } else fail(cause, 'search');
    } finally {
      if (generation === searchGeneration.current) setSearching(false);
    }
  };
  // Run the waiting search when setup finishes. The query box still holds what was typed.
  useEffect(() => {
    if (!ready || screen !== 'search' || !pendingSearch.current) return;
    const text = query.trim() || pendingSearch.current;
    pendingSearch.current = undefined;
    void runSearch(undefined, undefined, text);
    // Only a change in readiness or screen should start the waiting search.
  }, [ready, screen]);
  /** Saves the recent list on this device; a failure only means it is not remembered. */
  const storeRecent = (next: string[]) => {
    recent.current = next;
    setRecentSearches(next);
    return services.preferences.set(RECENT_SEARCHES, next).catch(() => {
      /* Not remembered after a reload. */
    });
  };
  const rememberSearch = (text: string) => {
    if (remember.current) void storeRecent(withRecentSearch(recent.current, text));
  };
  const removeRecentSearch = (text: string) =>
    void storeRecent(recent.current.filter((value) => value !== text));
  const clearRecentSearches = () => void storeRecent([]);
  const chooseRememberSearches = (on: boolean) => {
    remember.current = on;
    setRememberSearches(on);
    // Confirmed once this device has the choice, so a reload keeps it.
    void Promise.all([
      services.preferences.set(REMEMBER_RECENT_SEARCHES, on),
      on ? undefined : storeRecent([]),
    ])
      .then(() =>
        notify(
          on
            ? 'Recent searches are on. They stay on this device.'
            : 'Recent searches are off and cleared from this device.',
        ),
      )
      .catch((cause) => fail(cause));
  };
  const chooseFilter = (kind?: ItemKind) => {
    setFilter(kind);
    if (screen === 'search' && searched) void runSearch(undefined, { kind });
  };
  const saved = (savedItems: LibraryItem[], warning?: string) => {
    setFilter(undefined);
    setStatusFilter('');
    // The warning belongs to the Library screen this save opens.
    if (warning) fail(warning, 'library');
    else setError('');
    notify(
      `${savedItems.length === 1 ? 'Saved locally' : `${savedItems.length} items saved locally`}. ${engine.ready ? 'Processing for search.' : 'Set up offline search when you are ready.'}`,
    );
    for (const value of savedItems) void engine.indexItem(value.id);
    navigate('library');
    setSavedThisSession(true);
    // Silent in Chromium; the Settings storage section shows the result.
    void keepLibrary()
      .then((persistent) => {
        if (persistent !== undefined) setStorage((p) => ({ ...p, persistent }));
      })
      .catch(() => {
        /* The browser keeps its own answer; Settings still offers the button. */
      });
  };
  /**
   * One install offer, after a save in this session, never during the welcome dialog or once
   * answered or installed. Only Chromium browsers send the install event.
   */
  const installOffer =
    !!installPrompt && savedThisSession && !installAnswered && !installed && !firstUse;
  const answerInstall = () => {
    setInstallAnswered(true);
    void services.preferences.set(INSTALL_DECLINED, true).catch(() => {
      /* Not remembered; the offer can return in a later session. */
    });
  };
  const install = async () => {
    const event = installPrompt;
    setInstallPrompt(undefined);
    answerInstall();
    if (!event) return;
    try {
      await event.prompt();
      if ((await event.userChoice).outcome === 'accepted') setInstalled(true);
    } catch {
      /* The browser declined to show its install dialog. */
    }
  };
  /** The one setup action. From the Search card a failure stays in the card, not in a global error. */
  const doSetup = async (from?: 'search') => {
    setSetup(true);
    setError('');
    setSetupError('');
    try {
      await engine.setupModels();
      setReady(true);
      notify('Offline search assets verified. Your queued files will now process.');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (from === 'search') setSetupError(message);
      else fail(cause);
    } finally {
      setReady(engine.ready);
      setSetup(false);
    }
  };
  const perform = async (name: string, operation: () => Promise<void>) => {
    setBusy(name);
    setError('');
    try {
      await operation();
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy('');
    }
  };
  const exportAll = () =>
    perform('export', async () => {
      const archives = await exportLibrary(repository, items);
      await downloadParts(archives, `campus-recall-${new Date().toISOString().slice(0, 10)}`);
      notify(backupCreatedMessage(archives.length));
    });
  const action = (value: LibraryItem, name: string) => {
    setMenu(undefined);
    if (name === 'rename') setRename({ id: value.id, title: value.title });
    if (name === 'delete') setDeleting(value);
    if (name === 'retry')
      void perform('retry', async () => {
        await engine.indexItem(value.id);
        notify(
          engine.ready
            ? 'Processing again. The original is unchanged.'
            : 'Queued to process again after offline search is set up.',
        );
      });
    if (name === 'cancel')
      void perform('cancel', async () => {
        await engine.cancelItem(value.id);
        notify('Processing cancelled. The original is still saved.');
      });
  };
  const visible = items.filter(
    (i) => (!filter || i.kind === filter) && (!statusFilter || i.status === statusFilter),
  );
  const readyCount = items.filter((i) => i.status === 'ready').length;
  /** Saved items that cannot be found yet because they are still being prepared. */
  const waitingCount = items.filter(
    (i) => i.status === 'queued' || i.status === 'processing',
  ).length;

  return {
    statusFilter,
    setStatusFilter,
    screen,
    query,
    setQuery: (value: string) => {
      setQuery(value);
      if (value.trim()) setSearchHint(false);
    },
    searchHint,
    recentSearches,
    rememberSearches,
    removeRecentSearch,
    clearRecentSearches,
    chooseRememberSearches,
    waitingCount,
    filter,
    results,
    searching,
    searched,
    selected,
    setSelected,
    toast,
    setToast,
    error: screenError.message,
    errorDetail: screenError.detail,
    setError,
    announcement,
    downloadBytes,
    downloadBytesFor: (model: SearchModel) => engine.downloadBytesFor?.(model) ?? 0,
    searchModel,
    customModel,
    switchingModel,
    switchSearchModel,
    addingModel,
    addModelError,
    addCustomModel,
    canChooseSearchModel: !!engine.setSearchModel && !!engine.addCustomModel,
    ready,
    setupKnown,
    setupError,
    setup,
    progress,
    itemProgress,
    firstUse,
    setFirstUse,
    offline,
    update,
    storage,
    setStorage,
    busy,
    menu,
    setMenu,
    closeMenu,
    installOffer,
    install,
    declineInstall: answerInstall,
    rename,
    setRename,
    deleting,
    setDeleting,
    searchInput,
    restoreInput,
    items,
    item,
    notify,
    runSearch,
    chooseFilter,
    saved,
    doSetup,
    perform,
    exportAll,
    action,
    visible,
    readyCount,
    repository,
    engine,
    services,
  };
}
export type CampusRecallModel = ReturnType<typeof useCampusRecall>;
