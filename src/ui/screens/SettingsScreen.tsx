import { ArrowUpRight, ChevronRight, LoaderCircle } from 'lucide-react';
import type { AnyRecallModel } from '../../app/useAnyRecall';
import { bytes } from '../hooks';
import { AutoSyncSection } from '../../../pilot/ui/AutoSyncSection';
import { SetupProgress, downloadSize } from '../SetupProgress';
import { SearchModelPicker } from '../SearchModelPicker';
/** Browsers allow roughly a share of the disk, so the limit is given loosely. */
const roughSize = (value: number) =>
  value >= 1e9 ? `${(value / 1e9).toFixed(1)} GB` : bytes(value);
export function SettingsScreen({ model }: { model: AnyRecallModel }) {
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
    rememberSearches,
    chooseRememberSearches,
  } = model;
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">THIS DEVICE</span>
          <h1 tabIndex={-1}>Settings</h1>
          <p>Manage offline search, storage and your backups.</p>
        </div>
      </div>
      <div className="settings-grid">
        <AutoSyncSection services={model.services} notify={notify} />
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
            Search models for text, images and speech. Downloaded once
            {downloadBytes ? ` (${downloadSize(downloadBytes)})` : ''}, then processing and search
            run on this device.
          </p>
          <p className="small muted">
            {downloadBytes ? `${bytes(downloadBytes)} of assets.` : 'Asset size is loading.'} Model
            inference uses this device, without inference API keys or uploads for processing.
          </p>
          {progress?.stage === 'setup' && (
            <SetupProgress progress={progress} setup={setup} ready={ready} />
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
          {model.canChooseSearchModel && (
            <SearchModelPicker
              current={model.searchModel}
              custom={model.customModel}
              sizeOf={model.downloadBytesFor}
              switching={model.switchingModel}
              onSwitch={(next) => void model.switchSearchModel(next)}
              adding={model.addingModel}
              addError={model.addModelError}
              onAdd={(repo, options) => void model.addCustomModel(repo, options)}
            />
          )}
          <label className="settings-switch">
            <input
              type="checkbox"
              role="switch"
              checked={rememberSearches}
              aria-describedby="recent-searches-help"
              onChange={(e) => chooseRememberSearches(e.target.checked)}
            />
            <span>Remember recent searches</span>
          </label>
          <p className="field-help" id="recent-searches-help">
            Your last 5 searches that found something, shown on Search. They stay on this device and
            are never synced. Turning this off clears them.
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
            <span>
              of saved originals · {items.length} item{items.length === 1 ? '' : 's'}
            </span>
          </div>
          {storage.usage !== undefined && (
            <p className="small muted">
              This browser is using {bytes(storage.usage)}
              {storage.quota ? ` of about ${roughSize(storage.quota)} it allows` : ''} for this
              site, including the search download.
            </p>
          )}
          {storage.persistent ? (
            <p>This browser will keep your library unless you clear site data.</p>
          ) : (
            <>
              <p>
                Browsers may remove local data under storage pressure. Ask this browser to keep your
                library, and keep a manual backup.
              </p>
              <button
                className="button secondary"
                onClick={() =>
                  void perform('persistence', async () => {
                    const granted = await navigator.storage?.persist?.();
                    setStorage((p) => ({ ...p, persistent: granted }));
                    notify(
                      granted
                        ? 'This browser will keep your library. Keep backups too.'
                        : 'This browser did not agree to keep your library. You can still use it and export backups.',
                    );
                  })
                }
              >
                Keep my library on this device
              </button>
            </>
          )}
        </section>
        <section className="surface settings-section">
          <div className="section-title">
            <div>
              <h2>Backup & transfer</h2>
              <p>Move a copy to another device manually.</p>
            </div>
          </div>
          <p>
            Exports include originals and metadata in an unencrypted ZIP. The search download and
            search data are not included. Restored items get ready to search again on this device.
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
            Screen.
          </p>
          <p>
            AnyRecall is a student project by Raj, Chaitanya and Nakshatra. It is not an official
            IITGN service. Local only keeps a separate library on each device. Optional Auto-sync
            shares included content through your private Azure cloud library.
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
