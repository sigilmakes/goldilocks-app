import { useState, useEffect, useRef, useCallback } from 'react';
import {
  FolderTree,
  Box,
  Sparkles,
  Calculator,
  Send,
  Download,
  FileText,
  ChevronDown,
  ChevronRight,
  Upload,
} from 'lucide-react';
import { useFilesStore, type WorkspaceFile } from '../../store/files';
import { useAuthStore } from '../../store/auth';
import { useToastStore } from '../../store/toast';
import { useContextStore, type GenerationDefaults } from '../../store/context';
import { useConversationsStore } from '../../store/conversations';
import { useSettingsStore } from '../../store/settings';
import { fetchFile, downloadWorkspaceFile } from '../../api/client';
import { dispatchChatPrompt } from '../../lib/chatPrompt';
import StructureViewer from '../science/StructureViewer';
import PredictionSummary from '../science/PredictionSummary';
import FileBrowser from '../workspace/FileBrowser';
import FileViewer from '../workspace/FileViewer';

const STRUCTURE_EXTENSIONS = new Set(['cif', 'poscar', 'vasp', 'xyz', 'pdb']);

function getExtension(path: string): string {
  return path.split('.').pop()?.toLowerCase() ?? '';
}

function isStructurePath(path: string | null): path is string {
  return Boolean(path && STRUCTURE_EXTENSIONS.has(getExtension(path)));
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function defaultsSummary(defaults: GenerationDefaults) {
  return `functional=${defaults.functional}, pseudo_mode=${defaults.pseudoMode}, prediction_model=${defaults.model}, confidence=${defaults.confidence}`;
}

function buildUseInChatPrompt(path: string, defaults: GenerationDefaults) {
  return [
    `Use the workspace structure file "${path}" as the active structure for this conversation.`,
    `Generation defaults: ${defaultsSummary(defaults)}.`,
    'Inspect the structure, summarise the key chemistry or composition, and ask what calculation I want next.',
  ].join(' ');
}

function buildPredictPrompt(path: string, defaults: GenerationDefaults) {
  return [
    `Predict a k-point grid for the workspace structure file "${path}".`,
    `Use model ${defaults.model} at confidence ${defaults.confidence}.`,
    `Treat the current generation defaults as ${defaultsSummary(defaults)}.`,
    'Explain the result briefly and keep any useful derived files in the workspace.',
  ].join(' ');
}

function buildGeneratePrompt(path: string, defaults: GenerationDefaults) {
  return [
    `Generate a Quantum ESPRESSO SCF input file for the workspace structure file "${path}".`,
    `Use ${defaultsSummary(defaults)}.`,
    'Save the resulting input file in the workspace and explain the important choices you made.',
  ].join(' ');
}

export default function ContextPanel() {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [workspaceOpen, setWorkspaceOpen] = useState(true);
  const [defaultsOpen, setDefaultsOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDraggingWorkspace, setIsDraggingWorkspace] = useState(false);

  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const activeConversationId = useConversationsStore((s) => s.activeConversationId);
  const { fetch, upload, files } = useFilesStore();
  const addToast = useToastStore((s) => s.addToast);
  const fetchSettings = useSettingsStore((s) => s.fetchSettings);

  useEffect(() => {
    if (!isAuthenticated) {
      setSelectedPath(null);
      return;
    }
    void fetch();
    void fetchSettings();
  }, [isAuthenticated, fetch, fetchSettings]);

  const handleUploaded = useCallback(() => {
    setRefreshTick((n) => n + 1);
  }, []);

  const handleFileSelect = useCallback(async (selectedFiles: FileList | null) => {
    if (!selectedFiles) return;
    for (const file of Array.from(selectedFiles)) {
      try {
        await upload(file);
        handleUploaded();
        addToast(`Uploaded ${file.name}`, 'success');
      } catch {
        addToast(`Failed to upload ${file.name}`, 'error');
      }
    }
  }, [upload, addToast, handleUploaded]);

  const handleWorkspaceDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingWorkspace(false);
    void handleFileSelect(e.dataTransfer.files);
  }, [handleFileSelect]);

  const selectedFile = selectedPath
    ? files.find((file) => file.path === selectedPath || file.name === selectedPath) ?? null
    : null;

  return (
    <div className="h-full min-h-0 flex flex-col gap-3 overflow-y-auto pr-1">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".cif,.poscar,.vasp,.xyz,.pdb,.json,.txt,.in,.out,.sh,.py,.md,.png,.jpg,.jpeg,.gif,.webp,.svg"
        className="hidden"
        onChange={(e) => void handleFileSelect(e.target.files)}
      />

      <CollapsiblePanel
        icon={Calculator}
        title="Generation defaults"
        description="Used when you launch actions from the inspector"
        isOpen={defaultsOpen}
        onToggle={() => setDefaultsOpen((v) => !v)}
        className="flex-none"
      >
        <GenerationDefaultsCard />
      </CollapsiblePanel>

      <CollapsiblePanel
        icon={FolderTree}
        title="Workspace"
        description="Browse files, create folders, and upload from the + menu"
        isOpen={workspaceOpen}
        onToggle={() => setWorkspaceOpen((v) => !v)}
        className={workspaceOpen ? 'min-h-[220px] flex-[0_0_34%]' : 'flex-none'}
        contentClassName="min-h-0 flex-1"
      >
        <div
          className={`relative h-full min-h-0 ${isDraggingWorkspace ? 'bg-amber-500/10' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDraggingWorkspace(true);
          }}
          onDragLeave={() => setIsDraggingWorkspace(false)}
          onDrop={handleWorkspaceDrop}
        >
          {isDraggingWorkspace && (
            <div className="absolute inset-0 z-10 flex items-center justify-center border-2 border-dashed border-amber-500 bg-slate-900/60 pointer-events-none">
              <div className="text-center">
                <Upload className="w-6 h-6 mx-auto mb-2 text-amber-400" />
                <p className="text-sm font-medium text-amber-200">Drop files to upload</p>
              </div>
            </div>
          )}
          <FileBrowser
            key={refreshTick}
            onFileSelect={setSelectedPath}
            selectedPath={selectedPath}
            onUploadRequest={() => fileInputRef.current?.click()}
          />
        </div>
      </CollapsiblePanel>

      <CollapsiblePanel
        icon={Box}
        title="Inspector"
        description={selectedPath ? 'Preview and act on the selected file' : 'Select a file to inspect it'}
        isOpen={inspectorOpen}
        onToggle={() => setInspectorOpen((v) => !v)}
        className={inspectorOpen ? 'flex-1 min-h-0' : 'flex-none'}
        contentClassName="min-h-0 flex-1 overflow-hidden"
      >
        {!selectedPath ? (
          <InspectorEmptyState />
        ) : isStructurePath(selectedPath) ? (
          <StructureInspector
            path={selectedPath}
            file={selectedFile}
            hasConversation={Boolean(activeConversationId)}
          />
        ) : (
          <FileViewer path={selectedPath} showBackButton={false} />
        )}
      </CollapsiblePanel>
    </div>
  );
}

function CollapsiblePanel({
  icon: Icon,
  title,
  description,
  isOpen,
  onToggle,
  children,
  className = '',
  contentClassName = '',
}: {
  icon: typeof FolderTree;
  title: string;
  description: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <section className={`rounded-xl border border-slate-700 bg-slate-800/70 overflow-hidden flex flex-col ${className}`.trim()}>
      <button
        onClick={onToggle}
        className={`flex items-center gap-2 px-3 py-2 hover:bg-slate-700/30 transition-colors text-left ${isOpen ? 'border-b border-slate-700/80' : ''}`}
      >
        <Icon className="w-4 h-4 text-amber-500 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-medium text-white">{title}</h2>
          <p className="text-[11px] text-slate-500 truncate">{description}</p>
        </div>
        {isOpen ? (
          <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-slate-400 flex-shrink-0" />
        )}
      </button>
      {isOpen && <div className={contentClassName}>{children}</div>}
    </section>
  );
}

function GenerationDefaultsCard() {
  const defaults = useContextStore((s) => s.generationDefaults);
  const updateGenerationDefaults = useContextStore((s) => s.updateGenerationDefaults);
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const defaultFunctional = useSettingsStore((s) => s.defaultFunctional);
  const addToast = useToastStore((s) => s.addToast);

  useEffect(() => {
    if (defaultFunctional && defaultFunctional !== defaults.functional) {
      updateGenerationDefaults({ functional: defaultFunctional });
    }
  }, [defaultFunctional, defaults.functional, updateGenerationDefaults]);

  const handleFunctionalChange = async (value: 'PBEsol' | 'PBE') => {
    updateGenerationDefaults({ functional: value });
    try {
      await updateSettings({ defaultFunctional: value });
    } catch {
      addToast('Failed to persist default functional', 'warning');
    }
  };

  return (
    <div className="grid grid-cols-2 gap-3 p-3">
      <label className="block">
        <span className="block text-xs font-medium text-slate-400 mb-1.5">Functional</span>
        <select
          value={defaults.functional}
          onChange={(e) => void handleFunctionalChange(e.target.value as 'PBEsol' | 'PBE')}
          className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
        >
          <option value="PBEsol">PBEsol</option>
          <option value="PBE">PBE</option>
        </select>
      </label>

      <label className="block">
        <span className="block text-xs font-medium text-slate-400 mb-1.5">Pseudopotential</span>
        <select
          value={defaults.pseudoMode}
          onChange={(e) => updateGenerationDefaults({ pseudoMode: e.target.value as 'efficiency' | 'precision' })}
          className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
        >
          <option value="efficiency">Efficiency</option>
          <option value="precision">Precision</option>
        </select>
      </label>

      <label className="block">
        <span className="block text-xs font-medium text-slate-400 mb-1.5">Prediction model</span>
        <select
          value={defaults.model}
          onChange={(e) => updateGenerationDefaults({ model: e.target.value as 'ALIGNN' | 'RF' })}
          className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
        >
          <option value="ALIGNN">ALIGNN</option>
          <option value="RF">Random Forest</option>
        </select>
      </label>

      <label className="block">
        <span className="block text-xs font-medium text-slate-400 mb-1.5">Confidence</span>
        <select
          value={defaults.confidence}
          onChange={(e) => updateGenerationDefaults({ confidence: Number(e.target.value) as 0.85 | 0.9 | 0.95 })}
          className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
        >
          <option value={0.95}>95%</option>
          <option value={0.9}>90%</option>
          <option value={0.85}>85%</option>
        </select>
      </label>
    </div>
  );
}

function InspectorEmptyState() {
  return (
    <div className="h-full flex items-center justify-center p-6">
      <div className="max-w-xs text-center">
        <FileText className="w-10 h-10 mx-auto mb-3 text-slate-500" />
        <h3 className="text-sm font-medium text-white mb-2">No file selected</h3>
        <p className="text-sm text-slate-400 leading-relaxed">
          Pick a structure, input, output, note, or image from the workspace to preview it here.
        </p>
      </div>
    </div>
  );
}

function StructureInspector({
  path,
  file,
  hasConversation,
}: {
  path: string;
  file: WorkspaceFile | null;
  hasConversation: boolean;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const defaults = useContextStore((s) => s.generationDefaults);
  const addToast = useToastStore((s) => s.addToast);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setContent(null);

    fetchFile(path)
      .then((res) => {
        if (cancelled) return;
        setContent(res.content);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load structure');
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [path]);

  const handleDownload = async () => {
    try {
      await downloadWorkspaceFile(path);
    } catch {
      addToast('Failed to download file', 'error');
    }
  };

  const runAction = (prompt: string) => {
    if (!hasConversation) return;
    dispatchChatPrompt(prompt);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium text-white truncate">{path.split('/').pop() ?? path}</div>
            <div className="text-xs text-slate-500 font-mono truncate mt-1">{path}</div>
          </div>
          <button
            onClick={() => void handleDownload()}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-700 hover:bg-slate-600 border border-slate-600 text-slate-300 text-sm rounded-lg transition-colors flex-shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            Download
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <MetaCard label="Type" value={getExtension(path).toUpperCase() || 'Structure'} />
          <MetaCard label="Size" value={file ? formatBytes(file.size) : '-'} />
          <MetaCard label="Defaults" value={`${defaults.model} @ ${Math.round(defaults.confidence * 100)}%`} />
          <MetaCard label="Functional" value={`${defaults.functional} · ${defaults.pseudoMode}`} />
        </div>

        <div className="flex flex-wrap gap-2">
          <ActionButton
            icon={Send}
            label="Use in chat"
            disabled={!hasConversation}
            onClick={() => runAction(buildUseInChatPrompt(path, defaults))}
          />
          <ActionButton
            icon={Sparkles}
            label="Predict k-points"
            disabled={!hasConversation}
            onClick={() => runAction(buildPredictPrompt(path, defaults))}
          />
          <ActionButton
            icon={Calculator}
            label="Generate QE input"
            disabled={!hasConversation}
            onClick={() => runAction(buildGeneratePrompt(path, defaults))}
          />
        </div>

        {!hasConversation && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            Select or create a conversation to enable inspector actions.
          </div>
        )}

        {loading ? (
          <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-4 text-sm text-slate-400 italic">
            Loading structure...
          </div>
        ) : error ? (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
            {error}
          </div>
        ) : (
          <StructureViewer cifData={content} />
        )}

        <PredictionSummary />
      </div>
    </div>
  );
}

function MetaCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-900/40 border border-slate-700 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">{label}</div>
      <div className="text-sm text-slate-200 truncate">{value}</div>
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  disabled,
  onClick,
}: {
  icon: typeof Sparkles;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 px-3 py-2 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 hover:text-amber-200 rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  );
}
