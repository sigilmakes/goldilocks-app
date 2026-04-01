import { useEffect, useRef, useState, useCallback } from 'react';
import { Box, Maximize2 } from 'lucide-react';

// 3Dmol exports named functions, not a default export
import * as $3Dmol from '3dmol';

type ViewStyle = 'ball-stick' | 'spacefill' | 'wireframe' | 'stick';

interface StructureViewerProps {
  cifData: string | null;
}

export default function StructureViewer({ cifData }: StructureViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<unknown>(null);
  const [activeStyle, setActiveStyle] = useState<ViewStyle>('ball-stick');
  const [error, setError] = useState<string | null>(null);

  const applyStyle = useCallback((viewer: unknown, style: ViewStyle) => {
    const v = viewer as {
      setStyle: (sel: object, style: object) => void;
      render: () => void;
    };
    switch (style) {
      case 'ball-stick':
        v.setStyle({}, { stick: { radius: 0.15 }, sphere: { scale: 0.3 } });
        break;
      case 'spacefill':
        v.setStyle({}, { sphere: { scale: 1.0 } });
        break;
      case 'wireframe':
        v.setStyle({}, { line: { linewidth: 2 } });
        break;
      case 'stick':
        v.setStyle({}, { stick: { radius: 0.2 } });
        break;
    }
    v.render();
  }, []);

  // Combined effect: create viewer AND load model whenever cifData changes
  useEffect(() => {
    if (!containerRef.current || !cifData) {
      // Clean up old viewer if cifData goes null
      if (viewerRef.current) {
        try {
          (viewerRef.current as { clear: () => void }).clear();
        } catch { /* ignore */ }
        viewerRef.current = null;
      }
      // Clear any leftover canvas elements
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
      return;
    }

    const container = containerRef.current;
    setError(null);

    // Store wheel handler ref for cleanup
    let wheelHandler: ((e: WheelEvent) => void) | null = null;

    // 3Dmol needs the container to have explicit pixel dimensions.
    // Use a small delay to ensure the container is laid out.
    const timer = setTimeout(() => {
      const rect = container.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        setError('Viewer container has no size');
        return;
      }

      // Clear previous viewer
      if (viewerRef.current) {
        try {
          (viewerRef.current as { clear: () => void }).clear();
        } catch { /* ignore */ }
        viewerRef.current = null;
      }
      container.innerHTML = '';

      try {
        // Create viewer with explicit dimensions
        const viewer = $3Dmol.createViewer(container, {
          backgroundColor: '0x1e293b',
          antialias: true,
          // @ts-ignore — type mismatch in 3Dmol definitions
          defaultcolors: $3Dmol.elementColors.rasmol,
        });

        // Invert scroll zoom: 3Dmol zooms opposite to natural scroll direction.
        // Store handler ref for cleanup on viewer recreation (§4.9)
        wheelHandler = (e: WheelEvent) => {
          e.preventDefault();
          e.stopImmediatePropagation();
          const scaleFactor = 0.002;
          const delta = e.deltaY * scaleFactor;
          viewer.zoom(1 - delta, 100);
        };
        container.addEventListener('wheel', wheelHandler, { capture: true, passive: false });

        viewer.addModel(cifData, 'cif');

        try {
          viewer.addUnitCell();
        } catch {
          // Some CIF files don't support unit cell rendering
        }

        applyStyle(viewer, activeStyle);
        viewer.zoomTo();
        viewer.render();

        viewerRef.current = viewer;
      } catch (e) {
        console.error('3Dmol error:', e);
        setError(e instanceof Error ? e.message : 'Failed to render structure');
      }
    }, 100);

    return () => {
      clearTimeout(timer);
      // Clean up wheel listener to prevent accumulation (§4.9)
      if (wheelHandler) {
        container.removeEventListener('wheel', wheelHandler, { capture: true } as EventListenerOptions);
      }
    };
  }, [cifData]); // Only re-create when cifData changes

  // Apply style changes without recreating the viewer
  useEffect(() => {
    if (viewerRef.current) {
      applyStyle(viewerRef.current, activeStyle);
    }
  }, [activeStyle, applyStyle]);

  // Resize viewer when container size changes (e.g. sidebar resize)
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !viewerRef.current) return;

    const observer = new ResizeObserver(() => {
      const viewer = viewerRef.current as {
        resize: () => void;
        render: () => void;
      } | null;
      if (viewer) {
        viewer.resize();
        viewer.render();
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [cifData]); // re-attach when cifData changes (viewer recreated)

  const handleZoomToFit = () => {
    const viewer = viewerRef.current as {
      zoomTo: () => void;
      render: () => void;
    } | null;
    if (viewer) {
      viewer.zoomTo();
      viewer.render();
    }
  };

  const styleButtons: { id: ViewStyle; label: string }[] = [
    { id: 'ball-stick', label: 'Ball & Stick' },
    { id: 'spacefill', label: 'Spacefill' },
    { id: 'wireframe', label: 'Wireframe' },
    { id: 'stick', label: 'Stick' },
  ];

  if (!cifData) {
    return (
      <div className="aspect-square bg-slate-700 rounded-lg flex items-center justify-center border border-slate-600 border-dashed">
        <div className="text-center text-slate-400">
          <Box className="w-12 h-12 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No structure loaded</p>
          <p className="text-xs mt-1">Upload a CIF file to visualize</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Viewer container — aspect-ratio keeps it square-ish, but it stretches with parent width */}
      <div className="relative bg-slate-800 rounded-lg overflow-hidden border border-slate-600" style={{ aspectRatio: '1', width: '100%' }}>
        <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }} />
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-800/80">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}
        {/* Zoom to fit button */}
        <button
          onClick={handleZoomToFit}
          className="absolute top-2 right-2 p-1.5 bg-slate-700/80 hover:bg-slate-600 rounded text-slate-300 hover:text-white transition-colors z-10"
          title="Zoom to fit"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
      </div>

      {/* Style toggle buttons */}
      <div className="flex gap-1">
        {styleButtons.map((btn) => (
          <button
            key={btn.id}
            onClick={() => setActiveStyle(btn.id)}
            className={`flex-1 px-2 py-1 text-xs rounded transition-colors ${
              activeStyle === btn.id
                ? 'bg-amber-500 text-white'
                : 'bg-slate-700 text-slate-400 hover:bg-slate-600 hover:text-slate-300'
            }`}
          >
            {btn.label}
          </button>
        ))}
      </div>
    </div>
  );
}
