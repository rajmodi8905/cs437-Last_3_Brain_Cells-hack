import { useEffect, useRef, useState } from 'react';
import { ArrowRight, LoaderCircle, X } from 'lucide-react';
import type { LibraryItem, LibraryRepository, SaveInput } from '../shared';
import type { CaptureService } from '../app/services';
import { plainMessage } from '../app/plainError';
import { takeShare } from '../app/shareTarget';
import { fileProblem, sameFile } from '../app/fileCheck';
import {
  MAX_FOLDER_FILES,
  folderName,
  freeBytes,
  isFolderEntry,
  sortFolder,
  walkEntries,
  type FolderEntry,
  type SkippedFile,
} from '../app/folderFiles';
import { bytes } from './hooks';
/** True when a paste belongs to a field the student is typing in. */
const typingIn = (target: EventTarget | null) =>
  target instanceof Element &&
  !!target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
/** Folders can be picked only where the browser supports it; elsewhere Add looks as before. */
const canPickFolder = () =>
  typeof HTMLInputElement !== 'undefined' && 'webkitdirectory' in HTMLInputElement.prototype;
/**
 * What one added folder brought in, shown as a summary above the file list. The summary is
 * worked out again from the files of that folder still selected, so removing them keeps it
 * true, and removing all of them removes the summary and its skipped files with it.
 */
