import type { EngineProgress } from '../shared';
import { bytes } from './hooks';

/** A download size in whole megabytes, such as "445 MB". Small sizes keep the KB format. */
export const downloadSize = (value: number) =>
  value < 1e6 ? bytes(value) : `${Math.round(value / 1e6)} MB`;

/** Downloaded and total size, such as "212 of 445 MB". */
export function sizeProgress(loaded: number, total: number) {
  if (total < 1e6) return `${bytes(loaded)} of ${bytes(total)}`;
  return `${Math.min(Math.floor(loaded / 1e6), Math.round(total / 1e6))} of ${downloadSize(total)}`;
}

/** Bytes still to download after a stopped setup, or 0 when nothing was downloaded yet. */
export function remainingBytes(progress?: EngineProgress) {
  if (progress?.stage !== 'setup' || !progress.totalBytes || !progress.loadedBytes) return 0;
  return Math.max(0, progress.totalBytes - progress.loadedBytes);
}

/**
 * Plain setup progress for Settings and the Search card. It shows real downloaded bytes and
 * never the internal file names. Before the first bytes and after the last, setup is checking
 * files, so it says so instead of showing a moving size.
 */
export function SetupProgress({
  progress,
  setup,
  ready,
}: {
  progress?: EngineProgress;
  setup: boolean;
  ready: boolean;
}) {
  const event = progress?.stage === 'setup' ? progress : undefined;
  const loaded = event?.loadedBytes ?? 0;
  const total = event?.totalBytes ?? 0;
  const checking = setup && (!total || loaded >= total);
  const label = setup
    ? checking
      ? 'Getting search ready…'
      : `Downloading search · ${sizeProgress(loaded, total)}`
    : ready
      ? 'Download complete and checked.'
      : `Download stopped at ${sizeProgress(loaded, total)}. Retry to continue.`;
  return (
    <div className="setup-progress">
      <div>
        <span>{label}</span>
      </div>
      <progress aria-label="Offline setup download" value={loaded} max={total || 1} />
    </div>
  );
}
