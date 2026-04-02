import { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Settings2, Files, Upload, Download, Trash2, FileText } from 'lucide-react';
import { useFilesStore, type WorkspaceFile } from '../../store/files';
import { useAuthStore } from '../../store/auth';
import { useToastStore } from '../../store/toast';
import { FileListSkeleton } from '../ui/Skeleton';
import StructureViewer from '../science/StructureViewer';

type Tab = 'structure' | 'parameters' | 'files';

export default function ContextPanel() {
  const [activeTab, setActiveTab] = useState<Tab>('files');

  const tabs = [
    { id: 'structure' as Tab, label: 'Structure', icon: Box },
    { id: 'parameters' as Tab, label: 'Parameters', icon: Settings2 },
    { id: 'files' as Tab, label: 'Files', icon: Files },
  ];

  return (
    <div className="h-full flex flex-col">
      {/* Tab bar */}
      <div className="flex border-b border-slate-700">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-sm transition-colors ${
              activeTab === tab.id
                ? 'text-amber-500 border-b-2 border-amber-500 bg-slate-700/50'
                : 'text-slate-400 hover:text-slate-300 hover:bg-slate-700/30'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            <span className="hidden lg:inline">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'structure' && <StructureTab />}
        {activeTab === 'parameters' && <ParametersTab />}
        {activeTab === 'files' && <FilesTab />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Structure Tab
// ---------------------------------------------------------------------------

function StructureTab() {
  const [cifData, setCifData] = useState<string | null>(null);
  const files = useFilesStore((s) => s.files);

  // Load CIF data from workspace files
  useEffect(() => {
    const cifFile = files.find((f) => f.name.toLowerCase().endsWith('.cif'));
    if (cifFile) {
      const token = useAuthStore.getState().token;
      fetch(`/api/files/${cifFile.name}/content`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .then((data) => setCifData(data.content))
        .catch((err) => {
          console.error('Failed to load CIF:', err);
          setCifData(null);
        });
    } else {
      setCifData(null);
    }
  }, [files]);

  return (
    <div className="space-y-4">
      <StructureViewer cifData={cifData} />

      {!cifData && (
        <div className="bg-slate-700/50 rounded-lg p-3">
          <p className="text-sm text-slate-400">
            Upload a CIF file to visualize the crystal structure.
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Parameters Tab
// ---------------------------------------------------------------------------

function ParametersTab() {
  const [functional, setFunctional] = useState<'PBEsol' | 'PBE'>('PBEsol');
  const [pseudoMode, setPseudoMode] = useState<'efficiency' | 'precision'>('efficiency');

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-1.5">
          Functional
        </label>
        <select
          value={functional}
          onChange={(e) => setFunctional(e.target.value as 'PBEsol' | 'PBE')}
          className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
        >
          <option value="PBEsol">PBEsol</option>
          <option value="PBE">PBE</option>
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-300 mb-1.5">
          Pseudopotential Mode
        </label>
        <select
          value={pseudoMode}
          onChange={(e) => setPseudoMode(e.target.value as 'efficiency' | 'precision')}
          className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
        >
          <option value="efficiency">Efficiency</option>
          <option value="precision">Precision</option>
        </select>
      </div>

      <div className="bg-slate-700/50 rounded-lg p-3">
        <p className="text-xs text-slate-400">
          These parameters are available for the agent to use when generating
          Quantum ESPRESSO input files. Ask the agent to generate an input file
          and it will use these settings.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Files Tab
// ---------------------------------------------------------------------------

function FilesTab() {
  const { files, isLoading, error, fetch, upload, remove } = useFilesStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    if (isAuthenticated) {
      fetch();
    }
  }, [isAuthenticated, fetch]);

  const addToast = useToastStore((s) => s.addToast);

  const handleFileSelect = useCallback(async (selectedFiles: FileList | null) => {
    if (!selectedFiles) return;

    for (const file of Array.from(selectedFiles)) {
      try {
        await upload(file);
        addToast(`Uploaded ${file.name}`, 'success');
      } catch (err) {
        console.error('Upload failed:', err);
        addToast(`Failed to upload ${file.name}`, 'error');
      }
    }
  }, [upload, addToast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFileSelect(e.dataTransfer.files);
  }, [handleFileSelect]);

  const handleDelete = async (filename: string) => {
    if (confirm(`Delete ${filename}?`)) {
      try {
        await remove(filename);
        addToast(`Deleted ${filename}`, 'success');
      } catch (err) {
        console.error('Delete failed:', err);
        addToast(`Failed to delete ${filename}`, 'error');
      }
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-4">
      {/* Upload dropzone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
          isDragging
            ? 'border-amber-500 bg-amber-500/10'
            : 'border-slate-600 hover:border-amber-500/50'
        }`}
      >
        <Upload className="w-8 h-8 mx-auto text-slate-400 mb-2" />
        <p className="text-sm text-slate-300">Drop files here or click to upload</p>
        <p className="text-xs text-slate-500 mt-1">CIF, POSCAR, XYZ, or JSON files</p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".cif,.poscar,.vasp,.xyz,.pdb,.json,.txt,.in,.out"
          className="hidden"
          onChange={(e) => handleFileSelect(e.target.files)}
        />
      </div>

      {error && (
        <div className="p-2 bg-red-500/10 border border-red-500/30 rounded text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* File list */}
      {isLoading ? (
        <FileListSkeleton count={3} />
      ) : files.length === 0 ? (
        <div className="bg-slate-700/50 rounded-lg p-3 text-center">
          <p className="text-sm text-slate-400">No files in workspace</p>
        </div>
      ) : (
        <div className="space-y-1">
          {files.map((file) => (
            <FileItem
              key={file.name}
              file={file}
              onDelete={() => handleDelete(file.name)}
              formatSize={formatSize}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FileItem({
  file,
  onDelete,
  formatSize,
}: {
  file: WorkspaceFile;
  onDelete: () => void;
  formatSize: (bytes: number) => string;
}) {
  const isCif = file.name.toLowerCase().endsWith('.cif');

  return (
    <div className="flex items-center gap-2 p-2 bg-slate-700/50 rounded-lg group">
      <FileText className={`w-4 h-4 flex-shrink-0 ${isCif ? 'text-amber-500' : 'text-slate-400'}`} />
      <div className="flex-1 min-w-0">
        <div className="text-sm text-slate-200 truncate">{file.name}</div>
        <div className="text-xs text-slate-500">{formatSize(file.size)}</div>
      </div>
      <button
        onClick={async () => {
          const token = useAuthStore.getState().token;
          try {
            const res = await window.fetch(`/api/files/${file.name}/content`, {
              headers: token ? { Authorization: `Bearer ${token}` } : {},
            });
            if (!res.ok) return;
            const { content } = await res.json();
            const blob = new Blob([content], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = file.name;
            a.click();
            URL.revokeObjectURL(url);
          } catch (err) {
            console.error('Download failed:', err);
          }
        }}
        className="p-1 opacity-0 group-hover:opacity-100 hover:bg-slate-600 rounded transition-all"
        title="Download"
      >
        <Download className="w-4 h-4 text-slate-400" />
      </button>
      <button
        onClick={onDelete}
        className="p-1 opacity-0 group-hover:opacity-100 hover:bg-slate-600 rounded transition-all"
        title="Delete"
      >
        <Trash2 className="w-4 h-4 text-slate-400 hover:text-red-400" />
      </button>
    </div>
  );
}
