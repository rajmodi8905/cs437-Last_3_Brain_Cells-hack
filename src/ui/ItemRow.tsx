import { ArrowUpRight, MoreHorizontal } from 'lucide-react';
import type { LibraryItem, SearchResult, SourceLocation } from '../shared';
import type { CampusRecallModel } from '../app/useCampusRecall';
import { kindCodes, kindLabels } from './presentation';
import { bytes, humanDate, time } from './hooks';
const locationLabel = (source?: SourceLocation) =>
  source?.kind === 'page'
    ? `Page ${source.page}`
    : source?.kind === 'time'
      ? `${time(source.startMs)} to ${time(source.endMs)}`
      : 'Whole item';

export function ItemRow({
  value,
  result,
  model,
}: {
  value: LibraryItem;
  result?: SearchResult;
  model: CampusRecallModel;
}) {
  const { itemProgress, selected, setSelected, menu, setMenu, action } = model;
  const event = itemProgress[value.id];
  return (
    <article
      data-item-id={value.id}
      key={value.id}
      className={`item-row ${selected?.id === value.id ? 'active' : ''}`}
    >
      <button
        className="item-open"
        onClick={() => setSelected({ id: value.id, location: result?.location })}
      >
        <span className={`file-icon ${value.kind}`} aria-hidden="true">
          {kindCodes[value.kind]}
        </span>
        <span className="item-copy">
          <span className="item-title">{value.title}</span>
          {result ? (
            <>
              <span className="result-excerpt">
                {result.excerpt ?? 'Visual match from your saved original'}
              </span>
              <span className="item-meta">
                <strong className="loc">{locationLabel(result.location)}</strong>
                {' · '}
                {result.matchKind === 'visual' ? 'Visual content' : 'Extracted content'}
              </span>
            </>
          ) : (
            <span className="item-meta">
              {kindLabels[value.kind]} · {bytes(value.byteLength)} · {humanDate(value.createdAt)}
            </span>
          )}
        </span>
        <span className="row-tail">
          {!result && (
            <span className={`status ${value.status}`}>
              {value.status === 'queued'
                ? 'Queued'
                : value.status === 'processing'
                  ? 'Processing'
                  : value.status === 'failed'
                    ? 'Needs attention'
                    : 'Ready'}
            </span>
          )}
          <ArrowUpRight className="open-arrow" size={17} />
        </span>
      </button>
      <div className="item-menu">
        <button
          className="icon-button more"
          aria-label={`Actions for ${value.title}`}
          aria-expanded={menu === value.id}
          onClick={() => setMenu(menu === value.id ? undefined : value.id)}
        >
          <MoreHorizontal size={19} />
        </button>
        {menu === value.id && (
          <div className="dropdown">
            {[
              'rename',
              ...(value.status === 'failed' ? ['retry'] : []),
              ...(value.status === 'processing' || value.status === 'queued' ? ['cancel'] : []),
              'delete',
            ].map((name) => (
              <button key={name} onClick={() => action(value, name)}>
                {name === 'retry'
                  ? 'Retry processing'
                  : name === 'cancel'
                    ? 'Cancel processing'
                    : name.charAt(0).toUpperCase() + name.slice(1)}
              </button>
            ))}
          </div>
        )}
      </div>
      {value.status === 'failed' && (
        <p className="row-message error-text">
          {value.error?.message ?? 'Processing failed. The original is still saved.'}
        </p>
      )}
      {value.status === 'processing' && event?.message && (
        <p className="row-message">{event.message}</p>
      )}
    </article>
  );
}
