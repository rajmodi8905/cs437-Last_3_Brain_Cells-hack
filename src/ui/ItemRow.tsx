import { useEffect, useLayoutEffect, useRef } from 'react';
import { ArrowUpRight, MoreHorizontal } from 'lucide-react';
import type { LibraryItem, SearchResult, SourceLocation } from '../shared';
import type { CampusRecallModel } from '../app/useCampusRecall';
import { kindCodes, kindLabels } from './presentation';
import { bytes, humanDate, time } from './hooks';
import { enterViewer } from '../app/viewerHistory';
import { plainMessage } from '../app/plainError';
const PROCESSING_FAILED = 'Processing failed. The original is still saved.';
const locationLabel = (source?: SourceLocation) =>
  source?.kind === 'page'
    ? `Page ${source.page}`
    : source?.kind === 'time'
      ? `${time(source.startMs)} to ${time(source.endMs)}`
      : 'Whole item';

/**
 * The open item menu stays where it can be tapped, above the phone's bottom bar and any
 * notification, and closes on a tap outside it. Escape is handled with the app's other keys.
 * When it closes with focus inside it, focus goes back to its button.
 */
function useItemMenu(
  open: boolean,
  box: React.RefObject<HTMLDivElement | null>,
  close: () => void,
) {
  useLayoutEffect(() => {
    const menu = box.current?.querySelector<HTMLElement>('.dropdown');
    const trigger = box.current?.querySelector<HTMLElement>('.more');
    if (!open || !menu || !trigger) return;
    const covers = ['.mobile-nav', '.toast']
      .map((selector) => document.querySelector(selector)?.getBoundingClientRect())
      .filter((rect) => rect && rect.height > 0 && rect.top < innerHeight) as DOMRect[];
    const limit = Math.min(innerHeight, ...covers.map((rect) => rect.top)) - 8;
    const rect = menu.getBoundingClientRect();
    if (rect.bottom <= limit) return;
    if (trigger.getBoundingClientRect().top - rect.height - 8 > 0) menu.dataset.side = 'up';
    else window.scrollBy(0, rect.bottom - limit);
  }, [open, box]);
  useEffect(() => {
    const element = box.current;
    if (!open || !element) return;
    // Added after the opening tap has finished, so that tap cannot close the menu again.
    const outside = (event: PointerEvent) => {
      if (!element.contains(event.target as Node)) close();
    };
    document.addEventListener('pointerdown', outside, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      const active = document.activeElement;
      if (document.querySelector('.modal')) return;
      if (!active || active === document.body || element.contains(active))
        element.querySelector<HTMLElement>('.more')?.focus();
    };
  }, [open, box, close]);
}

export function ItemRow({
  value,
  result,
  model,
}: {
  value: LibraryItem;
  result?: SearchResult;
  model: CampusRecallModel;
}) {
  const {
    itemProgress,
    selected,
    setSelected,
    menu,
    setMenu,
    closeMenu,
    action,
    ready,
    setupKnown,
  } = model;
  const event = itemProgress[value.id];
  const menuBox = useRef<HTMLDivElement>(null);
  useItemMenu(menu === value.id, menuBox, closeMenu);
  return (
    <article
      data-item-id={value.id}
      key={value.id}
      className={`item-row ${selected?.id === value.id ? 'active' : ''}`}
    >
      <button
        className="item-open"
        onClick={() => {
          // In the opening tap, so Back can close the viewer (see viewerHistory).
          enterViewer();
          setSelected({ id: value.id, location: result?.location });
        }}
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
      <div className="item-menu" ref={menuBox}>
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
          {value.error?.message
            ? plainMessage(value.error.message, PROCESSING_FAILED)
            : PROCESSING_FAILED}
        </p>
      )}
      {value.status === 'queued' && !result && setupKnown && !ready && (
        <p className="row-message muted">Waiting for search setup.</p>
      )}
      {value.status === 'processing' && event?.message && (
        <p className="row-message">{event.message}</p>
      )}
    </article>
  );
}