interface FolderNote {
  id: number;
  name?: string;
  ready: File[];
  skipped: SkippedFile[];
  overLimit: number;
  truncated: boolean;
}
export function Add({
  repository,
  capture: { captureWebpage, extractHtml, extractPdfText, validateWebUrl },
  onSaved,
}: {
  repository: Pick<LibraryRepository, 'save'>;
  capture: CaptureService;
  onSaved: (items: LibraryItem[], warning?: string) => void;
}) {
  const [tab, setTab] = useState<'file' | 'note' | 'webpage'>('file');
  const [files, setFiles] = useState<File[]>([]);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState('');
  const [captureNotice, setCaptureNotice] = useState('');
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const [folderNotes, setFolderNotes] = useState<FolderNote[]>([]);
  const nextFolder = useRef(0);
  const [reading, setReading] = useState(false);
  const lastCapture = useRef<{ url: string; title: string } | undefined>(undefined);
  const [shareNotice, setShareNotice] = useState('');
  const fileList = useRef<HTMLUListElement>(null);
  const dropzone = useRef<HTMLButtonElement>(null);
  // After a remove, the file whose remove button should take focus (or the drop zone).
  const focusAfterRemove = useRef<number | undefined>(undefined);
  /** Adds to the selection. The same file picked again is listed once. */
  const addFiles = (added: File[]) =>
    setFiles((current) => [
      ...current,
      ...added.filter(
        (file, i) =>
          !current.some((kept) => sameFile(kept, file)) &&
          !added.slice(0, i).some((earlier) => sameFile(earlier, file)),
      ),
    ]);
  /** Adds a folder's files that can be saved; the rest are listed as skipped, with reasons. */
  const addFolder = (
    folderFiles: File[],
    name = folderName(folderFiles),
    truncated = false,
    unread: SkippedFile[] = [],
  ) => {
    const { ready, skipped, overLimit } = sortFolder(folderFiles);
    addFiles(ready);
    const note = { name, ready, skipped: [...unread, ...skipped], overLimit, truncated };
    setFolderNotes((current) => [...current, { id: nextFolder.current++, ...note }]);
  };
  const removeFile = (index: number) => {
    focusAfterRemove.current = index;
    setFiles((current) => current.filter((_, i) => i !== index));
  };
  useEffect(() => {
    const index = focusAfterRemove.current;
    if (index === undefined) return;
    focusAfterRemove.current = undefined;
    const buttons = fileList.current?.querySelectorAll<HTMLElement>('.file-remove');
    const next = buttons?.[Math.min(index, buttons.length - 1)];
    (next ?? dropzone.current)?.focus();
  }, [files]);
  const problems = files.map(fileProblem);
  const valid = files.filter((_, i) => !problems[i]);
  const invalid = problems.filter((problem): problem is string => !!problem);
  // Each folder's summary counts only its files still selected. A folder that brought nothing
  // savable keeps its summary, so its skipped files are still explained.
  const liveFolders = folderNotes
    .map((note) => ({
      ...note,
      added: note.ready.length,
      ready: note.ready.filter((file) => files.some((kept) => sameFile(kept, file))),
    }))
    .filter((note) => note.ready.length > 0 || note.added === 0);
  // Pasting on Add: an image joins Files; text starts a note. A paste into a field stays there.
  const pasteBlocked = useRef(false);
  pasteBlocked.current = busy || capturing;
  useEffect(() => {
    const paste = (e: ClipboardEvent) => {
      if (pasteBlocked.current || typingIn(e.target) || typingIn(document.activeElement)) return;
      const data = e.clipboardData;
      if (!data) return;
      const pasted = Array.from(data.files ?? []);
      if (pasted.length) {
        e.preventDefault();
        setTab('file');
        setError('');
        addFiles(pasted);
        setShareNotice(
          pasted.length === 1
            ? 'Pasted file added. Check it, then save locally.'
            : `${pasted.length} pasted files added. Check them, then save locally.`,
        );
        return;
      }
      const pastedText = data.getData('text/plain');
      if (!pastedText.trim()) return;
      e.preventDefault();
      setTab('note');
      setError('');
      setText((current) => (current.trim() ? `${current}\n${pastedText}` : pastedText));
      setShareNotice('Pasted text added to a note. Check it, then save locally.');
    };
    document.addEventListener('paste', paste);
    return () => document.removeEventListener('paste', paste);
  }, []);
  // A share from another app (Android share sheet) opens Add with the share's id. Fill the form
  // from it and delete the temporary copy; the student still checks it and saves.
  useEffect(() => {
    const id = new URLSearchParams(location.hash.split('?')[1] ?? '').get('share');
    if (!id) return;
    // The id is used once; reloading shows an empty Add screen.
    history.replaceState(history.state, '', '#/add');
    let current = true;
    const missing = 'The shared item is no longer here. Share it again, or choose it below.';
    void takeShare(id, new URL(import.meta.env.BASE_URL, location.href).href)
      .then((draft) => {
        if (!current) return;
        if (!draft) return setShareNotice(missing);
        setTab(draft.tab);
        setFiles(draft.files);
        setTitle(draft.title);
        setText(draft.text);
        setUrl(draft.url);
        setShareNotice(
          draft.tab === 'file'
            ? 'The shared files are ready. Check them, then save locally.'
            : 'The shared text is ready. Check it, then save locally.',
        );
      })
      .catch(() => current && setShareNotice(missing));
    return () => {
      current = false;
    };
  }, []);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const saved: LibraryItem[] = [];
    try {
      let inputs: SaveInput[];
      if (tab === 'file') {
        if (!files.length) throw new Error('Choose at least one file.');
        if (!valid.length) {
          setError(
            invalid.length === 1
              ? invalid[0]
              : 'None of these files can be saved. Remove them or choose other files.',
          );
          return;
        }
        // A large batch is checked against the space left before saving, so it does not stop
        // halfway with the device full.
        const needed = valid.reduce((sum, file) => sum + file.size, 0);
        const room = await freeBytes();
        if (room !== undefined && needed > room) {
          setError(
            `These files need about ${bytes(needed)}, but only ${bytes(room)} of space is left on this device. Remove some files or free up space, then save again.`,
          );
          return;
        }
        inputs = valid.map((file) => ({
          kind: 'file',
          file,
          title: valid.length === 1 ? title : undefined,
        }));
      } else {
        if (!text.trim()) throw new Error('Add some text before saving.');
        inputs = [
          tab === 'note'
            ? { kind: 'note', text, title }
            : { kind: 'webpage', url: validateWebUrl(url).href, text, title },
        ];
      }
      for (const value of inputs) saved.push(await repository.save(value));
      // Files that cannot be saved were listed with the reason; say so again on the Library.
      const folderSkipped =
        tab === 'file' ? liveFolders.reduce((sum, note) => sum + note.skipped.length, 0) : 0;
      const skipped =
        [
          tab === 'file' && invalid.length
            ? `${invalid.join(' ')} ${invalid.length} remaining file(s) were not saved.`
            : '',
          folderSkipped ? `${folderSkipped} file(s) from the folder were skipped.` : '',
        ]
          .filter(Boolean)
          .join(' ') || undefined;
      setFiles([]);
      setFolderNotes([]);
      setText('');
      setTitle('');
      setUrl('');
      onSaved(saved, skipped);
    } catch (cause) {
      const remaining = valid.length - saved.length + invalid.length;
      const message = `${plainMessage(cause)}${saved.length ? ` Stopped at ${valid[saved.length]?.name ?? 'the next item'}. ${remaining} remaining file(s) were not saved.` : ''}`;
      if (saved.length) onSaved(saved, message);
      else setError(message);
    } finally {
      setBusy(false);
    }
  };
  const capture = async () => {
    setCapturing(true);
    setError('');
    try {
      const value = await captureWebpage(url);
      setText(value.text);
      lastCapture.current = { url: value.url, title: value.title };
      setCaptureNotice(
        value.truncated
          ? 'Only the first 20,000 characters were captured. Check the website for the rest.'
          : '',
      );
      if (!title) setTitle(value.title);
    } catch (cause) {
      setError(plainMessage(cause));
    } finally {
      setCapturing(false);
    }
  };
  return (
    <div className="add-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR PERSONAL LIBRARY</span>
          <h1 tabIndex={-1}>Add to your library</h1>
          <p>Keep the original here. Search for it in your own words later.</p>
        </div>
      </div>
      <div className="add-layout">
        <form className="surface add-form" onSubmit={save}>
          <div className="tab-bar" role="tablist" aria-label="Save type">
            {(
              [
                ['file', 'Files'],
                ['note', 'Note'],
                ['webpage', 'Webpage'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                role="tab"
                disabled={busy || capturing}
                aria-selected={tab === id}
                className={tab === id ? 'selected' : ''}
                type="button"
                onClick={() => {
                  setTab(id);
                  setError('');
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === 'file' && (
            <>
              <input
                ref={input}
                disabled={busy}
                aria-label="Choose files to save"
                tabIndex={-1}
                className="sr-only"
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp,application/pdf,audio/mpeg,audio/wav,audio/mp4,video/mp4"
                onChange={(e) => {
                  addFiles(Array.from(e.target.files ?? []));
                  setError('');
                  // Picking the same file again after removing it still reports a change.
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                ref={dropzone}
                className={`dropzone ${drag ? 'dragging' : ''}`}
                disabled={busy}
                onClick={() => input.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDrag(true);
                }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDrag(false);
                  setError('');
                  // A dropped folder's contents are not in the file list, so its entries are
                  // walked. They must be taken now, while the drop event is still running.
                  const entries = Array.from(e.dataTransfer.items ?? [])
                    .map((item) => item.webkitGetAsEntry?.() as FolderEntry | null | undefined)
                    .filter((entry): entry is FolderEntry => !!entry);
                  const folders = entries.filter(isFolderEntry);
                  if (!folders.length) {
                    addFiles(Array.from(e.dataTransfer.files));
                    return;
                  }
                  setReading(true);
                  void walkEntries(entries)
                    .then(({ files: found, skipped, truncated }) =>
                      addFolder(
                        found,
                        folders.length === 1 ? folders[0].name : undefined,
                        truncated,
                        skipped,
                      ),
                    )
                    .catch((cause) =>
                      setError(`The folder could not be read. ${plainMessage(cause)}`),
                    )
                    .finally(() => setReading(false));
                }}
              >
                <strong>
                  {reading
                    ? 'Reading the folder…'
                    : files.length
                      ? `${files.length} file${files.length === 1 ? '' : 's'} selected`
                      : 'Choose files or drop them here'}
                </strong>
                <span>Images, PDFs, audio and MP4 video</span>
                <span className="small muted">
                  {files.length
                    ? 'Choose or drop more to add them'
                    : 'Originals stay on this device'}
                </span>
              </button>
              {canPickFolder() && (
                <>
                  <input
                    ref={(element) => {
                      folderInput.current = element;
                      // React does not know this attribute, so it is set directly.
                      element?.setAttribute('webkitdirectory', '');
                    }}
                    disabled={busy}
                    aria-label="Choose a folder to save"
                    tabIndex={-1}
                    className="sr-only"
                    type="file"
                    multiple
                    onChange={(e) => {
                      setError('');
                      addFolder(Array.from(e.target.files ?? []));
                      e.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    className="button secondary folder-pick"
                    disabled={busy || reading}
                    onClick={() => folderInput.current?.click()}
                  >
                    Choose a folder
                  </button>
                </>
              )}
              {liveFolders.map((note) => (
                <div className="folder-summary" role="status" key={note.id}>
                  <p>
                    {note.name ? `From “${note.name}”: ` : 'From the folder: '}
                    {note.ready.length} file{note.ready.length === 1 ? '' : 's'} ready to save
                    {note.skipped.length ? `, ${note.skipped.length} skipped` : ''}.
                    {note.overLimit > 0 &&
                      ` ${note.overLimit} more could be saved, but one folder adds at most ${MAX_FOLDER_FILES} files. Add the rest in another go.`}
                    {note.truncated &&
                      ' This folder is very large, so only part of it was read. Add its subfolders one at a time.'}
                  </p>
                  {note.skipped.length > 0 && (
                    <details>
                      <summary>Show skipped</summary>
                      <ul className="skipped-files" aria-label="Skipped files">
                        {note.skipped.map((skip, i) => (
                          <li key={`${skip.name}-${i}`}>{skip.reason}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              ))}
              {files.length > 0 && (
                <ul className="selected-files" aria-label="Selected files" ref={fileList}>
                  {files.map((f, i) => (
                    <li key={`${f.name}-${f.size}-${f.lastModified}`}>
                      <span className="file-copy">
                        <span className="file-name">{f.name}</span>
                        <span className="file-size muted">{bytes(f.size)}</span>
                        {problems[i] && (
                          <span className="file-problem error-text">{problems[i]}</span>
                        )}
                      </span>
                      <button
                        type="button"
                        className="icon-button file-remove"
                        aria-label={`Remove ${f.name}`}
                        disabled={busy}
                        onClick={() => removeFile(i)}
                      >
                        <X size={18} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {/* Announced when files that cannot be saved are picked. */}
              <p className="field-help error-text file-summary" aria-live="polite">
                {invalid.length
                  ? `${invalid.length === 1 ? '1 file cannot' : `${invalid.length} files cannot`} be saved. Remove ${invalid.length === 1 ? 'it' : 'them'} or choose other files.`
                  : ''}
              </p>
            </>
          )}
          {(tab !== 'file' || valid.length <= 1) && (
            <label>
              Title <span className="muted">optional</span>
              <input
                value={title}
                maxLength={120}
                placeholder={
                  tab === 'note' ? 'e.g. CS437 project instructions' : 'A name you will recognize'
                }
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
          )}
          {tab === 'webpage' && (
            <>
              <label>
                Public webpage URL
                <div className="url-row">
                  <input
                    type="url"
                    required
                    placeholder="https://…"
                    value={url}
                    disabled={capturing || busy}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (lastCapture.current && value !== lastCapture.current.url) {
                        setText('');
                        setCaptureNotice('');
                        if (title === lastCapture.current.title) setTitle('');
                        lastCapture.current = undefined;
                      }
                      setUrl(value);
                    }}
                  />
                  <button
                    className="button secondary"
                    type="button"
                    disabled={capturing || !url}
                    onClick={() => void capture()}
                  >
                    {capturing && <LoaderCircle size={16} className="spin" />} Capture
                  </button>
                </div>
              </label>
              <p className="field-help">
                Capture sends a request to this website. If it is blocked, paste its text or import
                a snapshot below.
              </p>
              <label className="snapshot-input">
                Import an HTML or PDF snapshot
                <input
                  type="file"
                  accept=".html,.htm,text/html,.pdf,application/pdf"
                  onChange={async (e) => {
                    setError('');
                    try {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
                      if (!isPdf && f.size > 2_000_000)
                        throw new Error('HTML snapshot must be under 2 MB.');
                      const captured = isPdf
                        ? await extractPdfText(f)
                        : extractHtml(await f.text());
                      setText(captured.text);
                      lastCapture.current = undefined;
                      setCaptureNotice(
                        captured.truncated
                          ? 'Only the first 20,000 characters of this snapshot were captured.'
                          : '',
                      );
                      if (!title) setTitle(captured.title);
                    } catch (cause) {
                      setError(plainMessage(cause));
                    }
                  }}
                />
              </label>
            </>
          )}
          {tab !== 'file' && (
            <label>
              {tab === 'note' ? 'Note' : 'Saved page text'}
              <textarea
                aria-label={tab === 'note' ? 'Note' : 'Saved page text'}
                required
                rows={10}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={
                  tab === 'note'
                    ? 'Paste the information you want to remember.'
                    : 'Capture a page or paste its readable text here.'
                }
              />
              <span className="field-help">
                {Array.from(text).length.toLocaleString()} / 20,000 characters
              </span>
            </label>
          )}
          {shareNotice && (
            <p className="notice" role="status">
              {shareNotice}
            </p>
          )}
          {error && (
            <div role="alert" className="notice error">
              {error}
            </div>
          )}
          {captureNotice && tab === 'webpage' && (
            <p className="notice" role="status">
              {captureNotice}
            </p>
          )}
          <div className="form-footer">
            <span className="small muted">Saved first. Processed locally.</span>
            <button className="button primary" disabled={busy || capturing}>
              {busy ? <LoaderCircle className="spin" size={17} /> : <ArrowRight size={17} />}{' '}
              {busy ? 'Saving…' : 'Save locally'}
            </button>
          </div>
        </form>
        <aside className="save-guide">
          <span className="eyebrow">WHAT YOU CAN SAVE</span>
          <h2>One place for the things you keep.</h2>
          <dl>
            <dt>Images & screenshots</dt>
            <dd>JPEG, PNG or WebP · up to 20 MB</dd>
            <dt>PDF documents</dt>
            <dd>Up to 50 pages and 20 MB</dd>
            <dt>Notes & webpages</dt>
            <dd>Up to 20,000 characters</dd>
            <dt>Audio</dt>
            <dd>MP3, WAV or M4A · 5 min · 50 MB</dd>
            <dt>Video</dt>
            <dd>H.264 MP4 · 2 min · 100 MB</dd>
          </dl>
          <div className="guide-note">
            Search covers extracted text, English speech and visual content. Video scenes are
            sampled every five seconds.
          </div>
          <p className="small muted">HEIC, MOV and HEVC files need conversion before importing.</p>
        </aside>
      </div>
    </div>
  );
}
