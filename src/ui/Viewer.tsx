import { useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  LoaderCircle,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { LibraryItem, LibraryRepository, SourceLocation } from '../shared';
import { pdfjs } from '../shared/browser-assets';
import { downloadBlob, time, useObjectUrl } from './hooks';
export function Viewer({
  item,
  location,
  repository,
  onClose,
}: {
  item: LibraryItem;
  location?: SourceLocation;
  repository: Pick<LibraryRepository, 'getOriginal' | 'exportItems'>;
  onClose: () => void;
}) {
  const [zoom, setZoom] = useState(false);
  const [blob, setBlob] = useState<Blob>();
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const url = useObjectUrl(blob);
  const [page, setPage] = useState(location?.kind === 'page' ? location.page : 1);
  const [pages, setPages] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  const media = useRef<HTMLMediaElement | null>(null);
  useEffect(() => {
    let current = true;
    setBlob(undefined);
    setError('');
    setText('');
    void repository
      .getOriginal(item.id)
      .then(async (original) => {
        if (!current) return;
        if (!original) {
          setError('This original is unavailable. Restore it from a backup if you have one.');
          return;
        }
        setBlob(original);
        if (item.kind === 'note' || item.kind === 'webpage') {
          const value = await original.text();
          if (current) setText(value);
        }
      })
      .catch((cause) => {
        if (current) setError(String(cause));
      });
    return () => {
      current = false;
    };
  }, [item.id, repository]);
  useEffect(() => {
    setPage(location?.kind === 'page' ? location.page : 1);
  }, [item.id, location]);
  useEffect(() => {
    if (item.kind !== 'pdf' || !blob) return;
    let cancelled = false;
    let document: any;
    let loadingTask: any;
    let render: any;
    void (async () => {
      const pdf = await pdfjs();
      loadingTask = pdf.getDocument({
        data: await blob.arrayBuffer(),
        useSystemFonts: true,
        useWasm: false,
      });
      document = await loadingTask.promise;
      if (cancelled) {
        await loadingTask.destroy();
        return;
      }
      setPages(document.numPages);
      const source = await document.getPage(Math.min(page, document.numPages));
      const viewport = source.getViewport({ scale: 1.5 });
      if (!canvas.current) return;
      canvas.current.width = viewport.width;
      canvas.current.height = viewport.height;
      render = source.render({
        canvas: canvas.current,
        canvasContext: canvas.current.getContext('2d')!,
        viewport,
      });
      await render.promise;
    })().catch((cause) => {
      if (!cancelled) setError(`Could not display this PDF. ${cause.message}`);
    });
    return () => {
      cancelled = true;
      render?.cancel();
      void loadingTask?.destroy();
    };
  }, [blob, page, item.kind]);
  const seek = () => {
    if (media.current && location?.kind === 'time')
      media.current.currentTime = location.startMs / 1000;
  };
  useEffect(() => {
    seek();
  }, [location, url]);
  const titleId = `source-${item.id}`;
  return (
    <section className="viewer" aria-labelledby={titleId}>
      <div className="viewer-header">
        <span className="eyebrow">ORIGINAL SOURCE</span>
        <button className="icon-button" onClick={onClose} aria-label="Close original">
          <X size={19} />
        </button>
      </div>
      <h2 id={titleId}>{item.title}</h2>
      <p className="muted source-meta">
        {item.originalName ?? (item.kind === 'webpage' ? 'Saved webpage text' : 'Saved note')}
        {location?.kind === 'time' && ` · ${time(location.startMs)} to ${time(location.endMs)}`}
      </p>
      {item.sourceUrl && (
        <a
          className="source-link"
          href={item.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          referrerPolicy="no-referrer"
        >
          Open website <ExternalLink size={14} />
        </a>
      )}
      <div className="source-body">
        {error ? (
          <div className="notice error" role="alert">
            {error}
          </div>
        ) : !url ? (
          <div className="loading">
            <LoaderCircle className="spin" size={20} /> Opening original
          </div>
        ) : (
          <>
            {item.kind === 'image' && (
              <>
                <button
                  className="button secondary zoom-control"
                  onClick={() => setZoom((z) => !z)}
                >
                  {zoom ? <ZoomOut size={16} /> : <ZoomIn size={16} />}{' '}
                  {zoom ? 'Fit image' : 'Zoom image'}
                </button>
                <img
                  className={`original-image ${zoom ? 'zoomed' : ''}`}
                  src={url}
                  alt={item.title}
                />
              </>
            )}
            {item.kind === 'pdf' && (
              <>
                <div className="pdf-navigation">
                  <button
                    className="icon-button"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                    aria-label="Previous page"
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <span>
                    Page{' '}
                    <input
                      aria-label="PDF page"
                      type="number"
                      min={1}
                      max={pages || 1}
                      value={page}
                      onChange={(e) =>
                        setPage(Math.max(1, Math.min(pages, Number(e.target.value) || 1)))
                      }
                    />{' '}
                    of {pages || '…'}
                  </span>
                  <button
                    className="icon-button"
                    disabled={page >= pages}
                    onClick={() => setPage((p) => p + 1)}
                    aria-label="Next page"
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
                <canvas
                  ref={canvas}
                  className="pdf-canvas"
                  aria-label={`Original PDF page ${page}`}
                />
              </>
            )}
            {(item.kind === 'note' || item.kind === 'webpage') && (
              <pre className="original-text">{text}</pre>
            )}
            {item.kind === 'audio' && (
              <div className="audio-source">
                <p>Original audio</p>
                <audio
                  ref={(el) => {
                    media.current = el;
                  }}
                  src={url}
                  controls
                  onLoadedMetadata={seek}
                />
              </div>
            )}
            {item.kind === 'video' && (
              <video
                ref={(el) => {
                  media.current = el;
                }}
                src={url}
                controls
                playsInline
                onLoadedMetadata={seek}
              />
            )}
          </>
        )}
      </div>
      {blob && (
        <button
          className="button secondary source-download"
          onClick={() => downloadBlob(blob, item.originalName ?? `${item.title}.txt`)}
        >
          <ArrowDownToLine size={16} /> Download original
        </button>
      )}
      <button
        className="text-button"
        onClick={() =>
          void repository
            .exportItems([item.id])
            .then((archive) => downloadBlob(archive, `campus-recall-${item.id}.zip`))
            .catch((cause) => setError(cause.message))
        }
      >
        Export this item as backup
      </button>
    </section>
  );
}
