import { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Settings2, Files, Upload, Download, Trash2, Loader2, FileText } from 'lucide-react';
import { useConversationsStore } from '../../store/conversations';
import { useFilesStore, type WorkspaceFile } from '../../store/files';

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
        {activeTab === 'structure' && <StructureTab />}
        {activeTab === 'parameters' && <ParametersTab />}
        {activeTab === 'files' && <FilesTab conversationId={activeConversationId} />}
      </div>
    </div>
  );
}

function StructureTab() {
  return (
    <div className="space-y-4">
      {/* 3D viewer placeholder */}
      <div className="aspect-square bg-slate-700 rounded-lg flex items-center justify-center border border-slate-600 border-dashed">
        <div className="text-center text-slate-400">
          <Box className="w-12 h-12 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No structure loaded</p>
          <p className="text-xs mt-1">Upload a CIF file to visualize</p>
        </div>
      </div>

      {/* Structure info placeholder */}
      <div className="bg-slate-700/50 rounded-lg p-3">
        <h3 className="text-sm font-medium text-white mb-2">Structure Info</h3>
        <p className="text-sm text-slate-400">No structure selected</p>
      </div>
    </div>
  );
}

function ParametersTab() {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-1.5">
          Functional
        </label>
        <select className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500">
          <option value="pbesol">PBEsol</option>
          <option value="pbe">PBE</option>
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-300 mb-1.5">
          Pseudopotential Mode
        </label>
        <select className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500">
          <option value="efficiency">Efficiency</option>
          <option value="precision">Precision</option>
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-300 mb-1.5">
          ML Model
        </label>
        <select className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500">
          <option value="alignn">ALIGNN (More accurate)</option>
          <option value="rf">Random Forest (Faster)</option>
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-300 mb-1.5">
          Confidence Level
        </label>
        <select className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500">
          <option value="0.95">95% (Conservative)</option>
          <option value="0.90">90%</option>
          <option value="0.85">85%</option>
        </select>
      </div>

      <button
        disabled
        className="w-full py-2 px-4 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-600 disabled:text-slate-400 text-white font-medium rounded-lg transition-colors"
      >
        Quick Generate
      </button>
      <p className="text-xs text-slate-500 text-center">
        Load a structure to enable quick generation
      </p>
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

  const handleFileSelect = useCallback(async (selectedFiles: FileList | null) => {
    if (!selectedFiles || !conversationId) return;
    
    for (const file of Array.from(selectedFiles)) {
      try {
        await upload(conversationId, file);
      } catch (err) {
        console.error('Upload failed:', err);
      }
    }
  }, [conversationId, upload]);

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
      } catch (err) {
        console.error('Delete failed:', err);
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
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />
          </div>
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
