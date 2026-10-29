import { ArrowUpRight, ChevronRight, LoaderCircle } from 'lucide-react';
import type { CampusRecallModel } from '../../app/useCampusRecall';
import { kinds, kindLabels } from '../presentation';
import { ItemRow } from '../ItemRow';
export function LibrarySearchScreen({ model }: { model: CampusRecallModel }) {
  const {
    screen,
    ready,
    filter,
    chooseFilter,
    visible,
    statusFilter,
    setStatusFilter,
    searching,
    results,
    searched,
    items,
    searchInput,
    readyCount,
  } = model;
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            {screen === 'search' ? 'FIND IT AGAIN' : 'YOUR PERSONAL LIBRARY'}
          </span>
          <h1>{screen === 'search' ? 'Find your saved information' : 'Your library'}</h1>
          <p>
            {screen === 'search'
              ? 'Use a detail, a topic or a description. Open the source to check.'
              : items.length
                ? `${items.length} saved, ${readyCount} ready to search.`
                : 'Nothing saved yet.'}
          </p>
        </div>
        <a href="#/add" className="button primary">
          Save something
        </a>
      </div>
      {!ready && (
        <div className="setup-banner">
          <div>
            <strong>Your files stay here. Search runs here, too.</strong>
            <p>Set up the local models once to search by meaning, images and speech.</p>
          </div>
          <a href="#/settings" className="text-link">
            Set up offline search <ChevronRight size={16} />
          </a>
        </div>
      )}
      <div className="library-toolbar">
        <div className="type-filters" role="group" aria-label="Filter by file type">
          <button
            className={!filter ? 'selected' : ''}
            aria-pressed={!filter}
            onClick={() => chooseFilter(undefined)}
          >
            All files <span className="count">{items.length}</span>
          </button>
          {kinds.map((kind) => (
            <button
              key={kind}
              className={filter === kind ? 'selected' : ''}
              aria-pressed={filter === kind}
              onClick={() => chooseFilter(kind)}
            >
              {kindLabels[kind]}{' '}
              <span className="count">{items.filter((i) => i.kind === kind).length}</span>
            </button>
          ))}
        </div>
      </div>
      {screen === 'library' ? (
        <>
          <div className="list-heading">
            <h2>
              Recent saves <span>{visible.length}</span>
            </h2>
            <label className="status-filter">
              <span className="sr-only">Filter processing status</span>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">All statuses</option>
                <option value="ready">Ready</option>
                <option value="queued">Queued</option>
                <option value="processing">Processing</option>
                <option value="failed">Needs attention</option>
              </select>
            </label>
          </div>
          {visible.length ? (
            <div className="item-list">
              {visible.map((value) => (
                <ItemRow key={value.id} value={value} model={model} />
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <h2>
                {filter || statusFilter ? 'No items match these filters.' : 'No saved items yet.'}
              </h2>
              <p>
                {filter || statusFilter
                  ? 'Choose another filter or save something new.'
                  : 'Save a screenshot, a document or a note. Come back whenever you need it.'}
              </p>
              <a className="button primary" href="#/add">
                Add your first item
              </a>
              <span className="small muted">No account. A separate library on each device.</span>
            </div>
          )}
          <div className="library-footer">
            <span>Originals are stored in this browser. Keep a backup of anything important.</span>
            <a href="#/settings">
              Backup settings <ArrowUpRight size={13} />
            </a>
          </div>
        </>
      ) : (
        <>
          {searching ? (
            <div className="empty-state" aria-live="polite">
              <LoaderCircle size={28} className="spin" />
              <h2>Searching on this device…</h2>
              <p>The first search may take longer while the model loads.</p>
            </div>
          ) : results !== null ? (
            <>
              <div className="list-heading">
                <h2>
                  {results.length ? 'Relevant originals' : 'No strong matches'}{' '}
                  <span>{results.length}</span>
                </h2>
                <span className="small muted">For “{searched}”</span>
              </div>
              {results.length ? (
                <div className="item-list">
                  {results.map((result) => {
                    const found = items.find((i) => i.id === result.itemId);
                    return found ? (
                      <ItemRow key={found.id} value={found} result={result} model={model} />
                    ) : null;
                  })}
                </div>
              ) : (
                <div className="empty-state">
                  <h2>Try another detail.</h2>
                  <p>
                    Nothing matched strongly enough. Try another description or check Recent saves.
                    This does not mean you never saved it.
                  </p>
                  <a href="#/library" className="button secondary">
                    Browse your library
                  </a>
                </div>
              )}
              <p className="search-note">
                Results point to saved originals. Extracted text and speech may contain errors.
              </p>
            </>
          ) : (
            <div className="empty-state">
              <h2>Remember the idea, not the filename.</h2>
              <p>Try a course instruction, a poster detail or something said in a recording.</p>
              <button className="button secondary" onClick={() => searchInput.current?.focus()}>
                Start a search
              </button>
              <span className="small muted">
                {readyCount} of {items.length} saved items ready to search
              </span>
            </div>
          )}
        </>
      )}
    </>
  );
}
