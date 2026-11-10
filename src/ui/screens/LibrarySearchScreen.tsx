import { ArrowUpRight, ChevronRight, GraduationCap, LoaderCircle, X } from 'lucide-react';
import type { CampusRecallModel } from '../../app/useCampusRecall';
import { useCampusPack } from '../../app/useCampusPack';
import { kinds, kindLabels } from '../presentation';
import { ItemRow } from '../ItemRow';
import { CloudResultRow } from '../../../pilot/ui/CloudResultRow';
import { SearchSetupCard } from '../SearchSetupCard';
export function LibrarySearchScreen({ model }: { model: CampusRecallModel }) {
  const {
    screen,
    ready,
    setupKnown,
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
    announcement,
    query,
    waitingCount,
    recentSearches,
  } = model;
  // Clearing the search box goes back to the start of Search, with the recent searches.
  const showResults = results !== null && !!query.trim();
  const runRecent = (text: string) => {
    model.setQuery(text);
    void model.runSearch(undefined, undefined, text);
  };
  // App shows the install offer here instead of this banner, so the two never stack.
  const offering = model.installOffer && !model.update && !model.error;
  const pack = useCampusPack(model);
  const packButton = (
    <button className="button secondary" onClick={pack.add} disabled={pack.adding}>
      {pack.adding ? <LoaderCircle size={17} className="spin" /> : <GraduationCap size={17} />} Add
      the IITGN campus pack
    </button>
  );
  const packAbout =
    'Contacts, hostels, rooms, 2026-27 exam dates and links, checked on official IITGN pages. Saved on this device like your own notes.';
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            {screen === 'search' ? 'FIND IT AGAIN' : 'YOUR PERSONAL LIBRARY'}
          </span>
          <h1 tabIndex={-1}>
            {screen === 'search' ? 'Find your saved information' : 'Your library'}
          </h1>
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
      {/* On Search the download card below replaces this banner. */}
      {!ready && setupKnown && screen !== 'search' && !offering && (
        <div className="setup-banner">
          <div>
            <strong>Processing and search run on this device.</strong>
            <p>Set up the local models once to search by meaning, images and speech.</p>
          </div>
          <a href="#/search" className="text-link">
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
              {pack.offered && !filter && !statusFilter && (
                <div className="campus-pack-empty">
                  {packButton}
                  <span className="small muted">{packAbout}</span>
                </div>
              )}
              <span className="small muted">
                Local only needs no account. Auto-sync is optional.
              </span>
            </div>
          )}
          {visible.length > 0 && pack.offered && (
            <div className="campus-pack-offer">
              <div>
                <strong>New at IITGN?</strong>
                <p>{packAbout}</p>
              </div>
              {packButton}
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
          {/* Announces the result count when a search finishes, without moving focus. */}
          <p className="sr-only" role="status">
            {announcement}
          </p>
          {!ready && setupKnown ? (
            <SearchSetupCard model={model} />
          ) : searching ? (
            <div className="empty-state" aria-live="polite">
              <LoaderCircle size={28} className="spin" />
              <h2>Searching on this device…</h2>
              <p>The first search may take longer while the model loads.</p>
            </div>
          ) : showResults && results ? (
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
                    if (found)
                      return <ItemRow key={found.id} value={found} result={result} model={model} />;
                    // Pilot: items saved on another device, found through their synced index.
                    return result.itemId.startsWith('cloud:') ? (
                      <CloudResultRow
                        key={result.segmentId}
                        result={result}
                        services={model.services}
                        notify={model.notify}
                      />
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
                  <ul className="next-steps">
                    <li>
                      Try fewer or different words, such as a course code or a phrase you remember.
                    </li>
                    {waitingCount > 0 && (
                      <li>
                        {waitingCount === 1
                          ? '1 item is still getting ready and is not searchable yet.'
                          : `${waitingCount} items are still getting ready and are not searchable yet.`}
                      </li>
                    )}
                  </ul>
                  <div className="button-row">
                    {filter && (
                      <button className="button secondary" onClick={() => chooseFilter(undefined)}>
                        Search all types
                      </button>
                    )}
                    <a href="#/library" className="button secondary">
                      Browse your library
                    </a>
                  </div>
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
              {recentSearches.length > 0 && (
                <div className="recent-searches">
                  <h3 id="recent-searches-title">Recent searches</h3>
                  <ul aria-labelledby="recent-searches-title">
                    {recentSearches.map((text) => (
                      <li key={text}>
                        <button className="recent-run" onClick={() => runRecent(text)}>
                          {text}
                        </button>
                        <button
                          className="icon-button"
                          aria-label={`Remove “${text}” from recent searches`}
                          onClick={() => model.removeRecentSearch(text)}
                        >
                          <X size={16} />
                        </button>
                      </li>
                    ))}
                  </ul>
                  <button className="text-button" onClick={model.clearRecentSearches}>
                    Clear recent searches
                  </button>
                  <span className="small muted">Kept on this device only.</span>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </>
  );
}
