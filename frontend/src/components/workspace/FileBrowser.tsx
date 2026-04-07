import { useState, useEffect, useCallback, useRef } from 'react';
import {
  FileText, Folder, FolderOpen, Search, Plus, Trash2,
  Edit3, FolderPlus, FilePlus, ChevronRight, ChevronDown,
  Image, FileCode, FileJson, Upload,
} from 'lucide-react';
import { fetchFiles, deleteFile, moveFile, type FileEntry } from '../../api/client';
import { useToastStore } from '../../store/toast';
import { useFilesStore } from '../../store/files';

interface FileBrowserProps {
  onFileSelect: (path: string) => void;
  selectedPath: string | null;
  onUploadRequest?: () => void;
}

function clampMenuPosition(x: number, y: number, width: number, height: number) {
  const margin = 8;
  return {
    x: Math.max(margin, Math.min(x, window.innerWidth - width - margin)),
    y: Math.max(margin, Math.min(y, window.innerHeight - height - margin)),
  };
}

// -- File icon by type
function FileIcon({ name, isDir, isOpen }: { name: string; isDir: boolean; isOpen?: boolean }) {
  if (isDir) {
    return isOpen ? (
      <FolderOpen className="w-4 h-4 text-amber-500 flex-shrink-0" />
    ) : (
      <Folder className="w-4 h-4 text-amber-500 flex-shrink-0" />
    );
  }

  const ext = name.split('.').pop()?.toLowerCase() ?? '';

  if (['cif', 'poscar', 'vasp', 'xyz', 'pdb'].includes(ext)) {
    return <FileCode className="w-4 h-4 text-amber-400 flex-shrink-0" />;
  }
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) {
    return <Image className="w-4 h-4 text-emerald-400 flex-shrink-0" />;
  }
  if (['json', 'yaml', 'yml', 'toml'].includes(ext)) {
    return <FileJson className="w-4 h-4 text-blue-400 flex-shrink-0" />;
  }
  if (['ts', 'tsx', 'js', 'jsx', 'py', 'sh', 'in', 'out', 'txt', 'md'].includes(ext)) {
    return <FileCode className="w-4 h-4 text-indigo-400 flex-shrink-0" />;
  }

  return <FileText className="w-4 h-4 text-slate-400 flex-shrink-0" />;
}

// -- Context menu
interface ContextMenuState {
  x: number;
  y: number;
  entry: FileEntry;
}

function ContextMenu({
  state,
  onClose,
  onRename,
  onMove,
  onDelete,
}: {
  state: ContextMenuState;
  onClose: () => void;
  onRename: (entry: FileEntry) => void;
  onMove: (entry: FileEntry) => void;
  onDelete: (entry: FileEntry) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keyHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', keyHandler);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-50 bg-slate-800 border border-slate-600 rounded-lg shadow-xl py-1 min-w-[140px]"
      style={{ left: state.x, top: state.y }}
    >
      <button
        onClick={() => { onClose(); onRename(state.entry); }}
        className="w-full text-left px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700 flex items-center gap-2"
      >
        <Edit3 className="w-3.5 h-3.5 text-slate-400" />
        Rename
      </button>
      <button
        onClick={() => { onClose(); onMove(state.entry); }}
        className="w-full text-left px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700 flex items-center gap-2"
      >
        <FolderPlus className="w-3.5 h-3.5 text-slate-400" />
        Move to…
      </button>
      <div className="my-1 border-t border-slate-600" />
      <button
        onClick={() => { onClose(); onDelete(state.entry); }}
        className="w-full text-left px-3 py-1.5 text-sm text-red-400 hover:bg-slate-700 flex items-center gap-2"
      >
        <Trash2 className="w-3.5 h-3.5" />
        Delete
      </button>
    </div>
  );
}

