import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Calculator,
  MessageSquarePlus,
  Search,
  Sparkles,
  Upload,
} from 'lucide-react';
import { useFilesStore } from '../../store/files';
import { useToastStore } from '../../store/toast';
import {
  getPromptTemplate,
  type PromptTemplateId,
} from '../../lib/promptTemplates';
import { getPathDisplayName, isStructurePath } from '../../lib/workspaceTabs';
import { useContextStore } from '../../store/context';

function sanitizeUploadName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\/+/g, '_');
}

const STRUCTURE_TEMPLATE_IDS: PromptTemplateId[] = [
  'inspect-structure',
  'predict-kpoints',
  'generate-qe-input',
];

const GENERAL_TEMPLATE_IDS: PromptTemplateId[] = [
  'search-structure',
  'explain-kpoint-convergence',
  'compare-models',
];

function templateIcon(id: PromptTemplateId) {
  switch (id) {
    case 'inspect-structure':
      return MessageSquarePlus;
    case 'predict-kpoints':
      return Sparkles;
    case 'generate-qe-input':
      return Calculator;
    case 'search-structure':
      return Search;
    case 'explain-kpoint-convergence':
    case 'compare-models':
      return Sparkles;
  }
}

export default function WelcomeMessage({ onSend, isReady }: { onSend: (text: string) => void; isReady: boolean }) {
  const [visible, setVisible] = useState(false);
  const [selectedStructure, setSelectedStructure] = useState<string>('');
  const [extraInstructions, setExtraInstructions] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const defaults = useContextStore((s) => s.generationDefaults);
  const files = useFilesStore((s) => s.files);
  const fetchFiles = useFilesStore((s) => s.fetch);
  const upload = useFilesStore((s) => s.upload);
  const addToast = useToastStore((s) => s.addToast);

  const structureFiles = useMemo(
    () => files.filter((file) => !file.isDirectory && isStructurePath(file.path)),
    [files]
  );

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 50);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    void fetchFiles();
  }, [fetchFiles]);

  useEffect(() => {
    if (!selectedStructure && structureFiles.length > 0) {
      setSelectedStructure(structureFiles[0].path);
      return;
    }

    if (selectedStructure && !structureFiles.some((file) => file.path === selectedStructure)) {
      setSelectedStructure(structureFiles[0]?.path ?? '');
    }
  }, [selectedStructure, structureFiles]);

  const handleStructurePrompt = (templateId: PromptTemplateId) => {
    if (!isReady || !selectedStructure) return;
    const template = getPromptTemplate(templateId);
    onSend(template.buildPrompt({
      defaults,
      structurePath: selectedStructure,
      extraInstructions,
    }));
  };

  const handleGeneralPrompt = (templateId: PromptTemplateId) => {
    if (!isReady) return;
    const template = getPromptTemplate(templateId);
    onSend(template.buildPrompt({ defaults, extraInstructions }));
  };

  const handleUpload = async (selectedFiles: FileList | null) => {
    if (!selectedFiles) return;

    let firstUploadedStructure = '';

    for (const file of Array.from(selectedFiles)) {
      try {
        await upload(file);
        const safeName = sanitizeUploadName(file.name);
        if (!firstUploadedStructure && isStructurePath(safeName)) {
          firstUploadedStructure = safeName;
        }
        addToast(`Uploaded ${safeName}`, 'success');
      } catch {
        addToast(`Failed to upload ${file.name}`, 'error');
      }
    }

    if (firstUploadedStructure) {
      setSelectedStructure(firstUploadedStructure);
    }
  };

  return (
    <div
      className={`h-full flex flex-col items-center justify-center text-center px-4 py-8 transition-opacity duration-500 overflow-y-auto ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".cif,.poscar,.vasp,.xyz,.pdb"
        className="hidden"
        onChange={(e) => void handleUpload(e.target.files)}
      />

      <div className="w-16 h-16 bg-amber-500/20 rounded-full flex items-center justify-center mb-4">
        <Sparkles className="w-8 h-8 text-amber-500" />
      </div>
      <h2 className="text-xl font-semibold text-white mb-2">
        Welcome to Goldilocks
      </h2>
      <p className="text-slate-400 max-w-2xl mb-6 leading-relaxed">
        Start with a reusable prompt template. Structure-backed prompts can target any CIF or other structure file already in your workspace, or you can upload one here first.
      </p>

      <div className="w-full max-w-5xl grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] text-left">
        <section className="rounded-xl bg-slate-800 border border-slate-700 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-sm font-semibold text-white">Structure-backed prompts</h3>
              <p className="text-sm text-slate-400 mt-1">
                Pick a structure, optionally add instructions, then launch one of the common workflows.
              </p>
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={!isReady}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-600 bg-slate-900/60 hover:bg-slate-700 text-slate-200 text-sm transition-colors disabled:opacity-50"
            >
              <Upload className="w-4 h-4 text-amber-500" />
              Upload structure
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
            <div className="space-y-3">
              <label className="block">
                <span className="block text-xs font-medium text-slate-400 mb-1.5">Workspace structure</span>
                <select
                  value={selectedStructure}
                  onChange={(e) => setSelectedStructure(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  {structureFiles.length === 0 ? (
                    <option value="">No structure files uploaded yet</option>
                  ) : (
                    structureFiles.map((file) => (
                      <option key={file.path} value={file.path}>
                        {getPathDisplayName(file.path)}
                      </option>
                    ))
                  )}
                </select>
              </label>

              {selectedStructure && (
                <div className="rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Selected path</div>
                  <div className="text-xs text-slate-300 font-mono break-all">{selectedStructure}</div>
                </div>
              )}
            </div>

            <div className="space-y-3">
              <label className="block">
                <span className="block text-xs font-medium text-slate-400 mb-1.5">Extra instructions</span>
                <textarea
                  value={extraInstructions}
                  onChange={(e) => setExtraInstructions(e.target.value)}
                  placeholder="Optional: e.g. use a denser grid, explain every parameter choice, or target a metallic system."
                  rows={3}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none"
                />
              </label>

              <div className="grid gap-3">
                {STRUCTURE_TEMPLATE_IDS.map((templateId) => {
                  const template = getPromptTemplate(templateId);
                  const Icon = templateIcon(templateId);
                  return (
                    <button
                      key={template.id}
                      onClick={() => handleStructurePrompt(templateId)}
                      disabled={!isReady || !selectedStructure}
                      className="rounded-lg border border-slate-600 bg-slate-900/60 hover:bg-slate-700 px-4 py-3 text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Icon className="w-4 h-4 text-amber-500 mb-2" />
                      <div className="text-sm font-medium text-white mb-1.5">{template.label}</div>
                      <div className="text-sm text-slate-400 leading-relaxed">{template.description}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-xl bg-slate-800 border border-slate-700 p-4 sm:p-5">
          <h3 className="text-sm font-semibold text-white mb-1">General prompts</h3>
          <p className="text-sm text-slate-400 mb-4">
            Good starting points when you want guidance before choosing a structure.
          </p>
          <div className="space-y-2">
            {GENERAL_TEMPLATE_IDS.map((templateId) => {
              const template = getPromptTemplate(templateId);
              const Icon = templateIcon(templateId);
              return (
                <button
                  key={template.id}
                  onClick={() => handleGeneralPrompt(templateId)}
                  disabled={!isReady}
                  className="w-full rounded-lg border border-slate-600 bg-slate-900/60 hover:bg-slate-700 px-3 py-3 text-left transition-colors disabled:opacity-50"
                >
                  <div className="flex items-start gap-3">
                    <Icon className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                    <div>
                      <div className="text-sm font-medium text-white mb-1">{template.label}</div>
                      <div className="text-xs text-slate-400 leading-relaxed">{template.description}</div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
