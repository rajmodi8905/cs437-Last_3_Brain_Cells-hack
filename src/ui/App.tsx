import { lazy, Suspense } from 'react';
import {
  ArrowUpRight,
  CheckCircle2,
  HardDrive,
  Library,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  WifiOff,
  X,
} from 'lucide-react';
import type { CampusRecallServices } from '../app/services';
import { useCampusRecall } from '../app/useCampusRecall';
import { Add } from './Add';
import { Viewer } from './Viewer';
import { Dialogs } from './Dialogs';
import { LibrarySearchScreen } from './screens/LibrarySearchScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { useModalFocus } from './useModalFocus';
const Policy = lazy(() => import('./Policy').then((m) => ({ default: m.Policy })));
export function App({ services }: { services: CampusRecallServices }) {
  const model = useCampusRecall(services);
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
    update,
    error,
    setError,
    repository,
    saved,
    item,
    setSelected,
    toast,
    setToast,
  } = model;
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
        <a href="#/library" className="brand" aria-label="Campus Recall home">
          <span className="brand-icon">
            <Library size={22} />
          </span>
          <span>
            Campus
            <br />
            <strong>Recall</strong>
          </span>
        </a>
        <span className="sidebar-label">WORKSPACE</span>
        <nav aria-label="Main navigation">
          <a className={screen === 'library' ? 'current' : ''} href="#/library">
            <Library size={18} /> Library <span className="nav-count">{items.length}</span>
          </a>
          <a className={screen === 'search' ? 'current' : ''} href="#/search">
            <Search size={18} /> Search
          </a>
          <a className={screen === 'add' ? 'current' : ''} href="#/add">
            <Plus size={18} /> Add to library
          </a>
        </nav>
        <div className="sidebar-bottom">
          <div className="local-card">
            <span className="local-dot" />
            <span>
              On this device<strong>{ready ? 'Offline assets ready' : 'Local library'}</strong>
            </span>
            <HardDrive size={17} />
          </div>
          <a
            className={`settings-link ${screen === 'settings' ? 'current' : ''}`}
            href="#/settings"
          >
            <Settings size={18} /> Settings
          </a>
          <span className="sidebar-foot">Campus Recall · Student project</span>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <a className="mobile-brand" href="#/library">
            <Library size={20} /> Campus Recall
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
            />
            <button type="submit" className="search-submit" aria-label="Search">
              <ArrowUpRight size={18} />
            </button>
            <kbd>{/Mac/.test(navigator.userAgent) ? '⌘ K' : 'Ctrl K'}</kbd>
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
              <span>{error}</span>
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setError('')}
              >
                <X size={16} />
              </button>
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
              <h1>Page not found</h1>
              <a href="#/library">Return to your library</a>
            </div>
          )}
        </main>
      </div>
      {item && selected && (
        <div className="preview-panel">
          <Viewer
            key={item.id}
            item={item}
            location={selected.location}
            repository={repository}
            onClose={() => setSelected(undefined)}
          />
        </div>
      )}
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {[
          ['library', 'Library', Library],
          ['search', 'Search', Search],
          ['add', 'Add', Plus],
          ['settings', 'Settings', Settings],
        ].map(([id, label, Icon]: any) => (
          <a key={id} className={screen === id ? 'current' : ''} href={`#/${id}`}>
            <Icon size={20} />
            <span>{label}</span>
          </a>
        ))}
      </nav>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={19} />
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