// -- Create menu
function CreateMenu({
  anchor,
  onClose,
  onCreateFile,
  onCreateFolder,
  onUpload,
}: {
  anchor: { x: number; y: number };
  onClose: () => void;
  onCreateFile: () => void;
  onCreateFolder: () => void;
  onUpload?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keyHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', keyHandler);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-50 bg-slate-800 border border-slate-600 rounded-lg shadow-xl py-1 min-w-[160px]"
      style={{ left: anchor.x, top: anchor.y }}
    >
      <button
        onClick={() => { onClose(); onCreateFile(); }}
        className="w-full text-left px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700 flex items-center gap-2"
      >
        <FilePlus className="w-3.5 h-3.5 text-slate-400" />
        New file
      </button>
      <button
        onClick={() => { onClose(); onCreateFolder(); }}
        className="w-full text-left px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700 flex items-center gap-2"
      >
        <FolderPlus className="w-3.5 h-3.5 text-slate-400" />
        New folder
      </button>
      {onUpload && (
        <button
          onClick={() => { onClose(); onUpload(); }}
          className="w-full text-left px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700 flex items-center gap-2"
        >
          <Upload className="w-3.5 h-3.5 text-slate-400" />
          Upload files
        </button>
      )}
    </div>
  );
}

// -- FileBrowser
export default function FileBrowser({ onFileSelect, selectedPath, onUploadRequest }: FileBrowserProps) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [createMenu, setCreateMenu] = useState<{ x: number; y: number } | null>(null);
  const addToast = useToastStore((s) => s.addToast);
  const revision = useFilesStore((s) => s.revision);
  const touchWorkspace = useFilesStore((s) => s.touch);

  const loadFiles = useCallback(async (q?: string) => {
    setLoading(true);
    try {
      const res = await fetchFiles(q || undefined);
      setEntries(res.entries || []);
    } catch {
      addToast('Failed to load files', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { loadFiles(); }, [loadFiles]);

  useEffect(() => {
    void loadFiles(search || undefined);
  }, [revision, loadFiles, search]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => loadFiles(search || undefined), 300);
    return () => clearTimeout(timer);
  }, [search, loadFiles]);

  const toggleDir = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const sortEntries = (items: FileEntry[]) => {
    return [...items].sort((a, b) => {
      if (a.type === 'dir' && b.type === 'file') return -1;
      if (a.type === 'file' && b.type === 'dir') return 1;
      return a.name.localeCompare(b.name);
    });
  };

  const handleCreateFile = async () => {
    const name = window.prompt('File name:', 'untitled.txt');
    if (!name || !name.trim()) return;

    const safeName = name.trim().replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\/+/g, '_');
    if (safeName.startsWith('.')) {
      addToast('Cannot create hidden files', 'error');
      return;
    }

    try {
      const { putFile } = await import('../../api/client');
      await putFile(safeName, '');
      addToast(`Created ${safeName}`, 'success');
      if (!search) {
        setEntries((prev) => sortEntries([
          { name: safeName, path: safeName, type: 'file' },
          ...prev.filter((entry) => entry.path !== safeName),
        ]));
      }
      touchWorkspace();
      onFileSelect(safeName);
      void loadFiles(search || undefined);
    } catch {
      addToast('Failed to create file', 'error');
    }
  };

  const handleCreateFolder = async () => {
    const name = window.prompt('Folder name:', 'new_folder');
    if (!name || !name.trim()) return;

    const safeName = name.trim().replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\/+/g, '_');
    if (safeName.startsWith('.')) {
      addToast('Cannot create hidden folders', 'error');
      return;
    }

    try {
      // Create a .gitkeep inside so the directory persists
      const { putFile } = await import('../../api/client');
      await putFile(`${safeName}/.gitkeep`, '');
      addToast(`Created ${safeName}/`, 'success');
      if (!search) {
        setEntries((prev) => sortEntries([
          { name: safeName, path: safeName, type: 'dir', children: [] },
          ...prev.filter((entry) => entry.path !== safeName),
        ]));
      }
      touchWorkspace();
      void loadFiles(search || undefined);
    } catch {
      addToast('Failed to create folder', 'error');
    }
  };

  const handleRename = async (entry: FileEntry) => {
    const newName = window.prompt('New name:', entry.name);
    if (!newName || newName === entry.name) return;

    const safeName = newName.trim().replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\/+/g, '_');
    if (safeName.startsWith('.')) {
      addToast('Invalid name', 'error');
      return;
    }

    // Build new path by replacing the last segment
    const parts = entry.path.split('/');
    parts[parts.length - 1] = safeName;
    const newPath = parts.join('/');

    try {
      await moveFile(entry.path, newPath);
      addToast(`Renamed to ${safeName}`, 'success');
      touchWorkspace();
      if (selectedPath === entry.path) onFileSelect(newPath);
      void loadFiles(search || undefined);
    } catch {
      addToast('Failed to rename', 'error');
    }
  };

  const handleMove = async (entry: FileEntry) => {
    const dest = window.prompt(`Move "${entry.name}" to (path):`, entry.path);
    if (!dest || dest === entry.path) return;

    const safeDest = dest.trim().replace(/\.\./g, '').replace(/^\/+/, '');
    if (!safeDest) {
      addToast('Invalid destination', 'error');
      return;
    }

    try {
      await moveFile(entry.path, safeDest);
      addToast(`Moved to ${safeDest}`, 'success');
      touchWorkspace();
      if (selectedPath === entry.path) onFileSelect(safeDest);
      void loadFiles(search || undefined);
    } catch {
      addToast('Failed to move', 'error');
    }
  };

  const handleDelete = async (entry: FileEntry) => {
    const confirmed = window.confirm(`Delete "${entry.path}"? This cannot be undone.`);
    if (!confirmed) return;

    try {
      await deleteFile(entry.path);
      addToast(`Deleted ${entry.name}`, 'success');
      setEntries((prev) => prev.filter((candidate) => candidate.path !== entry.path));
      touchWorkspace();
      if (selectedPath === entry.path) onFileSelect('');
      void loadFiles(search || undefined);
    } catch {
      addToast('Failed to delete', 'error');
    }
  };

  const handleContextMenu = (e: React.MouseEvent, entry: FileEntry) => {
    if (entry.type === 'dir') return;
    e.preventDefault();
    const pos = clampMenuPosition(e.clientX, e.clientY, 160, 116);
    setContextMenu({ x: pos.x, y: pos.y, entry });
  };

  // -- Render tree

  const renderEntry = (entry: FileEntry, depth: number): React.ReactNode => {
    const isDir = entry.type === 'dir';
    const isExpanded = expanded.has(entry.path);
    const isSelected = selectedPath === entry.path;

    return (
      <div key={entry.path}>
        <div
          className={`flex items-center gap-1.5 px-2 py-1 cursor-pointer rounded-md text-sm transition-colors group
            ${isSelected ? 'bg-amber-500/10 border-l-2 border-amber-500' : 'hover:bg-slate-700/30'}
          `}
          style={{ paddingLeft: `${0.5 + depth * 1}rem` }}
          onClick={() => {
            if (isDir) toggleDir(entry.path);
            else onFileSelect(entry.path);
          }}
          onContextMenu={(e) => handleContextMenu(e, entry)}
        >
          {isDir ? (
            isExpanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
            )
          ) : (
            <span className="w-3.5" />
          )}
          <FileIcon name={entry.name} isDir={isDir} isOpen={isExpanded} />
          <span className="truncate text-slate-200">{entry.name}</span>
        </div>

        {isDir && isExpanded && entry.children && (
          <div>
            {entry.children.map((child) => renderEntry(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      {/* Search + New */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-700">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Search files…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 bg-slate-700 border border-slate-600 rounded-lg text-sm text-slate-200 placeholder-slate-400 focus:outline-none focus:border-amber-500"
          />
        </div>
        <button
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const pos = clampMenuPosition(rect.left, rect.bottom + 4, 176, onUploadRequest ? 124 : 88);
            setCreateMenu({ x: pos.x, y: pos.y });
          }}
          className="p-1.5 bg-slate-700 hover:bg-slate-600 border border-slate-600 hover:border-slate-500 rounded-lg transition-colors"
          title="New file or folder"
        >
          <Plus className="w-4 h-4 text-slate-300" />
        </button>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {loading && entries.length === 0 ? (
          <div className="px-4 py-3 text-sm text-slate-400 italic">Loading…</div>
        ) : entries.length === 0 ? (
          <div className="px-4 py-3 text-sm text-slate-400 italic">
            {search ? 'No files found' : 'No files yet — upload or create one'}
          </div>
        ) : (
          entries.map((e) => renderEntry(e, 0))
        )}
      </div>

      {contextMenu && (
        <ContextMenu
          state={contextMenu}
          onClose={() => setContextMenu(null)}
          onRename={handleRename}
          onMove={handleMove}
          onDelete={handleDelete}
        />
      )}

      {createMenu && (
        <CreateMenu
          anchor={createMenu}
          onClose={() => setCreateMenu(null)}
          onCreateFile={handleCreateFile}
          onCreateFolder={handleCreateFolder}
          onUpload={onUploadRequest}
        />
      )}
    </div>
  );
}
