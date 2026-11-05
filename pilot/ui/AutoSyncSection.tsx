import { useEffect, useState, useSyncExternalStore } from 'react';
import type { CampusRecallServices } from '../../src/app/services';
import { downloadBlob } from '../../src/app/download';
import { bytes } from '../../src/ui/hooks';
import { AutoSyncController } from '../client/autosync';

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
  const [controller] = useState(() => new AutoSyncController(services));
  const view = useSyncExternalStore(controller.subscribe, controller.getView);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void controller.start();
    return () => controller.dispose();
  }, [controller]);
  const act = (work: () => Promise<unknown>) => async () => {
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  };
  const signedIn = view.status === 'signed-in';

  return (
    <section className="surface settings-section" aria-labelledby="autosync-title">
      <div className="section-title">
        <div>
          <h2 id="autosync-title">Auto-sync</h2>
          <p>Pilot. Keep your library on every device you sign in to.</p>
        </div>
        <span className={`status ${signedIn && view.included ? 'ready' : 'queued'}`}>
          {signedIn && view.included ? 'On' : 'Local only'}
        </span>
      </div>

      {view.status === 'loading' && <p>Checking Auto-sync…</p>}

      {view.status === 'unavailable' && (
        <p>Local only. Your library stays on this device. Auto-sync is not available here.</p>
      )}

      {view.status === 'signed-out' && (
        <>
          <p>
            Local only. Your library stays on this device. Sign in with your IITGN account to keep a
            private copy in the cloud and open it on your other devices.
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
          ) : (
            <p className="field-help">Google sign-in is not configured on this server yet.</p>
          )}
        </>
      )}

      {signedIn && (
        <>
          <p>Signed in as {view.email}.</p>
          {!view.included ? (
            <>
              <p>
                Nothing is uploaded until you include this device&apos;s library. Your saved
                originals then go to your private cloud library. Processing and search stay on your
                devices.
              </p>
              <button
                className="button primary"
                disabled={busy}
                onClick={act(() => controller.include())}
              >
                Include this device&apos;s library
              </button>
            </>
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
                {view.cloudOnly.map((item) => (
                  <li key={item.globalId}>
                    <span>{kindNames[item.kind ?? ''] ?? 'Item'}</span>
                    <span>{item.title}</span>
                    <span className="muted">{bytes(item.byteLength ?? 0)}</span>
                    <button
                      className="button secondary"
                      aria-label={`Download ${item.title}`}
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
          <div className="button-row">
            {view.included && (
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
              onClick={act(() => controller.signOut())}
            >
              Sign out
            </button>
          </div>
        </>
      )}
      {view.error && (
        <p className="notice error" role="alert">
          {view.error}
        </p>
      )}
    </section>
  );
}
