import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  ArrowLeft, Download, Edit3, Eye, Save,
} from 'lucide-react';
import { marked } from 'marked';
import { fetchFile, putFile, rawFileUrl, getAuthHeaders, downloadWorkspaceFile } from '../../api/client';
import { useToastStore } from '../../store/toast';
import StructureViewer from '../science/StructureViewer';

interface FileViewerProps {
  path: string;
  onBack?: () => void;
  showBackButton?: boolean;
}

// -- Helpers
function getExt(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);
const CODE_EXTS = new Set(['ts', 'tsx', 'js', 'jsx', 'py', 'sh', 'in', 'out', 'txt', 'md', 'json', 'yaml', 'yml', 'toml', 'xml', 'rs', 'go', 'c', 'cpp', 'h']);
const CIF_EXTS = new Set(['cif', 'poscar', 'vasp', 'xyz', 'pdb']);

function getViewerType(name: string): 'cif' | 'image' | 'markdown' | 'code' | 'binary' {
  const ext = getExt(name);
  if (CIF_EXTS.has(ext)) return 'cif';
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (ext === 'md') return 'markdown';
  if (CODE_EXTS.has(ext)) return 'code';
  return 'binary';
}

type SaveStatus = 'clean' | 'dirty' | 'saving' | 'saved' | 'error';

function SaveIndicator({ status }: { status: SaveStatus }) {
  if (status === 'clean') return null;
  const labels: Record<SaveStatus, { text: string; cls: string }> = {
    clean: { text: '', cls: '' },
    dirty: { text: '● Unsaved', cls: 'text-amber-400' },
    saving: { text: 'Saving…', cls: 'text-slate-400' },
    saved: { text: '✓ Saved', cls: 'text-green-400' },
    error: { text: 'Save failed', cls: 'text-red-400' },
  };
  const { text, cls } = labels[status];
  return <span className={`text-xs font-medium ${cls}`}>{text}</span>;
}

// -- Image viewer with auth blob URL
function ImageViewer({ path }: { path: string }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let revoked = false;
    setLoading(true);

    fetch(rawFileUrl(path), { headers: getAuthHeaders() })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        if (revoked) return;
        setBlobUrl(URL.createObjectURL(blob));
        setLoading(false);
      })
      .catch(() => {
        if (!revoked) {
          setBlobUrl(null);
          setLoading(false);
        }
      });

    return () => {
      revoked = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [path]);

  if (loading) return <div className="text-sm text-slate-400 italic p-4">Loading image…</div>;
  if (!blobUrl) return <div className="text-sm text-slate-400 italic p-4">Failed to load image</div>;

  return (
    <div className="flex items-center justify-center p-4 overflow-auto bg-slate-900/50">
      <img
        src={blobUrl}
        alt={path.split('/').pop() ?? path}
        className="max-w-full max-h-full rounded-lg border border-slate-600"
      />
    </div>
  );
}

// -- Markdown viewer
marked.setOptions({ breaks: true, gfm: true });

