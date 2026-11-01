import { useEffect, useRef, useState } from 'react';
import type {
  EngineProgress,
  ItemKind,
  LibraryItem,
  SearchResult,
  SourceLocation,
} from '../shared';
import type { CampusRecallServices } from './services';
import { useLibraryItems } from './useLibraryItems';
import { downloadBlob } from './download';
const route = () => window.location.hash.slice(2).split('?')[0] || 'home';
export function useCampusRecall(services: CampusRecallServices) {
  const { library: repository, engine } = services;
  const [statusFilter, setStatusFilter] = useState('');
  const [screen, setScreen] = useState(route);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ItemKind>();
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState('');
  const [selected, setSelected] = useState<{ id: string; location?: SourceLocation }>();
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const [downloadBytes, setDownloadBytes] = useState(0);
  const [ready, setReady] = useState(false);
  const [setup, setSetup] = useState(false);
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
  const [rename, setRename] = useState<{ id: string; title: string }>();
  const [deleting, setDeleting] = useState<LibraryItem>();
  const searchInput = useRef<HTMLInputElement>(null);
  const restoreInput = useRef<HTMLInputElement>(null);
  const searchGeneration = useRef(0);
  const { items, error: libraryError } = useLibraryItems(services);
  useEffect(() => {
    if (libraryError) setError(libraryError);
  }, [libraryError]);
  const item = items.find((i) => i.id === selected?.id);
  useEffect(() => {
    const handle = () => {
      setScreen(route());
      setMenu(undefined);
    };
    window.addEventListener('hashchange', handle);
    return () => window.removeEventListener('hashchange', handle);
  }, []);
  useEffect(() => {
    let alive = true;
    const unsubscribe = engine.subscribeProgress((event) => {
      if (!alive) return;
      if (event.itemId) setItemProgress((p) => ({ ...p, [event.itemId!]: event }));
      else setProgress(event);
    });
    void services
      .initialize()
      .then(async () => {
        const setting = await services.preferences.get<boolean>('intro-seen');
        if (alive) setFirstUse(!setting);
        if (alive) {
          setReady(engine.ready);
          setDownloadBytes(engine.downloadBytes);
        }
      })
      .catch((cause) => {
        if (alive) setError(cause.message);
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
        setSelected(undefined);
        setMenu(undefined);
      }
    };
    window.addEventListener('keydown', keyboard);
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
  const navigate = (path: string) => {
    location.hash = `/${path}`;
  };
  const runSearch = async (e?: React.FormEvent, override?: { kind?: ItemKind }) => {
    e?.preventDefault();
    if (!query.trim()) return;
    const generation = ++searchGeneration.current;
    setSearching(true);
    setError('');
    setResults(null);
    setSearched(query.trim());
    setSelected(undefined);
    navigate('search');
    try {
      const found = await engine.search(query, override ? override.kind : filter);
      if (generation === searchGeneration.current) setResults(found);
    } catch (cause) {
      if (generation === searchGeneration.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (generation === searchGeneration.current) setSearching(false);
    }
  };
  const chooseFilter = (kind?: ItemKind) => {
    setFilter(kind);
    if (screen === 'search' && searched) void runSearch(undefined, { kind });
  };
  const saved = (savedItems: LibraryItem[], warning?: string) => {
    setFilter(undefined);
    setStatusFilter('');
    setError(warning ?? '');
    notify(
      `${savedItems.length === 1 ? 'Saved locally' : `${savedItems.length} items saved locally`}. ${engine.ready ? 'Processing for search.' : 'Set up offline search when you are ready.'}`,
    );
    for (const value of savedItems) void engine.indexItem(value.id);
    navigate('library');
  };
  const doSetup = async () => {
    setSetup(true);
    setError('');
    try {
      await engine.setupModels();
      setReady(true);
      notify('Offline search assets verified. Your queued files will now process.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
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
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy('');
    }
  };
  const exportAll = () =>
    perform('export', async () => {
      downloadBlob(
        await repository.exportItems(items.map((i) => i.id)),
        `campus-recall-${new Date().toISOString().slice(0, 10)}.zip`,
      );
      notify('Backup created. Keep this unencrypted ZIP somewhere private.');
    });
  const action = (value: LibraryItem, name: string) => {
    setMenu(undefined);
    if (name === 'rename') setRename({ id: value.id, title: value.title });
    if (name === 'delete') setDeleting(value);
    if (name === 'retry') void perform('retry', () => engine.indexItem(value.id));
    if (name === 'cancel') void perform('cancel', () => engine.cancelItem(value.id));
  };
  const visible = items.filter(
    (i) => (!filter || i.kind === filter) && (!statusFilter || i.status === statusFilter),
  );
  const readyCount = items.filter((i) => i.status === 'ready').length;

  return {
    statusFilter,
    setStatusFilter,
    screen,
    query,
    setQuery,
    filter,
    results,
    searching,
    searched,
    selected,
    setSelected,
    toast,
    setToast,
    error,
    setError,
    downloadBytes,
    ready,
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
