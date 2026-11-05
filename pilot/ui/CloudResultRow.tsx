import { useState, useSyncExternalStore } from 'react';
import type { CampusRecallServices } from '../../src/app/services';
import { downloadBlob } from '../../src/app/download';
import type { SearchResult } from '../../src/shared';
import { time } from '../../src/ui/hooks';
import { getAutoSync } from '../client/autosync';

const locationLabel = (result: SearchResult) =>
  result.location.kind === 'page'
    ? `Page ${result.location.page}`
    : result.location.kind === 'time'
      ? `${time(result.location.startMs)} to ${time(result.location.endMs)}`
      : 'Whole item';

/** A search result from another device's item, found through its synced index. */
export function CloudResultRow({
  result,
  services,
}: {
  result: SearchResult;
  services: CampusRecallServices;
}) {
  const controller = getAutoSync(services);
  const view = useSyncExternalStore(controller.subscribe, controller.getView);
  const [error, setError] = useState('');
  const globalId = result.itemId.slice('cloud:'.length);
  const item = view.cloudOnly.find((candidate) => candidate.globalId === globalId);
  if (!item) return null;
  return (
    <article className="item-row" data-cloud-item-id={globalId}>
      <div className="item-open">
        <span className={`file-icon ${item.kind}`} aria-hidden="true">
          Cloud
        </span>
        <span className="item-copy">
          <span className="item-title">{item.title}</span>
          {result.excerpt && <span className="result-excerpt">{result.excerpt}</span>}
          <span className="item-meta">
            <strong className="loc">{locationLabel(result)}</strong> · In your cloud library
          </span>
        </span>
        <button
          className="button secondary"
          aria-label={`Download ${item.title}`}
          onClick={async () => {
            setError('');
            try {
              const { blob, name } = await controller.download(globalId);
              downloadBlob(blob, name);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : String(cause));
            }
          }}
        >
          Download
        </button>
      </div>
      {error && (
        <p className="row-message error-text" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}
