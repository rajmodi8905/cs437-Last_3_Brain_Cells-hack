import { useRef, useState } from 'react';
import { ArrowRight, LoaderCircle } from 'lucide-react';
import type { LibraryItem, LibraryRepository, SaveInput } from '../shared';
import type { CaptureService } from '../app/services';
export function Add({
  repository,
  capture: { captureWebpage, extractHtml, validateWebUrl },
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
  const lastCapture = useRef<{ url: string; title: string } | undefined>(undefined);
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
        inputs = files.map((file) => ({
          kind: 'file',
          file,
          title: files.length === 1 ? title : undefined,
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
      setFiles([]);
      setText('');
      setTitle('');
      setUrl('');
      onSaved(saved);
    } catch (cause) {
      const message = `${cause instanceof Error ? cause.message : String(cause)}${saved.length ? ` Stopped at ${files[saved.length]?.name ?? 'the next item'}. ${files.length - saved.length} remaining file(s) were not saved.` : ''}`;
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
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setCapturing(false);
    }
  };
  return (
    <div className="add-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR PERSONAL LIBRARY</span>
          <h1>Add to your library</h1>
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
                onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
              />
              <button
                type="button"
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
                  setFiles(Array.from(e.dataTransfer.files));
                }}
              >
                <strong>
                  {files.length
                    ? `${files.length} file${files.length === 1 ? '' : 's'} selected`
                    : 'Choose files or drop them here'}
                </strong>
                <span>Images, PDFs, audio and MP4 video</span>
                <span className="small muted">Originals stay on this device</span>
              </button>
              {files.length > 0 && (
                <ul className="selected-files">
                  {files.map((f, i) => (
                    <li key={i}>
                      <span>{f.name}</span>
                      <span className="muted">{(f.size / 1e6).toFixed(1)} MB</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          {(tab !== 'file' || files.length <= 1) && (
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
                Import an HTML text snapshot
                <input
                  type="file"
                  accept=".html,.htm,text/html"
                  onChange={async (e) => {
                    try {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      if (f.size > 2_000_000) throw new Error('HTML snapshot must be under 2 MB.');
                      const captured = extractHtml(await f.text());
                      setText(captured.text);
                      lastCapture.current = undefined;
                      setCaptureNotice(
                        captured.truncated
                          ? 'Only the first 20,000 characters of this snapshot were captured.'
                          : '',
                      );
                      if (!title) setTitle(captured.title);
                    } catch (cause) {
                      setError(String(cause));
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
