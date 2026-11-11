import { lazy, Suspense, useCallback, useEffect, useSyncExternalStore } from 'react';
import { ArrowUpRight, Search, ShieldCheck, WifiOff, X } from 'lucide-react';
import type { AnyRecallServices } from '../app/services';
import { useAnyRecall } from '../app/useAnyRecall';
import { Add } from './Add';
import { Viewer } from './Viewer';
import { Dialogs } from './Dialogs';
import { Landing } from './Landing';
import { LibrarySearchScreen } from './screens/LibrarySearchScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { useModalFocus } from './useModalFocus';
import { useScreenChange } from './useScreenChange';
import { useViewerHistory } from '../app/viewerHistory';
import { getAutoSync } from '../../pilot/client/autosync';
import { CloudViewer } from '../../pilot/ui/CloudViewer';
const Policy = lazy(() => import('./Policy').then((m) => ({ default: m.Policy })));
export function App({ services }: { services: AnyRecallServices }) {
  const model = useAnyRecall(services);
  // Title, focus and scroll position follow the screen (see useScreenChange).
  useScreenChange(model.screen);
  // Pilot Auto-sync runs app-wide once signed in and opted in.
  useEffect(() => {
    void getAutoSync(services).start();
  }, [services]);
  // One viewer at a time: opening a cloud item closes a local one, and the other way round.
  const { selected: openLocal, setSelected: setOpenLocal } = model;
  useEffect(() => {
    const controller = getAutoSync(services);
    const unsubscribe = controller.subscribe(() => {
      if (controller.getView().opened) setOpenLocal(undefined);
    });
    return () => {
      unsubscribe();
    };
  }, [services, setOpenLocal]);
  useEffect(() => {
    if (openLocal) getAutoSync(services).closeViewer();
  }, [openLocal, services]);
  // Back, Escape and the close button close either viewer the same way (see viewerHistory).
  const cloud = getAutoSync(services);
  const cloudOpen = !!useSyncExternalStore(cloud.subscribe, cloud.getView).opened;
  const closeViewers = useCallback(() => {
    setOpenLocal(undefined);
    getAutoSync(services).closeViewer();
  }, [services, setOpenLocal]);
  useViewerHistory(!!openLocal || cloudOpen, closeViewers);
  useEffect(() => {
    if (!cloudOpen) return;
    // The local viewer closes from the app's key handler; the cloud viewer closes here.
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) getAutoSync(services).closeViewer();
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [cloudOpen, services]);
  useModalFocus(model);
  const {
    selected,
    screen,
    items,
    ready,
    offline,
    query,
    setQuery,
    runSearch,
    searchInput,
    searchHint,
    update,
    error,
    errorDetail,
    setError,
    notify,
    repository,
    saved,
    item,
    setSelected,
    toast,
    setToast,
    installOffer,
    install,
    declineInstall,
  } = model;
  if (screen === 'home') return <Landing />;
  // The class drives the visual state; aria-current exposes the same state to assistive technology.
  const current = (id: string) =>
    screen === id
      ? { className: 'current', 'aria-current': 'page' as const }
      : { className: '', 'aria-current': undefined };
  return (
    <div className={`app ${selected ? 'has-preview' : ''}`}>
      <a
        className="skip-link"
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('main')?.focus();
        }}
      >
        Skip to content
      </a>
      <aside className="sidebar">
        <a href="#/library" className="brand" aria-label="AnyRecall home">
          <span className="brand-mark" aria-hidden="true" />
          AnyRecall
        </a>
        <span className="sidebar-label">WORKSPACE</span>
        <nav aria-label="Main navigation">
          <a {...current('library')} href="#/library">
            Library <span className="nav-count">{items.length}</span>
          </a>
          <a {...current('search')} href="#/search">
            Search
          </a>
          <a {...current('add')} href="#/add">
            Add to library
          </a>
        </nav>
        <div className="sidebar-bottom">
          <div className="local-card">
            <span className="local-dot" />
            <span>
              On this device<strong>{ready ? 'Offline assets ready' : 'Local library'}</strong>
            </span>
          </div>
          <a
            className={`settings-link ${screen === 'settings' ? 'current' : ''}`}
            aria-current={screen === 'settings' ? 'page' : undefined}
            href="#/settings"
          >
            Settings
          </a>
          <a className="sidebar-foot" href="#/">
            About AnyRecall
          </a>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <a className="mobile-brand" href="#/library">
            AnyRecall
          </a>
          <form className="searchbox" onSubmit={runSearch} role="search">
            <Search size={19} />
            <input
              ref={searchInput}
              aria-label="Search saved information"
              placeholder="Describe what you remember…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              maxLength={1000}
              aria-describedby={searchHint ? 'search-hint' : undefined}
            />
            <button type="submit" className="search-submit" aria-label="Search">
              <ArrowUpRight size={18} />
            </button>
            <kbd>{/Mac/.test(navigator.userAgent) ? '⌘ K' : 'Ctrl K'}</kbd>
            {/* Always present, so the hint is announced when it appears. */}
            <p id="search-hint" className="search-hint" aria-live="polite">
              {searchHint ? 'Type what you remember, then search.' : ''}
            </p>
          </form>
          <span className="local-indicator">
            {offline ? <WifiOff size={15} /> : <ShieldCheck size={15} />}{' '}
            {offline ? 'Offline' : 'Stored on this device'}
          </span>
        </header>
        <main className="main-content" id="main" tabIndex={-1}>
          {update && (
            <div className="notice">
              An app update is available. Finish current processing and back up your library before
              reloading.
              <button
                className="text-button"
                onClick={() => {
                  update.waiting?.postMessage({ type: 'SKIP_WAITING' });
                  navigator.serviceWorker.addEventListener(
                    'controllerchange',
                    () => location.reload(),
                    { once: true },
                  );
                }}
              >
                Reload update
              </button>
            </div>
          )}
          {error && (
            <div className="notice error" role="alert">
              <span>
                {error}
                {errorDetail && (
                  <details className="error-detail">
                    <summary>Show details</summary>
                    <code>{errorDetail}</code>
                  </details>
                )}
              </span>
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setError('')}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {/* One offer, never beside another notice; on Library it takes the setup banner's place. */}
          {installOffer && !update && !error && screen === 'library' && (
            <div className="notice install-offer">
              <span>Install AnyRecall for quick access and so your library is kept</span>
              <span className="button-row">
                <button className="button secondary" onClick={() => void install()}>
                  Install
                </button>
                <button className="text-button" onClick={declineInstall}>
                  Not now
                </button>
              </span>
            </div>
          )}
          {(screen === 'library' || screen === 'search') && <LibrarySearchScreen model={model} />}
          {screen === 'add' && (
            <Add repository={repository} capture={services.capture} onSaved={saved} />
          )}
          {screen === 'settings' && <SettingsScreen model={model} />}
          {(screen === 'privacy' || screen === 'terms') && (
            <Suspense fallback={<p>Opening document…</p>}>
              <Policy kind={screen} />
            </Suspense>
          )}
          {!['library', 'search', 'add', 'settings', 'privacy', 'terms'].includes(screen) && (
            <div className="empty-state">
              <h1 tabIndex={-1}>Page not found</h1>
              <a href="#/library">Return to your library</a>
            </div>
          )}
        </main>
      </div>
      {item && selected ? (
        <div className="preview-panel">
          <Viewer
            key={item.id}
            item={item}
            location={selected.location}
            repository={repository}
            onClose={() => setSelected(undefined)}
            onNotify={notify}
          />
        </div>
      ) : (
        <CloudViewer services={services} notify={notify} />
      )}
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {[
          ['library', 'Library'],
          ['search', 'Search'],
          ['add', 'Add'],
          ['settings', 'Settings'],
        ].map(([id, label]) => (
          <a key={id} {...current(id)} href={`#/${id}`}>
            {label}
          </a>
        ))}
      </nav>
      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setToast('')}
          >
            <X size={16} />
          </button>
        </div>
      )}
      <Dialogs model={model} />
    </div>
  );
}
