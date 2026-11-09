import { LoaderCircle } from 'lucide-react';
import type { CampusRecallModel } from '../app/useCampusRecall';
import { SetupProgress, downloadSize, remainingBytes } from './SetupProgress';
import { isIosBrowserTab } from '../app/phone';

/**
 * Shown on Search, in place of results, while offline search is not set up. It asks for the
 * one-time download at the moment of need and starts the same setup as Settings. Spec S7: the
 * download starts only when the button is pressed.
 */
export function SearchSetupCard({ model }: { model: CampusRecallModel }) {
  const { downloadBytes, progress, setup, ready, setupError, doSetup, searched, offline } = model;
  const size = downloadBytes ? downloadSize(downloadBytes) : '';
  const left = setup ? 0 : remainingBytes(progress);
  const label = setup
    ? 'Downloading…'
    : left
      ? `Resume download (${downloadSize(left)} left)`
      : setupError
        ? 'Try again'
        : size
          ? `Download search (${size})`
          : 'Download search';
  return (
    <section className="setup-card" aria-labelledby="search-setup-title">
      <span className="eyebrow">ONE-TIME SETUP</span>
      <h2 id="search-setup-title">Search needs a one-time download</h2>
      <p>
        Search uses models that run on this device. Download them once
        {size ? ` (${size})` : ''}, then search works here, even offline. Campus Wi-Fi is best for a
        download this size.
      </p>
      {searched && (
        <p className="small">Your search for “{searched}” will run when the download finishes.</p>
      )}
      {(setup || left > 0) && <SetupProgress progress={progress} setup={setup} ready={ready} />}
      <div aria-live="polite">
        {setupError && !setup && (
          <p className="error-text">
            The download stopped before it finished. Check your connection and try again. What
            already finished is kept.
          </p>
        )}
        {offline && !setup && <p className="small">You are offline. Connect to download.</p>}
      </div>
      {/* Home Screen storage is separate from Safari's, so the download belongs in the Home Screen app. */}
      {isIosBrowserTab() && (
        <p className="setup-tip">
          On iPhone, add Campus Recall to your Home Screen first (Share › Add to Home Screen).
          Safari can clear website data after 7 days without use; the Home Screen app keeps it.
        </p>
      )}
      <button className="button primary" disabled={setup} onClick={() => void doSetup('search')}>
        {setup && <LoaderCircle size={16} className="spin" />} {label}
      </button>
      <p className="small muted">
        Keep the app open while it downloads. If it stops, you can resume later.
      </p>
    </section>
  );
}
