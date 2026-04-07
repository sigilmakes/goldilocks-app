import { useEffect, useRef, useState } from 'react';
import { ZoomIn, ZoomOut } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { getAuthHeaders, rawFileUrl } from '../../api/client';
import { useSettingsStore } from '../../store/settings';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

export default function PdfViewer({ path }: { path: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const renderGenerationRef = useRef(0);
  const defaultZoom = useSettingsStore((s) => s.workspaceViewer.pdfDefaultZoom);
  const theme = useSettingsStore((s) => s.theme);
  const [pageCount, setPageCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [scale, setScale] = useState(defaultZoom / 100);
  const [documentReady, setDocumentReady] = useState(false);

  useEffect(() => {
    setScale(defaultZoom / 100);
  }, [defaultZoom, path]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setLoading(true);
    setPageCount(0);
    setDocumentReady(false);
    pdfRef.current?.destroy();
    pdfRef.current = null;

    async function loadPdf() {
      try {
        const response = await fetch(rawFileUrl(path), { headers: getAuthHeaders() });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const bytes = new Uint8Array(await response.arrayBuffer());
        const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
        if (cancelled) {
          await pdf.destroy();
          return;
        }

        pdfRef.current = pdf;
        setPageCount(pdf.numPages);
        setDocumentReady(true);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        console.error('[PDF] Load error:', err);
        setError(err instanceof Error ? err.message : 'Failed to load PDF');
        setLoading(false);
      }
    }

    void loadPdf();
    return () => {
      cancelled = true;
      pdfRef.current?.destroy();
      pdfRef.current = null;
    };
  }, [path]);

  useEffect(() => {
    const host = containerRef.current;
    const loadedPdf = pdfRef.current;
    if (!host || !loadedPdf || !documentReady) return;
    const container = host;
    const pdf = loadedPdf;

    container.innerHTML = '';
    const generation = renderGenerationRef.current + 1;
    renderGenerationRef.current = generation;

    async function renderPdf() {
      for (let index = 1; index <= pdf.numPages; index += 1) {
        if (renderGenerationRef.current !== generation) return;

        const page = await pdf.getPage(index);
        if (renderGenerationRef.current !== generation) return;

        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.className = 'pdf-page-canvas';
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        container.appendChild(canvas);

        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        ctx.scale(dpr, dpr);
        await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      }
    }

    void renderPdf();
  }, [documentReady, scale]);

  return (
    <div className="h-full flex flex-col min-h-0 bg-slate-900/30">
      <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-slate-700 bg-slate-800/70">
        <div className="text-sm text-slate-300 truncate min-w-0">{path.split('/').pop() ?? path}</div>
        <div className="flex items-center gap-2 text-sm text-slate-400 flex-shrink-0">
          {pageCount > 0 && <span>{pageCount} pages</span>}
          <button
            onClick={() => setScale((current) => Math.max(0.5, current - 0.25))}
            className="p-1.5 rounded border border-slate-600 bg-slate-700 hover:bg-slate-600 text-slate-200"
            title="Zoom out"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="w-14 text-center">{Math.round(scale * 100)}%</span>
          <button
            onClick={() => setScale((current) => Math.min(4, current + 0.25))}
            className="p-1.5 rounded border border-slate-600 bg-slate-700 hover:bg-slate-600 text-slate-200"
            title="Zoom in"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
        </div>
      </div>

      {error ? (
        <div className="flex-1 flex items-center justify-center p-6 text-red-400 text-sm text-center">
          {error}
        </div>
      ) : loading ? (
        <div className="flex-1 flex items-center justify-center p-6 text-slate-400 text-sm italic">
          Loading PDF…
        </div>
      ) : null}

      <div
        ref={containerRef}
        className={`flex-1 overflow-auto p-6 space-y-4 ${theme === 'dark' ? 'bg-slate-900/30' : 'bg-slate-900/10'}`}
      />
    </div>
  );
}
