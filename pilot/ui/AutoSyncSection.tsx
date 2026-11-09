import { useEffect, useState, useSyncExternalStore } from 'react';
import type { CampusRecallServices } from '../../src/app/services';
import { downloadBlob } from '../../src/app/download';
import { bytes } from '../../src/ui/hooks';
import { getAutoSync } from '../client/autosync';

const kindNames: Record<string, string> = {
  image: 'Image',
  pdf: 'PDF',
  note: 'Note',
  webpage: 'Webpage',
  audio: 'Audio',
  video: 'Video',
};

/** Pilot Auto-sync settings. Local only stays the default until the user signs in and opts in. */
export function AutoSyncSection({ services }: { services: CampusRecallServices }) {
  // App-wide controller: leaving Settings does not stop syncing.
  const controller = getAutoSync(services);
  const view = useSyncExternalStore(controller.subscribe, controller.getView);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [exportStatus, setExportStatus] = useState('');
  const [confirming, setConfirming] = useState<string>();
  const [removeLocalCopies, setRemoveLocalCopies] = useState(false);
  useEffect(() => {
    void controller.start();
  }, [controller]);
  const act = (work: () => Promise<unknown>) => async () => {
    setBusy(true);
    setActionError('');
    try {
      await work();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const signedIn = view.status === 'signed-in';
  const on = signedIn && view.included && !view.paused && !view.needsResync;
  const error = actionError || view.error;

  return (
    <section className="surface settings-section" aria-labelledby="autosync-title">
      <div className="section-title">
        <div>
          <h2 id="autosync-title">Auto-sync</h2>
          <p>Pilot. Keep your library on every device you sign in to.</p>
        </div>
        <span className={`status ${on ? 'ready' : 'queued'}`}>
          {on
            ? 'On'
            : view.paused && signedIn
              ? 'Paused'
              : view.status === 'local-only'
                ? 'Local only'
                : view.status === 'offline'
                  ? 'Offline'
                  : 'Not syncing'}
        </span>
      </div>

      <p>
        Cloud access and export end on 6 December 2026 at 17:47 IST (12:17 UTC). Download your cloud
        export before then.
      </p>

      {view.entry === 'insiit' && (
        <p className="notice" role="status">
          You opened Campus Recall from INSIIT. INSIIT does not sign you in here. Set up Auto-sync
          to sign in with your IITGN Google account.
        </p>
      )}
      {view.status === 'local-only' && (
        <>
          <p>
            Local only. Your library stays on this device. Set up Auto-sync to contact the pilot
            service and sign in. Nothing uploads until you include your library.
          </p>
          <button
            className="button secondary"
            disabled={busy}
            onClick={act(() => controller.activate())}
          >
            Set up Auto-sync
          </button>
        </>
      )}

      {view.status === 'loading' && <p>Checking Auto-sync…</p>}

      {view.status === 'unavailable' && (
        <p>Local only. Your library stays on this device. Auto-sync is not available here.</p>
      )}

      {view.status === 'offline' && (
        <>
          <p role="status">
            Offline. The sync service cannot be reached. Items you kept offline for {view.email}{' '}
            still open on this device.
          </p>
          {view.cloudOnly.some((item) => view.offlineIds.includes(item.globalId)) && (
            <>
              <h3 id="kept-offline-title">Kept offline</h3>
              <ul className="selected-files" aria-labelledby="kept-offline-title">
                {view.cloudOnly
                  .filter((item) => view.offlineIds.includes(item.globalId))
                  .map((item) => (
                    <li key={item.globalId}>
                      <span>{kindNames[item.kind ?? ''] ?? 'Item'}</span>
                      <span>{item.title}</span>
                      <span className="muted">{bytes(item.byteLength ?? 0)}</span>
                      <button
                        className="button secondary"
                        aria-label={`Open ${item.title}`}
                        onClick={() => controller.open(item.globalId)}
                      >
                        Open
                      </button>
                      <button
                        className="button secondary"
                        aria-label={`Download ${item.title}`}
                        disabled={busy}
                        onClick={act(async () => {
                          const { blob, name } = await controller.download(item.globalId);
                          downloadBlob(blob, name);
                        })}
                      >
                        Download
                      </button>
                    </li>
                  ))}
              </ul>
            </>
          )}
          <button
            className="button secondary"
            disabled={busy}
            onClick={act(() => controller.activate())}
          >
            Try again
          </button>
        </>
      )}

      {(view.status === 'signed-out' ||
        view.status === 'unavailable' ||
        view.status === 'offline') && (
        <button
          className="button secondary"
          disabled={busy}
          onClick={act(() => controller.useLocalOnly())}
        >
          Use Local only
        </button>
      )}

      {view.status === 'signed-out' && (
        <>
          <p>
            Your library stays on this device until you include it. Sign in with your IITGN account
            to keep a private copy in the cloud and open it on your other devices.
          </p>
          {view.signInMode === 'dev' ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void act(() => controller.signInDev(email))();
              }}
            >
              <label>
                IITGN email
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <button className="button primary" disabled={busy}>
                Sign in (development)
              </button>
              <p className="field-help">
                Development sign-in: this server runs without Google. Any typed IITGN email can sign
                in.
              </p>
            </form>
          ) : view.googleReady ? (
            <>
              <button
                className="button primary"
                disabled={busy}
                onClick={() => controller.signInGoogle()}
              >
                Sign in with Google
              </button>
              <p className="field-help">
                You go to Google to choose your IITGN account, then come back here.
              </p>
            </>
          ) : (
            <p className="field-help">Google sign-in is not configured on this server yet.</p>
          )}
        </>
      )}

      {signedIn && (
        <>
          <p>Signed in as {view.email}.</p>
          {view.needsResync ? (
            <div className="notice" role="status">
              <span>
                Your cloud library was removed or reset. Nothing is uploaded from this device until
                you start again.
              </span>
              <button
                className="button secondary"
                disabled={busy}
                onClick={act(() => controller.startAgain())}
              >
                Start again
              </button>
            </div>
          ) : !view.included ? (
            <>
              <p>
                Nothing is uploaded until you include this device&apos;s library. Originals, titles,
                extracted text and embeddings then go to your private Azure cloud library.
                Processing and search stay on your devices. Authorized project operators can access
                cloud content. Read the <a href="#/privacy">Privacy Policy</a> and{' '}
                <a href="#/terms">Terms and Conditions</a> before including your library.
              </p>
              <button
                className="button primary"
                disabled={busy}
                onClick={act(() => controller.include())}
              >
                Include this device&apos;s library
              </button>
            </>
          ) : view.paused ? (
            <p role="status">
              Sync is paused on this device. Nothing is sent or received until you resume.
            </p>
          ) : (
            <p role="status">
              Auto-sync is on. {view.syncedCount} item{view.syncedCount === 1 ? '' : 's'} synced
              {view.syncing ? '. Syncing…' : '.'}
            </p>
          )}
          {view.blocked && (
            <p className="notice error">
              Sync is paused: this account is linked to a different library on this device.
            </p>
          )}
          {view.conflicts.map((conflict) => (
            <p className="notice" key={`${conflict.title}-${conflict.remoteTitle}`}>
              Renamed on two devices: “{conflict.title}” here, “{conflict.remoteTitle}” on another
              device. Rename it here to keep one title.
            </p>
          ))}
          {view.cloudOnly.length > 0 && (
            <>
              <h3 id="cloud-library-title">In your cloud library</h3>
              <ul className="selected-files" aria-labelledby="cloud-library-title">
                {view.cloudOnly.map((item) => {
                  const kept = view.offlineIds.includes(item.globalId);
                  const deleting = confirming === `delete:${item.globalId}`;
                  return (
                    <li key={item.globalId}>
                      <span>{kindNames[item.kind ?? ''] ?? 'Item'}</span>
                      <span>{item.title}</span>
                      <span className="muted">
                        {bytes(item.byteLength ?? 0)}
                        {kept ? ' · Kept offline' : ''}
                      </span>
                      <button
                        className="button secondary"
                        aria-label={`Open ${item.title}`}
                        onClick={() => controller.open(item.globalId)}
                      >
                        Open
                      </button>
                      <button
                        className="button secondary"
                        aria-label={`Download ${item.title}`}
                        disabled={busy}
                        onClick={act(async () => {
                          const { blob, name } = await controller.download(item.globalId);
                          downloadBlob(blob, name);
                        })}
                      >
                        Download
                      </button>
                      <button
                        className="button secondary"
                        aria-label={`${kept ? 'Remove download of' : 'Keep offline'} ${item.title}`}
                        disabled={busy}
                        onClick={act(() =>
                          kept
                            ? controller.removeDownload(item.globalId)
                            : controller.keepOffline(item.globalId),
                        )}
                      >
                        {kept ? 'Remove download' : 'Keep offline'}
                      </button>
                      <button
                        className="button secondary"
                        aria-label={`${deleting ? 'Confirm deleting' : 'Delete'} ${item.title} from your cloud library`}
                        disabled={busy}
                        onClick={
                          deleting
                            ? act(async () => {
                                setConfirming(undefined);
                                await controller.deleteCloudItem(item.globalId);
                              })
                            : () => setConfirming(`delete:${item.globalId}`)
                        }
                      >
                        {deleting ? 'Confirm delete' : 'Delete'}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          <p>
            Export downloads every cloud original and its metadata in an unencrypted ZIP. Large
            libraries use several ZIPs; allow multiple downloads if your browser asks. Restore each
            ZIP through the local library&apos;s import control in Settings.
          </p>
          <div className="button-row">
            <button
              className="button secondary"
              disabled={busy}
              onClick={act(async () => {
                setExportStatus('Preparing your cloud export…');
                try {
                  const archives = await controller.exportCloudLibrary();
                  for (const [index, archive] of archives.entries()) {
                    downloadBlob(archive, `campus-recall-cloud-${index + 1}.zip`);
                  }
                  setExportStatus(
                    `${archives.length} export ZIP${archives.length === 1 ? '' : 's'} ready. Check your downloads.`,
                  );
                } catch (cause) {
                  setExportStatus('');
                  throw cause;
                }
              })}
            >
              Export cloud library
            </button>
            {view.included && !view.needsResync && (
              <>
                {!view.paused && (
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={act(() => controller.syncNow())}
                  >
                    Sync now
                  </button>
                )}
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={act(() => controller.setPaused(!view.paused))}
                >
                  {view.paused ? 'Resume sync' : 'Pause sync on this device'}
                </button>
              </>
            )}
            <button
              className="button secondary"
              disabled={busy}
              onClick={act(() => controller.signOut(removeLocalCopies))}
            >
              Sign out
            </button>
          </div>
          {exportStatus && <p role="status">{exportStatus}</p>}
          <label>
            <input
              type="checkbox"
              checked={removeLocalCopies}
              onChange={(e) => setRemoveLocalCopies(e.target.checked)}
            />{' '}
            When signing out, also remove this account&apos;s offline copies and sync data from this
            device
          </label>
          {view.included && !view.needsResync && (
            <div className="notice error">
              {confirming === 'vault' ? (
                <>
                  <span>
                    This deletes every cloud copy for this account. Items saved on each device stay
                    there. Devices stop syncing until you start again.
                  </span>
                  <button
                    className="button danger"
                    disabled={busy}
                    onClick={act(async () => {
                      setConfirming(undefined);
                      await controller.removeCloudLibrary();
                    })}
                  >
                    Yes, remove cloud library
                  </button>
                </>
              ) : (
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => setConfirming('vault')}
                >
                  Remove cloud library
                </button>
              )}
            </div>
          )}
        </>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {view.signOutPending && (
        <button
          className="button secondary"
          disabled={busy}
          onClick={act(() => controller.finishSignOut())}
        >
          Sign out again
        </button>
      )}
    </section>
  );
}
