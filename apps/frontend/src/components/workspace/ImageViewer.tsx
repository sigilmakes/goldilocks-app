import { useEffect, useMemo, useState } from 'react';
import { Maximize, ZoomIn, ZoomOut } from 'lucide-react';
import { getAuthHeaders, rawFileUrl } from '../../api/client';
import { useSettingsStore } from '../../store/settings';

function backgroundStyle(background: 'checkered' | 'dark' | 'light') {
  if (background === 'dark') {
    return { backgroundColor: 'rgba(15, 23, 42, 0.45)' };
  }
  if (background === 'light') {
    return { backgroundColor: 'rgba(248, 250, 252, 0.92)' };
  }
  return {
    backgroundColor: '#e2e8f0',
    backgroundImage:
      'linear-gradient(45deg, rgba(148,163,184,0.22) 25%, transparent 25%), linear-gradient(-45deg, rgba(148,163,184,0.22) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(148,163,184,0.22) 75%), linear-gradient(-45deg, transparent 75%, rgba(148,163,184,0.22) 75%)',
    backgroundSize: '24px 24px',
    backgroundPosition: '0 0, 0 12px, 12px -12px, -12px 0px',
  };
}

export default function ImageViewer({ path }: { path: string }) {
  const { imageBackground, imageFitMode } = useSettingsStore((s) => s.workspaceViewer);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [scale, setScale] = useState(imageFitMode === 'actual' ? 1 : 0.95);

  useEffect(() => {
    setScale(imageFitMode === 'actual' ? 1 : 0.95);
  }, [imageFitMode, path]);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setLoading(true);

    fetch(rawFileUrl(path), { headers: getAuthHeaders() })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setBlobUrl(null);
        setLoading(false);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);

  const viewerBackground = useMemo(() => backgroundStyle(imageBackground), [imageBackground]);

  if (loading) {
    return <div className="flex items-center justify-center h-full text-sm text-slate-400 italic p-4">Loading image…</div>;
  }

  if (!blobUrl) {
    return <div className="flex items-center justify-center h-full text-sm text-slate-400 italic p-4">Failed to load image</div>;
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center justify-end gap-2 px-4 py-2 border-b border-slate-700 bg-slate-800/70">
        <button
          onClick={() => setScale((current) => Math.max(0.1, current - 0.1))}
          className="p-1.5 rounded border border-slate-600 bg-slate-700 hover:bg-slate-600 text-slate-200"
          title="Zoom out"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <span className="text-sm text-slate-300 w-14 text-center">{Math.round(scale * 100)}%</span>
        <button
          onClick={() => setScale((current) => Math.min(4, current + 0.1))}
          className="p-1.5 rounded border border-slate-600 bg-slate-700 hover:bg-slate-600 text-slate-200"
          title="Zoom in"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <button
          onClick={() => setScale(imageFitMode === 'actual' ? 1 : 0.95)}
          className="p-1.5 rounded border border-slate-600 bg-slate-700 hover:bg-slate-600 text-slate-200"
          title="Reset zoom"
        >
          <Maximize className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-auto p-6" style={viewerBackground}>
        <div className="min-h-full min-w-full flex items-center justify-center">
          <img
            src={blobUrl}
            alt={path.split('/').pop() ?? path}
            className={imageFitMode === 'contain' ? 'max-w-full max-h-full rounded-lg shadow-lg' : 'rounded-lg shadow-lg'}
            style={{
              transform: `scale(${scale})`,
              transformOrigin: 'center center',
            }}
          />
        </div>
      </div>
    </div>
  );
}