function MarkdownViewer({ content }: { content: string }) {
  const html = useMemo(() => {
    try {
      // Strip YAML frontmatter
      const stripped = content.replace(/^---\n[\s\S]*?\n---\n/, '');
      return marked.parse(stripped) as string;
    } catch {
      return content;
    }
  }, [content]);

  return (
    <div className="p-4">
      <div
        className="chat-markdown text-slate-200"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

// -- Code viewer
function CodeViewer({ content }: { content: string }) {
  return (
    <pre className="p-4 font-mono text-sm text-slate-200 bg-slate-800 rounded-lg overflow-x-auto leading-relaxed whitespace-pre">
      {content}
    </pre>
  );
}

// -- CIF viewer
function CIFViewer({ content }: { content: string }) {
  return (
    <div className="p-4">
      <StructureViewer cifData={content} />
    </div>
  );
}

// -- FileViewer
export default function FileViewer({ path, onBack, showBackButton = true }: FileViewerProps) {
  const [content, setContent] = useState<string | null>(null);
  const [editedContent, setEditedContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('clean');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveStatusRef = useRef(saveStatus);
  const editModeRef = useRef(editMode);
  const handleSaveRef = useRef<() => void>(() => {});
  const addToast = useToastStore((s) => s.addToast);

  const viewerType = getViewerType(path);

  // Load content
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setEditMode(false);
    setSaveStatus('clean');
    setEditedContent(null);
    setContent(null);

    fetchFile(path)
      .then((res) => {
        if (cancelled) return;
        setContent(res.content);
        setEditedContent(res.content);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load file');
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [path]);

  // Keep refs in sync
  useEffect(() => { saveStatusRef.current = saveStatus; }, [saveStatus]);
  useEffect(() => { editModeRef.current = editMode; }, [editMode]);

  // beforeunload guard
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (saveStatusRef.current === 'dirty') e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  // Ctrl+S
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (editModeRef.current && saveStatusRef.current === 'dirty') {
          handleSaveRef.current();
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const handleSave = useCallback(async () => {
    if (editedContent === null || saveStatus === 'saving') return;
    setSaveStatus('saving');
    try {
      await putFile(path, editedContent);
      setContent(editedContent);
      setSaveStatus('saved');
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => setSaveStatus('clean'), 2000);
    } catch {
      setSaveStatus('error');
      addToast('Failed to save file', 'error');
    }
  }, [editedContent, path, saveStatus, addToast]);

  // Expose handleSave via ref for Ctrl+S handler
  handleSaveRef.current = handleSave;

  const handleToggleEdit = () => {
    if (editMode && saveStatus === 'dirty') {
      if (!window.confirm('You have unsaved changes. Discard?')) return;
      setEditedContent(content);
      setSaveStatus('clean');
    }
    setEditMode((prev) => !prev);
  };

  const handleDownload = async () => {
    try {
      await downloadWorkspaceFile(path);
    } catch {
      addToast('Failed to download file', 'error');
    }
  };

  const canEdit = viewerType === 'code' || viewerType === 'markdown';

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-700 flex-shrink-0">
        {showBackButton && onBack && (
          <>
            <button
              onClick={onBack}
              className="flex items-center gap-1 px-2 py-1 text-sm text-slate-400 hover:text-slate-200 hover:bg-slate-700 rounded-md transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>

            <div className="h-4 w-px bg-slate-600" />
          </>
        )}

        <span className="text-sm text-slate-400 font-mono truncate flex-1 min-w-0">
          {path}
        </span>

        <div className="flex items-center gap-2 flex-shrink-0">
          <SaveIndicator status={saveStatus} />

          {editMode && saveStatus === 'dirty' && (
            <button
              onClick={handleSave}
              className="flex items-center gap-1 px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium rounded-lg transition-colors"
            >
              <Save className="w-3.5 h-3.5" />
              Save
            </button>
          )}

          {canEdit && (
            <button
              onClick={handleToggleEdit}
              className={`flex items-center gap-1 px-2.5 py-1 text-sm rounded-lg border transition-colors ${
                editMode
                  ? 'bg-slate-600 border-slate-500 text-slate-200'
                  : 'bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600'
              }`}
            >
              {editMode ? (
                <><Eye className="w-3.5 h-3.5" />View</>
              ) : (
                <><Edit3 className="w-3.5 h-3.5" />Edit</>
              )}
            </button>
          )}

          <button
            onClick={handleDownload}
            className="flex items-center gap-1 px-2.5 py-1 bg-slate-700 hover:bg-slate-600 border border-slate-600 text-slate-300 text-sm rounded-lg transition-colors"
            title="Download"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full text-slate-400 italic text-sm">
            Loading…
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full text-red-400 text-sm">
            {error}
          </div>
        ) : editMode && canEdit ? (
          <textarea
            value={editedContent ?? ''}
            onChange={(e) => {
              setEditedContent(e.target.value);
              setSaveStatus('dirty');
            }}
            className="w-full h-full p-4 bg-slate-800 text-slate-200 font-mono text-sm resize-none focus:outline-none leading-relaxed"
            spellCheck={false}
          />
        ) : viewerType === 'image' ? (
          <ImageViewer path={path} />
        ) : viewerType === 'markdown' ? (
          <MarkdownViewer content={content ?? ''} />
        ) : viewerType === 'cif' ? (
          <CIFViewer content={content ?? ''} />
        ) : viewerType === 'code' ? (
          <div className="p-4 overflow-x-auto">
            <CodeViewer content={content ?? ''} />
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-slate-400 italic text-sm">
            Binary file — cannot preview
          </div>
        )}
      </div>
    </div>
  );
}
