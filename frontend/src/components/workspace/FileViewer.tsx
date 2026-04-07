import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  ArrowLeft, Download, Edit3, Eye, Save,
} from 'lucide-react';
import { marked } from 'marked';
import { fetchFile, putFile, downloadWorkspaceFile } from '../../api/client';
import { useToastStore } from '../../store/toast';
import StructureViewer from '../science/StructureViewer';
import { useSettingsStore } from '../../store/settings';
import { getFileExtension, matchesConfiguredExtension } from '../../lib/fileAssociations';
import MilkdownEditor from './MilkdownEditor';
import MonacoEditor from './MonacoEditor';
import PdfViewer from './PdfViewer';
import ImageViewer from './ImageViewer';

interface FileViewerProps {
  path: string;
  onBack?: () => void;
  showBackButton?: boolean;
}

const STRUCTURE_EXTS = new Set(['cif', 'poscar', 'vasp', 'xyz', 'pdb']);

function getViewerType(path: string, monacoExtensions: string[], imageExtensions: string[]): 'cif' | 'pdf' | 'image' | 'markdown' | 'monaco' | 'binary' {
  const ext = getFileExtension(path);
  if (STRUCTURE_EXTS.has(ext)) return 'cif';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'md') return 'markdown';
  if (matchesConfiguredExtension(path, imageExtensions)) return 'image';
  if (matchesConfiguredExtension(path, monacoExtensions)) return 'monaco';
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

marked.setOptions({ breaks: true, gfm: true });

function MarkdownViewer({ content }: { content: string }) {
  const html = useMemo(() => {
    try {
      const stripped = content.replace(/^---\n[\s\S]*?\n---\n/, '');
      return marked.parse(stripped) as string;
    } catch {
      return content;
    }
  }, [content]);

  return (
    <div className="p-6 max-w-4xl mx-auto w-full">
      <div
        className="chat-markdown text-slate-200"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

function CIFViewer({ content }: { content: string }) {
  return (
    <div className="p-4">
      <StructureViewer cifData={content} />
    </div>
  );
}

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
  const workspaceViewer = useSettingsStore((s) => s.workspaceViewer);

  const viewerType = getViewerType(path, workspaceViewer.monacoExtensions, workspaceViewer.imageViewerExtensions);

  useEffect(() => {
    let cancelled = false;
    const requiresText = viewerType === 'cif' || viewerType === 'markdown' || viewerType === 'monaco';

    setLoading(requiresText);
    setError(null);
    setEditMode(false);
    setSaveStatus('clean');
    setEditedContent(null);
    setContent(null);

    if (!requiresText) {
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

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
  }, [path, viewerType]);

  useEffect(() => { saveStatusRef.current = saveStatus; }, [saveStatus]);
  useEffect(() => { editModeRef.current = editMode; }, [editMode]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (saveStatusRef.current === 'dirty') e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

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

  const canEdit = viewerType === 'monaco' || viewerType === 'markdown';

  return (
    <div className="flex flex-col h-full min-h-0 min-w-0">
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
              onClick={() => void handleSave()}
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
            onClick={() => void handleDownload()}
            className="flex items-center gap-1 px-2.5 py-1 bg-slate-700 hover:bg-slate-600 border border-slate-600 text-slate-300 text-sm rounded-lg transition-colors"
            title="Download"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto min-h-0 min-w-0">
        {loading ? (
          <div className="flex items-center justify-center h-full text-slate-400 italic text-sm">
            Loading…
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full text-red-400 text-sm">
            {error}
          </div>
        ) : viewerType === 'image' ? (
          <ImageViewer path={path} />
        ) : viewerType === 'pdf' ? (
          <PdfViewer path={path} />
        ) : viewerType === 'markdown' && editMode ? (
          <MilkdownEditor
            value={editedContent ?? ''}
            onChange={(nextValue) => {
              setEditedContent(nextValue);
              setSaveStatus(nextValue === content ? 'clean' : 'dirty');
            }}
          />
        ) : viewerType === 'markdown' ? (
          <MarkdownViewer content={content ?? ''} />
        ) : viewerType === 'cif' ? (
          <CIFViewer content={content ?? ''} />
        ) : viewerType === 'monaco' ? (
          <MonacoEditor
            path={path}
            value={editMode ? (editedContent ?? '') : (content ?? '')}
            readOnly={!editMode}
            onChange={(nextValue) => {
              setEditedContent(nextValue);
              setSaveStatus(nextValue === content ? 'clean' : 'dirty');
            }}
            onSave={() => void handleSave()}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-slate-400 italic text-sm px-6 text-center">
            No viewer configured for this file type yet.
          </div>
        )}
      </div>
    </div>
  );
}
