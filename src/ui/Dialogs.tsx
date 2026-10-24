import { ChevronRight, HardDrive, Library, ShieldCheck, Trash2 } from 'lucide-react';
import type { CampusRecallModel } from '../app/useCampusRecall';
export function Dialogs({ model }: { model: CampusRecallModel }) {
  const {
    firstUse,
    setFirstUse,
    rename,
    setRename,
    deleting,
    setDeleting,
    perform,
    repository,
    engine,
    services,
    notify,
    busy,
  } = model;
  return (
    <>
      {firstUse && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="welcome-title"
          >
            <span className="brand-icon">
              <Library size={25} />
            </span>
            <span className="eyebrow">WELCOME TO CAMPUS RECALL</span>
            <h2 id="welcome-title">Save it here. Find it again.</h2>
            <p>
              Keep your screenshots, files and notes in a personal library on this device. Download
              the local models when you are ready to search.
            </p>
            <div className="intro-detail">
              <ShieldCheck size={19} />
              <span>
                No account or cloud inference. Model downloads and explicit website requests need
                internet.
              </span>
            </div>
            <div className="intro-detail">
              <HardDrive size={19} />
              <span>
                Browser storage can be cleared or evicted. Back up important originals in Settings.
              </span>
            </div>
            <p className="small">
              <a href="#/privacy" onClick={() => setFirstUse(false)}>
                Privacy Policy
              </a>{' '}
              ·{' '}
              <a href="#/terms" onClick={() => setFirstUse(false)}>
                Terms and Conditions
              </a>
            </p>
            <button
              autoFocus
              className="button primary full"
              onClick={() =>
                void services.preferences.set('intro-seen', true).then(() => setFirstUse(false))
              }
            >
              Open my library <ChevronRight size={16} />
            </button>
          </section>
        </div>
      )}
      {rename && (
        <div className="modal-backdrop">
          <form
            className="modal compact"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rename-title"
            onSubmit={(e) => {
              e.preventDefault();
              void perform('rename', async () => {
                await repository.renameItem(rename.id, rename.title);
                void engine.indexItem(rename.id);
                setRename(undefined);
                notify('Renamed. The original is unchanged.');
              });
            }}
          >
            <h2 id="rename-title">Rename item</h2>
            <label>
              Title
              <input
                autoFocus
                value={rename.title}
                onChange={(e) => setRename({ ...rename, title: e.target.value })}
                maxLength={120}
                required
              />
            </label>
            <div className="button-row end">
              <button
                className="button secondary"
                type="button"
                onClick={() => setRename(undefined)}
              >
                Cancel
              </button>
              <button className="button primary" disabled={!!busy}>
                Save title
              </button>
            </div>
          </form>
        </div>
      )}
      {deleting && (
        <div className="modal-backdrop">
          <section
            className="modal compact"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-title"
          >
            <h2 id="delete-title">Delete this item?</h2>
            <p>
              “{deleting.title}” and its derived search data will be removed from this library.
              Existing exported backups are separate.
            </p>
            <div className="button-row end">
              <button autoFocus className="button secondary" onClick={() => setDeleting(undefined)}>
                Keep item
              </button>
              <button
                className="button danger"
                disabled={!!busy}
                onClick={() =>
                  void perform('delete', async () => {
                    await engine.cancelItem(deleting.id);
                    await repository.deleteItem(deleting.id);
                    setDeleting(undefined);
                    notify('Deleted from this library.');
                  })
                }
              >
                <Trash2 size={16} /> Delete item
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
