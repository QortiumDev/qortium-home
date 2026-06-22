import {
  ChevronLeft,
  ChevronRight,
  Download,
  List,
  Minus,
  Plus,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { openArchive } from './archive';
import { t } from './i18n';
import type { QdnDisplaySettings, QdnResource } from './qdn';

export type DocumentFormat = 'cbz' | 'epub' | 'pdf' | 'txt' | 'unsupported';

const DOCUMENT_VIEWER_MAX_BYTES = 100 * 1024 * 1024;

export function detectDocumentFormat(filename?: string, mimeType?: string): DocumentFormat {
  const ext = (filename ?? '').split('.').pop()?.toLowerCase() ?? '';
  const mime = (mimeType ?? '').toLowerCase();

  if (ext === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (ext === 'epub' || mime === 'application/epub+zip') return 'epub';
  // CBZ (zip) and CBR (rar) are the same comic-page idea with a different
  // container; both resolve to the internal 'cbz' comic path, which sniffs the
  // real archive type by magic bytes at extraction time.
  if (
    ext === 'cbz' ||
    ext === 'cbr' ||
    mime === 'application/vnd.comicbook+zip' ||
    mime === 'application/x-cbz' ||
    mime === 'application/vnd.comicbook-rar' ||
    mime === 'application/x-cbr'
  ) {
    return 'cbz';
  }
  if (ext === 'txt' || mime.startsWith('text/')) return 'txt';

  return 'unsupported';
}

const COMIC_IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp)$/i;

// Extract the ordered comic pages from a CBZ/CBR archive. The shared archive
// decoder picks ZIP vs RAR by magic bytes (so mislabeled .cbz/.cbr both open);
// here we keep only image entries, order them numerically ("page2" before
// "page10"), and turn each into a page object-URL to revoke on cleanup.
async function extractComicPages(bytes: Uint8Array): Promise<string[]> {
  const { entries } = await openArchive(bytes);
  const images = entries
    .filter((entry) => !entry.dir && COMIC_IMAGE_EXT.test(entry.name))
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' }));

  // Read every page first, then mint object-URLs. Doing the reads up front means a
  // failure leaves zero URLs created (Promise.all rejects before the map), so the
  // caller never leaks partially-created pages.
  const pageBytes = await Promise.all(images.map((entry) => entry.read()));
  return pageBytes.map((data) => URL.createObjectURL(new Blob([data as BlobPart])));
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ----- Minimal types for lazy-loaded libraries -----

type PdfDoc = {
  numPages: number;
  destroy: () => Promise<void>;
  getPage: (num: number) => Promise<PdfPage>;
};

type PdfPage = {
  getViewport: (opts: { scale: number }) => PdfViewport;
  render: (ctx: { canvasContext: CanvasRenderingContext2D; viewport: PdfViewport }) => { promise: Promise<void> };
};

type PdfViewport = { height: number; width: number };

export type EpubTocItem = {
  href: string;
  label: string;
  subitems?: EpubTocItem[];
};

type EpubBook = {
  destroy: () => void;
  loaded: { navigation: Promise<{ toc: EpubTocItem[] }> };
  renderTo: (element: HTMLElement, opts: object) => EpubRendition;
};

type EpubRendition = {
  display: (target?: string) => Promise<void>;
  next: () => Promise<void>;
  off: (event: string, handler: (...args: unknown[]) => void) => void;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  prev: () => Promise<void>;
  themes: { fontSize: (size: string) => void };
};

// ----- Sub-components -----

function TxtViewer({ content, zoom }: { content: string; zoom: number }) {
  return (
    <div className="doc-viewer__content">
      <pre className="doc-viewer__txt-body" style={{ fontSize: `${zoom}%` }}>
        {content}
      </pre>
    </div>
  );
}

function PdfViewer({ doc, page, zoom }: { doc: PdfDoc; page: number; zoom: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let canceled = false;
    const canvas = canvasRef.current;
    if (!canvas) return;

    doc.getPage(page).then((pdfPage) => {
      if (canceled) return;
      const dpr = window.devicePixelRatio || 1;
      const viewport = pdfPage.getViewport({ scale: (zoom / 100) * dpr });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${viewport.width / dpr}px`;
      canvas.style.height = `${viewport.height / dpr}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx || canceled) return;
      pdfPage.render({ canvasContext: ctx, viewport }).promise.catch(() => {});
    });

    return () => {
      canceled = true;
    };
  }, [doc, page, zoom]);

  return (
    <div className="doc-viewer__content">
      <div className="doc-viewer__pdf-canvas-wrap">
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}

function EpubViewer({
  book,
  onRenditionReady,
}: {
  book: EpubBook;
  onRenditionReady: (rendition: EpubRendition) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onReadyRef = useRef(onRenditionReady);
  onReadyRef.current = onRenditionReady;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const rendition = book.renderTo(container, { width: '100%', height: '100%' });
    rendition.display().then(() => onReadyRef.current(rendition));
  }, [book]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="doc-viewer__content">
      <div ref={containerRef} className="doc-viewer__epub-frame" />
    </div>
  );
}

