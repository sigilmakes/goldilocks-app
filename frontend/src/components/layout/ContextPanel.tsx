import { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Settings2, Files, Upload, Download, Trash2, Loader2, FileText, Zap } from 'lucide-react';
import { useConversationsStore } from '../../store/conversations';
import { useFilesStore, type WorkspaceFile } from '../../store/files';
import { useContextStore } from '../../store/context';
import { api } from '../../api/client';
import StructureViewer from '../science/StructureViewer';
import PredictionSummary from '../science/PredictionSummary';
import { useToastStore } from '../../store/toast';
import { FileListSkeleton } from '../ui/Skeleton';

type Tab = 'structure' | 'parameters' | 'files';

export default function ContextPanel() {
  const [activeTab, setActiveTab] = useState<Tab>('files');
  const activeConversationId = useConversationsStore((s) => s.activeConversationId);

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
        {activeTab === 'structure' && <StructureTab conversationId={activeConversationId} />}
        {activeTab === 'parameters' && <ParametersTab />}
        {activeTab === 'files' && <FilesTab conversationId={activeConversationId} />}
      </div>
    </div>
  );
}

function StructureTab({ conversationId }: { conversationId: string | null }) {
  const [cifData, setCifData] = useState<string | null>(null);
  const structure = useContextStore((s) => s.structure);
  const files = useFilesStore((s) => s.files);

  // Load CIF data from workspace files
  useEffect(() => {
    if (!conversationId) {
      setCifData(null);
      return;
    }
    const cifFile = files.find((f) => f.name.toLowerCase().endsWith('.cif'));
    if (cifFile) {
      fetch(`/api/conversations/${conversationId}/files/${cifFile.name}`)
        .then((res) => res.text())
        .then((text) => setCifData(text))
        .catch(() => setCifData(null));
    } else {
      setCifData(null);
    }
  }, [conversationId, files]);

  return (
    <div className="space-y-4">
      {/* 3D viewer */}
      <StructureViewer cifData={cifData} />

      {/* Structure info */}
      {structure ? (
        <div className="bg-slate-700/50 rounded-lg p-3">
          <h3 className="text-sm font-medium text-white mb-2">Structure Info</h3>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <span className="text-slate-400">Formula</span>
            <span className="text-white font-medium">{structure.formula}</span>
            <span className="text-slate-400">Space group</span>
            <span className="text-white">{structure.spacegroup} (#{structure.spacegroupNumber})</span>
            <span className="text-slate-400">Lattice</span>
            <span className="text-white">{structure.latticeSystem}</span>
            <span className="text-slate-400">a, b, c</span>
            <span className="text-white">{structure.a.toFixed(3)}, {structure.b.toFixed(3)}, {structure.c.toFixed(3)} Å</span>
            <span className="text-slate-400">Volume</span>
            <span className="text-white">{structure.volume.toFixed(2)} ų</span>
            <span className="text-slate-400">Atoms</span>
            <span className="text-white">{structure.natoms}</span>
            <span className="text-slate-400">Density</span>
            <span className="text-white">{structure.density.toFixed(3)} g/cm³</span>
          </div>
        </div>
      ) : (
        <div className="bg-slate-700/50 rounded-lg p-3">
          <h3 className="text-sm font-medium text-white mb-2">Structure Info</h3>
          <p className="text-sm text-slate-400">No structure selected</p>
        </div>
      )}

      {/* Prediction summary */}
      <PredictionSummary />
    </div>
  );
}

function ParametersTab() {
  const {
    functional, pseudoMode, mlModel, confidence, structure,
    setFunctional, setPseudoMode, setMlModel, setConfidence, setPrediction,
  } = useContextStore();
  const [isGenerating, setIsGenerating] = useState(false);

  const handleQuickGenerate = async () => {
    if (!structure) return;
    setIsGenerating(true);
    try {
      const predictRes = await api.post<{ prediction: unknown }>('/predict', {
        filePath: structure.filePath,
        model: mlModel,
        confidence,
      });
      if (predictRes.prediction) {
        setPrediction(predictRes.prediction as import('../../store/context').PredictionResult);
      }
      await api.post('/generate', {
        filePath: structure.filePath,
        functional,
        pseudoMode,
        model: mlModel,
        confidence,
      });
    } catch (err) {
      console.error('Quick generate failed:', err);
    } finally {
      setIsGenerating(false);
    }
  };

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

      <div>
        <label className="block text-sm font-medium text-slate-300 mb-1.5">
          ML Model
        </label>
        <select
          value={mlModel}
          onChange={(e) => setMlModel(e.target.value as 'ALIGNN' | 'RF')}
          className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
        >
          <option value="ALIGNN">ALIGNN (More accurate)</option>
          <option value="RF">Random Forest (Faster)</option>
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-300 mb-1.5">
          Confidence Level
        </label>
        <select
          value={String(confidence)}
          onChange={(e) => setConfidence(Number(e.target.value))}
          className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
        >
          <option value="0.95">95% (Conservative)</option>
          <option value="0.90">90%</option>
          <option value="0.85">85%</option>
        </select>
      </div>

      <button
        disabled={!structure || isGenerating}
        onClick={handleQuickGenerate}
        className="w-full py-2 px-4 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-600 disabled:text-slate-400 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
      >
        {isGenerating ? (
          <><Loader2 className="w-4 h-4 animate-spin" /> Generating...</>
        ) : (
          <><Zap className="w-4 h-4" /> Quick Generate</>
        )}
      </button>
      {!structure && (
        <p className="text-xs text-slate-500 text-center">
          Load a structure to enable quick generation
        </p>
      )}
    </div>
  );
}

function FilesTab({ conversationId }: { conversationId: string | null }) {
  const { files, isLoading, error, fetch, upload, remove } = useFilesStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (conversationId) {
      fetch(conversationId);
    }
  }, [conversationId, fetch]);

  const addToast = useToastStore((s) => s.addToast);

  const handleFileSelect = useCallback(async (selectedFiles: FileList | null) => {
    if (!selectedFiles || !conversationId) return;
    
    for (const file of Array.from(selectedFiles)) {
      try {
        await upload(conversationId, file);
        addToast(`Uploaded ${file.name}`, 'success');
      } catch (err) {
        console.error('Upload failed:', err);
        addToast(`Failed to upload ${file.name}`, 'error');
      }
    }
  }, [conversationId, upload, addToast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFileSelect(e.dataTransfer.files);
  }, [handleFileSelect]);

  const handleDelete = async (filename: string) => {
    if (!conversationId) return;
    if (confirm(`Delete ${filename}?`)) {
      try {
        await remove(conversationId, filename);
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

  if (!conversationId) {
    return (
      <div className="text-center text-slate-400 py-8">
        <p className="text-sm">Select a conversation to manage files</p>
      </div>
    );
  }

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
      <div>
        <h3 className="text-sm font-medium text-slate-300 mb-2">Workspace Files</h3>
        
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
                conversationId={conversationId}
                onDelete={() => handleDelete(file.name)}
                formatSize={formatSize}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FileItem({
  file,
  conversationId,
  onDelete,
  formatSize,
}: {
  file: WorkspaceFile;
  conversationId: string;
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
      <a
        href={`/api/conversations/${conversationId}/files/${file.name}`}
        download
        className="p-1 opacity-0 group-hover:opacity-100 hover:bg-slate-600 rounded transition-all"
        title="Download"
      >
        <Download className="w-4 h-4 text-slate-400" />
      </a>
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
