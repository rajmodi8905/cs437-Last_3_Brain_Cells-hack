import { ArrowUpRight, ChevronRight, LoaderCircle } from 'lucide-react';
import type { CampusRecallModel } from '../../app/useCampusRecall';
import { bytes } from '../hooks';
export function SettingsScreen({ model }: { model: CampusRecallModel }) {
  const {
    ready,
    downloadBytes,
    progress,
    setup,
    doSetup,
    items,
    storage,
    perform,
    setStorage,
    notify,
    busy,
    exportAll,
    restoreInput,
    repository,
    engine,
  } = model;
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">THIS DEVICE</span>
          <h1>Settings</h1>
          <p>Manage offline search, storage and your backups.</p>
        </div>
      </div>
      <div className="settings-grid">
        <section className="surface settings-section">
          <div className="section-title">
            <div>
              <h2>Offline search</h2>
              <p>Download once. Process and search locally.</p>
            </div>
            <span className={`status ${ready ? 'ready' : 'queued'}`}>
              {ready ? 'Assets verified' : 'Setup needed'}
            </span>
          </div>
          <p>
            Text and vision embeddings, English speech, OCR and media tools.{' '}
            {downloadBytes ? `${bytes(downloadBytes)} of assets.` : 'Asset size is loading.'} Model
            inference uses this device, without API keys or content uploads.
          </p>
          {progress?.stage === 'setup' && (
            <div className="setup-progress">
              <div>
                <span>
                  {setup
                    ? progress.message
                    : ready
                      ? 'All required assets verified'
                      : 'Setup interrupted. Retry to resume.'}
                </span>
                <span>
                  {bytes(progress.loadedBytes ?? 0)} / {bytes(progress.totalBytes ?? 0)}
                </span>
              </div>
              <progress
                aria-label="Offline setup download"
                value={progress.loadedBytes ?? 0}
                max={progress.totalBytes ?? 1}
              />
            </div>
          )}
          <button className="button primary" disabled={setup} onClick={() => void doSetup()}>
            {setup && <LoaderCircle size={16} className="spin" />}{' '}
            {setup
              ? 'Downloading and verifying…'
              : ready
                ? 'Verify offline assets'
                : 'Download offline search'}
          </button>
          <p className="field-help">
            Keep the app open while processing. Unfinished jobs resume after reopening. Search may
            be slower on smaller devices.
          </p>
        </section>
        <section className="surface settings-section">
          <div className="section-title">
            <div>
              <h2>Browser storage</h2>
              <p>Local to this browser and device.</p>
            </div>
          </div>
          <div className="storage-summary">
            <strong>{bytes(items.reduce((n, i) => n + i.byteLength, 0))}</strong>
            <span>of saved originals · {items.length} items</span>
          </div>
          {storage.usage !== undefined && (
            <p className="small muted">
              Browser reports {bytes(storage.usage)} used
              {storage.quota ? ` of ${bytes(storage.quota)} available quota` : ''}, including cached
              models.
            </p>
          )}
          <p>
            {storage.persistent
              ? 'Persistent storage was granted. Clearing site data still removes your library.'
              : 'Browsers may remove local data under storage pressure. Request persistence and keep a manual backup.'}
          </p>
          <button
            className="button secondary"
            onClick={() =>
              void perform('persistence', async () => {
                const granted = await navigator.storage?.persist?.();
                setStorage((p) => ({ ...p, persistent: granted }));
                notify(
                  granted
                    ? 'Persistent storage granted. Keep backups too.'
                    : 'Persistence was not granted. You can still use the library and export backups.',
                );
              })
            }
          >
            Request persistent storage
          </button>
        </section>
        <section className="surface settings-section">
          <div className="section-title">
            <div>
              <h2>Backup & transfer</h2>
              <p>Move a copy to another device manually.</p>
            </div>
          </div>
          <p>
            Exports include originals and metadata in an unencrypted ZIP. Models and embeddings are
            excluded. Restored items are queued for processing.
          </p>
          <div className="button-row">
            <button
              className="button secondary"
              disabled={!items.length || !!busy}
              onClick={() => void exportAll()}
            >
              {busy === 'export' ? 'Creating backup…' : 'Export library'}
            </button>
            <button
              className="button secondary"
              disabled={!!busy}
              onClick={() => restoreInput.current?.click()}
            >
              {busy === 'restore' ? 'Restoring…' : 'Restore backup'}
            </button>
            <input
              type="file"
              accept=".zip,application/zip"
              className="sr-only"
              ref={restoreInput}
              aria-label="Choose backup ZIP"
              tabIndex={-1}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file)
                  void perform('restore', async () => {
                    const report = await repository.importArchive(file);
                    notify(
                      `Restored ${report.importedIds.length} items. Skipped ${report.skippedDuplicateIds.length} duplicates.`,
                    );
                    for (const id of report.importedIds) void engine.indexItem(id);
                  });
              }}
            />
          </div>
        </section>
        <section className="surface settings-section">
          <div className="section-title">
            <div>
              <h2>About this project</h2>
              <p>Built by IIT Gandhinagar students.</p>
            </div>
          </div>
          <p>
            Install from Chrome’s app menu, or on iPhone use Safari’s Share menu and Add to Home
            Screen. Installation needs HTTPS or localhost.
          </p>
          <p>
            Campus Recall is a student project by Raj, Chaitanya and Nakshatra. It is not an
            official IITGN service. Libraries do not sync between devices.
          </p>
          <a className="settings-policy" href="#/privacy">
            Privacy Policy <ChevronRight size={17} />
          </a>
          <a className="settings-policy" href="#/terms">
            Terms and Conditions <ChevronRight size={17} />
          </a>
          <a
            className="settings-policy"
            href="https://github.com/rajmodi8905/cs437-Last_3_Brain_Cells-hack/issues"
            target="_blank"
            rel="noopener noreferrer"
          >
            Report an issue <ArrowUpRight size={17} />
          </a>
        </section>
      </div>
    </>
  );
}