function CbzViewer({ page, pages, zoom }: { page: number; pages: string[]; zoom: number }) {
  const src = pages[page - 1];
  if (!src) return null;
  return (
    <div className="doc-viewer__content">
      <div className="doc-viewer__cbz-stage">
        <img
          alt={t('docViewer.page', { current: String(page), total: String(pages.length) })}
          className="doc-viewer__cbz-img"
          src={src}
          style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top center' }}
        />
      </div>
    </div>
  );
}

function StatusContent({ children, message }: { children?: ReactNode; message: string }) {
  return (
    <div className="doc-viewer__content doc-viewer__content--status">
      <p className="doc-viewer__status-text">{message}</p>
      {children}
    </div>
  );
}

// ----- Viewer state -----

type ViewerState =
  | { format: 'cbz'; pageCount: number; pages: string[]; phase: 'ready' }
  | { book: EpubBook; format: 'epub'; phase: 'ready'; toc: EpubTocItem[] }
  | { content: string; format: 'txt'; phase: 'ready' }
  | { doc: PdfDoc; format: 'pdf'; pageCount: number; phase: 'ready' }
  | { format: 'unsupported'; phase: 'ready' }
  | { message: string; phase: 'error' }
  | { message: string; phase: 'loading' };

// ----- Main component -----

type DocumentViewerProps = {
  /** In-memory bytes to render instead of fetching from the node (archive entry). */
  bytes?: Uint8Array;
  displaySettings: QdnDisplaySettings;
  onDismiss: () => void;
  resource: QdnResource;
};

