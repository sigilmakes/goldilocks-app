import { useEffect, useRef, useState, useCallback } from 'react';
import { Box, Maximize2 } from 'lucide-react';

// @ts-ignore — 3Dmol has no type declarations
import $3Dmol from '3dmol';

type ViewStyle = 'ball-stick' | 'spacefill' | 'wireframe' | 'stick';

interface StructureViewerProps {
  cifData: string | null;
}

export default function StructureViewer({ cifData }: StructureViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<unknown>(null);
  const [activeStyle, setActiveStyle] = useState<ViewStyle>('ball-stick');

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

  // Initialize viewer
  useEffect(() => {
    if (!containerRef.current) return;

    const viewer = $3Dmol.createViewer(containerRef.current, {
      backgroundColor: '0x1e293b', // slate-800
      antialias: true,
    });

    viewerRef.current = viewer;

    return () => {
      if (viewerRef.current) {
        (viewerRef.current as { clear: () => void }).clear();
        viewerRef.current = null;
      }
    };
  }, []);

  // Load CIF data when it changes
  useEffect(() => {
    const viewer = viewerRef.current as {
      removeAllModels: () => void;
      addModel: (data: string, format: string) => void;
      addUnitCell: () => void;
      setStyle: (sel: object, style: object) => void;
      zoomTo: () => void;
      render: () => void;
    } | null;

    if (!viewer) return;

    viewer.removeAllModels();

    if (cifData) {
      viewer.addModel(cifData, 'cif');
      try {
        viewer.addUnitCell();
      } catch {
        // Some CIF files may not support unit cell rendering
      }
      applyStyle(viewer, activeStyle);
      viewer.zoomTo();
      viewer.render();
    } else {
      viewer.render();
    }
  }, [cifData, applyStyle, activeStyle]);

  const handleStyleChange = (style: ViewStyle) => {
    setActiveStyle(style);
    if (viewerRef.current) {
      applyStyle(viewerRef.current, style);
    }
  };

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
      {/* Viewer container */}
      <div className="relative aspect-square bg-slate-800 rounded-lg overflow-hidden border border-slate-600">
        <div ref={containerRef} className="w-full h-full" />
        {/* Zoom to fit button */}
        <button
          onClick={handleZoomToFit}
          className="absolute top-2 right-2 p-1.5 bg-slate-700/80 hover:bg-slate-600 rounded text-slate-300 hover:text-white transition-colors"
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
            onClick={() => handleStyleChange(btn.id)}
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
