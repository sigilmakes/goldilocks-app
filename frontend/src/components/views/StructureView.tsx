import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Calculator,
  Download,
  FileCode2,
  Send,
  Sparkles,
} from 'lucide-react';
import { fetchFile, downloadWorkspaceFile } from '../../api/client';
import StructureViewer from '../science/StructureViewer';
import PredictionSummary from '../science/PredictionSummary';
import { useContextStore, type GenerationDefaults } from '../../store/context';
import { useToastStore } from '../../store/toast';
import { useFilesStore } from '../../store/files';
import { getExtension, getPathDisplayName } from '../../lib/workspaceTabs';
import { useConversationsStore } from '../../store/conversations';
import { useTabsStore } from '../../store/tabs';
import { useChatPromptStore } from '../../store/chatPrompt';

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

export default function StructureView({ path }: { path: string }) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const defaults = useContextStore((s) => s.generationDefaults);
  const addToast = useToastStore((s) => s.addToast);
  const files = useFilesStore((s) => s.files);
  const activeConversationId = useConversationsStore((s) => s.activeConversationId);
  const conversations = useConversationsStore((s) => s.conversations);
  const tabs = useTabsStore((s) => s.tabs);
  const openConversationTab = useTabsStore((s) => s.openConversationTab);
  const queuePrompt = useChatPromptStore((s) => s.queuePrompt);

  const file = useMemo(
    () => files.find((entry) => entry.path === path) ?? null,
    [files, path]
  );

  const targetConversationId = useMemo(() => {
    const openConversationIds = tabs
      .filter((tab) => tab.type === 'conversation')
      .map((tab) => tab.conversationId);

    if (activeConversationId && openConversationIds.includes(activeConversationId)) {
      return activeConversationId;
    }

    if (activeConversationId) {
      return activeConversationId;
    }

    return openConversationIds[0] ?? null;
  }, [activeConversationId, tabs]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setContent(null);

    fetchFile(path)
      .then((response) => {
        if (cancelled) return;
        setContent(response.content);
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
    if (!targetConversationId) return;

    const conversation = conversations.find((entry) => entry.id === targetConversationId);
    queuePrompt(targetConversationId, prompt);
    openConversationTab(targetConversationId, conversation?.title ?? 'Conversation');
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-slate-700 bg-slate-800/70 text-xs text-slate-300 mb-3">
              <FileCode2 className="w-3.5 h-3.5 text-emerald-400" />
              Structure tab
            </div>
            <h1 className="text-2xl font-semibold text-white truncate">{getPathDisplayName(path)}</h1>
            <div className="mt-2 text-sm text-slate-400 font-mono break-all">{path}</div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => runAction(buildUseInChatPrompt(path, defaults))}
              disabled={!targetConversationId}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 hover:text-amber-200 rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send className="w-4 h-4" />
              Use in chat
            </button>
            <button
              onClick={() => runAction(buildPredictPrompt(path, defaults))}
              disabled={!targetConversationId}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 hover:text-amber-200 rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Sparkles className="w-4 h-4" />
              Predict k-points
            </button>
            <button
              onClick={() => runAction(buildGeneratePrompt(path, defaults))}
              disabled={!targetConversationId}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 hover:text-amber-200 rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Calculator className="w-4 h-4" />
              Generate QE input
            </button>
            <button
              onClick={() => void handleDownload()}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-700 hover:bg-slate-600 border border-slate-600 text-slate-300 rounded-lg text-sm transition-colors"
            >
              <Download className="w-4 h-4" />
              Download
            </button>
          </div>
        </div>

        {!targetConversationId && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            Open or select a conversation tab first, then structure actions can send prompts into it.
          </div>
        )}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_340px]">
          <div className="space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <MetaCard label="Type" value={getExtension(path).toUpperCase() || 'STRUCTURE'} />
              <MetaCard label="Size" value={file ? formatBytes(file.size) : '-'} />
              <MetaCard label="Defaults" value={`${defaults.model} @ ${Math.round(defaults.confidence * 100)}%`} />
              <MetaCard label="Functional" value={`${defaults.functional} · ${defaults.pseudoMode}`} />
            </div>

            <section className="rounded-xl border border-slate-700 bg-slate-800/70 p-4">
              <div className="flex items-center gap-2 mb-4">
                <Box className="w-4 h-4 text-emerald-400" />
                <h2 className="text-sm font-medium text-white">Structure viewer</h2>
              </div>

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
            </section>
          </div>

          <div className="space-y-4">
            <section className="rounded-xl border border-slate-700 bg-slate-800/70 p-4">
              <h2 className="text-sm font-medium text-white mb-3">Generation defaults</h2>
              <div className="space-y-2 text-sm text-slate-300">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-400">Functional</span>
                  <span>{defaults.functional}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-400">Pseudopotential</span>
                  <span>{defaults.pseudoMode}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-400">Prediction model</span>
                  <span>{defaults.model}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-400">Confidence</span>
                  <span>{Math.round(defaults.confidence * 100)}%</span>
                </div>
              </div>
            </section>

            <PredictionSummary />
          </div>
        </div>
      </div>
    </div>
  );
}

function MetaCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-800/70 border border-slate-700 px-3 py-3">
      <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">{label}</div>
      <div className="text-sm text-slate-200 truncate">{value}</div>
    </div>
  );
}