export function DocumentViewer({ bytes: providedBytes, onDismiss, resource }: DocumentViewerProps) {
  const [state, setState] = useState<ViewerState>({ message: t('viewer.loadingResource'), phase: 'loading' });
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(100);
  const [tocOpen, setTocOpen] = useState(false);
  const [epubRendition, setEpubRendition] = useState<EpubRendition | null>(null);
  const [epubChapter, setEpubChapter] = useState('');

  useEffect(() => {
    let canceled = false;
    let cleanup: (() => void) | null = null;

    async function load() {
      try {
        setState({ message: t('viewer.loadingResource'), phase: 'loading' });
        setPage(1);
        setZoom(100);
        setTocOpen(false);
        setEpubRendition(null);
        setEpubChapter('');

        let bytes: Uint8Array;
        let contentType: string | undefined;

        if (providedBytes) {
          // Rendering an already-extracted archive entry — no node fetch.
          bytes = providedBytes;
        } else {
          const result = await window.qortiumHome.qdn.fetchResourceData({
            identifier: resource.identifier,
            maxBytes: DOCUMENT_VIEWER_MAX_BYTES,
            name: resource.name,
            path: resource.path || undefined,
            service: resource.service,
          });

          if (canceled) return;

          if (result.tooLarge) {
            const limit = `${Math.round(DOCUMENT_VIEWER_MAX_BYTES / (1024 * 1024))} MB`;
            setState({ message: t('docViewer.tooLarge', { limit }), phase: 'error' });
            return;
          }

          bytes = base64ToUint8Array(result.data);
          contentType = result.contentType;
        }

        const filename = resource.path ? resource.path.split('/').pop() : undefined;
        const format = detectDocumentFormat(filename, contentType);

        if (format === 'txt') {
          const content = new TextDecoder().decode(bytes);
          if (!canceled) setState({ content, format: 'txt', phase: 'ready' });
          return;
        }

        if (format === 'pdf') {
          const pdfjs = await import('pdfjs-dist');
          if (canceled) return;
          pdfjs.GlobalWorkerOptions.workerSrc = new URL(
            'pdfjs-dist/build/pdf.worker.mjs',
            import.meta.url,
          ).toString();
          const raw = await pdfjs.getDocument({ data: bytes }).promise;
          const doc = raw as unknown as PdfDoc;
          if (canceled) { void doc.destroy(); return; }
          cleanup = () => { void doc.destroy(); };
          setState({ doc, format: 'pdf', pageCount: doc.numPages, phase: 'ready' });
          return;
        }

        if (format === 'epub') {
          const { default: ePub } = await import('epubjs');
          if (canceled) return;
          const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/epub+zip' });
          const blobUrl = URL.createObjectURL(blob);
          const book = ePub(blobUrl) as unknown as EpubBook;
          const nav = await book.loaded.navigation;
          if (canceled) { book.destroy(); URL.revokeObjectURL(blobUrl); return; }
          cleanup = () => { book.destroy(); URL.revokeObjectURL(blobUrl); };
          setState({ book, format: 'epub', phase: 'ready', toc: nav.toc ?? [] });
          return;
        }

        if (format === 'cbz') {
          const pages = await extractComicPages(bytes);
          if (canceled) { pages.forEach(URL.revokeObjectURL); return; }
          cleanup = () => { pages.forEach(URL.revokeObjectURL); };
          setState({ format: 'cbz', pageCount: pages.length, pages, phase: 'ready' });
          return;
        }

        if (!canceled) setState({ format: 'unsupported', phase: 'ready' });
      } catch {
        if (!canceled) setState({ message: t('docViewer.error'), phase: 'error' });
      }
    }

    void load();

    return () => {
      canceled = true;
      cleanup?.();
    };
  }, [providedBytes, resource]);

  // Track EPUB location changes
  useEffect(() => {
    if (!epubRendition) return;
    const handler = (...args: unknown[]) => {
      const location = args[0];
      if (location && typeof location === 'object' && 'start' in location) {
        const start = (location as { start: unknown }).start;
        if (start && typeof start === 'object' && 'index' in start) {
          setPage((start as { index: number }).index + 1);
        }
      }
    };
    epubRendition.on('relocated', handler);
    return () => epubRendition.off('relocated', handler);
  }, [epubRendition]);

  // Apply EPUB zoom
  useEffect(() => {
    epubRendition?.themes.fontSize(`${zoom}%`);
  }, [epubRendition, zoom]);

  function goToPrev() {
    if (state.phase !== 'ready') return;
    if (state.format === 'epub') { void epubRendition?.prev(); return; }
    setPage((p) => Math.max(1, p - 1));
  }

  function goToNext() {
    if (state.phase !== 'ready') return;
    if (state.format === 'epub') { void epubRendition?.next(); return; }
    if (state.format === 'pdf') { setPage((p) => Math.min(state.pageCount, p + 1)); return; }
    if (state.format === 'cbz') { setPage((p) => Math.min(state.pageCount, p + 1)); return; }
  }

  async function handleDownload() {
    await window.qortiumHome.qdn.downloadResource({
      identifier: resource.identifier,
      name: resource.name,
      path: resource.path || undefined,
      service: resource.service,
    });
  }

  const toc: EpubTocItem[] =
    state.phase === 'ready' && state.format === 'epub' ? state.toc : [];

  const total: number | null =
    state.phase === 'ready' && state.format === 'pdf'
      ? state.pageCount
      : state.phase === 'ready' && state.format === 'cbz'
        ? state.pageCount
        : null;

  const showNav =
    state.phase === 'ready' &&
    (state.format === 'pdf' || state.format === 'epub' || state.format === 'cbz');

  const showZoom = state.phase === 'ready' && state.format !== 'unsupported';

  const formatLabel =
    state.phase === 'ready'
      ? state.format === 'pdf'
        ? t('docViewer.format.pdf')
        : state.format === 'epub'
          ? t('docViewer.format.epub')
          : state.format === 'cbz'
            ? t('docViewer.format.comic')
            : state.format === 'txt'
              ? t('docViewer.format.txt')
              : ''
      : '';

  const centerLabel = epubChapter || formatLabel;

  return (
    <section
      aria-label={t('docViewer.dialogLabel')}
      aria-modal="true"
      className="doc-viewer-dialog"
      role="dialog"
    >
      <header className="doc-viewer__toolbar">
        <div className="doc-viewer__toolbar-left">
          {showNav && (
            <>
              <button
                aria-label={t('docViewer.prevPage')}
                className="icon-button doc-viewer__nav-btn"
                disabled={state.format !== 'epub' && page <= 1}
                type="button"
                onClick={goToPrev}
              >
                <ChevronLeft aria-hidden="true" size={16} strokeWidth={2} />
              </button>
              <span className="doc-viewer__page-indicator">
                {total !== null
                  ? t('docViewer.page', { current: String(page), total: String(total) })
                  : String(page)}
              </span>
              <button
                aria-label={t('docViewer.nextPage')}
                className="icon-button doc-viewer__nav-btn"
                disabled={state.format !== 'epub' && total !== null && page >= total}
                type="button"
                onClick={goToNext}
              >
                <ChevronRight aria-hidden="true" size={16} strokeWidth={2} />
              </button>
            </>
          )}
        </div>

        <div className="doc-viewer__toolbar-center">
          <span className="doc-viewer__format-label">{centerLabel}</span>
        </div>

        <div className="doc-viewer__toolbar-right">
          {toc.length > 0 && (
            <button
              aria-label={t('docViewer.tableOfContents')}
              aria-pressed={tocOpen}
              className="icon-button"
              type="button"
              onClick={() => setTocOpen((v) => !v)}
            >
              <List aria-hidden="true" size={16} strokeWidth={2} />
            </button>
          )}
          {showZoom && (
            <>
              <button
                aria-label={t('docViewer.zoomOut')}
                className="icon-button"
                type="button"
                onClick={() => setZoom((z) => Math.max(25, z - 25))}
              >
                <Minus aria-hidden="true" size={16} strokeWidth={2} />
              </button>
              <span className="doc-viewer__zoom-level">
                {t('docViewer.zoomLevel', { percent: String(zoom) })}
              </span>
              <button
                aria-label={t('docViewer.zoomIn')}
                className="icon-button"
                type="button"
                onClick={() => setZoom((z) => Math.min(400, z + 25))}
              >
                <Plus aria-hidden="true" size={16} strokeWidth={2} />
              </button>
            </>
          )}
          <button
            aria-label={t('docViewer.download')}
            className="icon-button"
            type="button"
            onClick={() => { void handleDownload(); }}
          >
            <Download aria-hidden="true" size={16} strokeWidth={2} />
          </button>
          <button
            aria-label={t('docViewer.close')}
            className="icon-button"
            type="button"
            onClick={onDismiss}
          >
            <X aria-hidden="true" size={16} strokeWidth={2} />
          </button>
        </div>
      </header>

      {tocOpen && toc.length > 0 && (
        <nav aria-label={t('docViewer.tableOfContents')} className="doc-viewer__toc-panel">
          <ul className="doc-viewer__toc-list">
            {toc.map((item) => (
              <li key={item.href} className="doc-viewer__toc-item">
                <button
                  className="doc-viewer__toc-link"
                  type="button"
                  onClick={() => {
                    void epubRendition?.display(item.href);
                    setEpubChapter(item.label.trim());
                    setTocOpen(false);
                  }}
                >
                  {item.label.trim()}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {state.phase === 'loading' && <StatusContent message={state.message} />}

      {state.phase === 'error' && (
        <StatusContent message={state.message}>
          <button className="button" type="button" onClick={() => { void handleDownload(); }}>
            {t('docViewer.download')}
          </button>
        </StatusContent>
      )}

      {state.phase === 'ready' && state.format === 'txt' && (
        <TxtViewer content={state.content} zoom={zoom} />
      )}

      {state.phase === 'ready' && state.format === 'pdf' && (
        <PdfViewer doc={state.doc} page={page} zoom={zoom} />
      )}

      {state.phase === 'ready' && state.format === 'epub' && (
        <EpubViewer book={state.book} onRenditionReady={setEpubRendition} />
      )}

      {state.phase === 'ready' && state.format === 'cbz' && (
        <CbzViewer page={page} pages={state.pages} zoom={zoom} />
      )}

      {state.phase === 'ready' && state.format === 'unsupported' && (
        <StatusContent message={t('docViewer.unsupported')}>
          <button className="button" type="button" onClick={() => { void handleDownload(); }}>
            {t('docViewer.download')}
          </button>
        </StatusContent>
      )}
    </section>
  );
}
