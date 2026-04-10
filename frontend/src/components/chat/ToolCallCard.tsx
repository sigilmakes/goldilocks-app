import { useState, useEffect, useMemo } from 'react';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import type { ToolCall } from '../../store/chat';
import { useSettingsStore } from '../../store/settings';

/**
 * Try to extract readable content from streaming JSON tool arguments.
 * For write/edit tools, the args are {"file_path":"...","content":"..."}.
 * We extract the content value and unescape it for display.
 */
function extractStreamContent(raw: string): { toolName: string; filePath: string; content: string } | null {
  // Try to find file_path
  const pathMatch = raw.match(/"file_path"\s*:\s*"([^"]*)"/)
    ?? raw.match(/"path"\s*:\s*"([^"]*)"/)
    ?? raw.match(/"command"\s*:\s*"([^"]*)"/); // bash tool
  const filePath = pathMatch?.[1] ?? '';

  // Try to find content field and extract everything after it
  const contentMatch = raw.match(/"content"\s*:\s*"/);
  if (contentMatch && contentMatch.index !== undefined) {
    const start = contentMatch.index + contentMatch[0].length;
    let content = raw.slice(start);
    // Remove trailing incomplete JSON (closing quote, brace)
    if (content.endsWith('"}')) content = content.slice(0, -2);
    else if (content.endsWith('"')) content = content.slice(0, -1);
    // Unescape JSON string escapes
    try {
      content = JSON.parse('"' + content + '"');
    } catch {
      // Partial JSON — do basic unescaping
      content = content.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    return { toolName: 'write', filePath, content };
  }

  // For bash tool: extract command
  const cmdMatch = raw.match(/"command"\s*:\s*"/);
  if (cmdMatch && cmdMatch.index !== undefined) {
    const start = cmdMatch.index + cmdMatch[0].length;
    let content = raw.slice(start);
    if (content.endsWith('"}')) content = content.slice(0, -2);
    else if (content.endsWith('"')) content = content.slice(0, -1);
    try {
      content = JSON.parse('"' + content + '"');
    } catch {
      content = content.replace(/\\n/g, '\n').replace(/\\"/g, '"');
    }
    return { toolName: 'bash', filePath: '', content };
  }

  return null;
}

export default function ToolCallCard({ tool }: { tool: ToolCall }) {
  const [expanded, setExpanded] = useState(tool.status === 'running');
  const theme = useSettingsStore((s) => s.theme);

  useEffect(() => {
    if (tool.status === 'running') setExpanded(true);
  }, [tool.status]);

  // Parse streaming content for nicer display
  const parsed = useMemo(() => {
    if (!tool.streamContent) return null;
    return extractStreamContent(tool.streamContent);
  }, [tool.streamContent]);

  const displayName = tool.toolName !== 'unknown'
    ? tool.toolName
    : parsed?.toolName ?? 'tool';

  // Extract a human-readable summary from args
  const argsSummary = useMemo(() => {
    if (!tool.args || typeof tool.args !== 'object') return null;
    const a = tool.args as Record<string, unknown>;
    if (a.file_path || a.path) return String(a.file_path ?? a.path);
    if (a.command) return String(a.command);
    return null;
  }, [tool.args]);

  const statusColor = tool.status === 'running'
    ? 'border-amber-500/50'
    : tool.isError
      ? 'border-red-500/50'
      : 'border-green-500/50';

  const headerClass = theme === 'light'
    ? 'bg-slate-900/50 hover:bg-slate-900/60 text-slate-300'
    : 'bg-slate-700/50 hover:bg-slate-700 text-slate-200';

  const bodyClass = theme === 'light'
    ? 'bg-slate-800/50'
    : 'bg-slate-800/50';

  const detailTextClass = theme === 'light' ? 'text-slate-300' : 'text-slate-400';
  const filePathClass = theme === 'light' ? 'text-slate-300' : 'text-slate-400';
  const preClass = theme === 'light' ? 'text-slate-200 bg-slate-900/40' : 'text-slate-300 bg-slate-900/50';

  return (
    <div className={`border ${statusColor} rounded-lg overflow-hidden`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className={`w-full flex items-center gap-2 px-3 py-2 transition-colors text-left ${headerClass}`}
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4" />
        ) : (
          <ChevronRight className="w-4 h-4" />
        )}
        <span className="text-sm font-medium">{displayName}</span>
        {(argsSummary ?? parsed?.filePath) && (
          <span className={`text-xs font-mono ml-1 truncate ${filePathClass}`}>{argsSummary ?? parsed?.filePath}</span>
        )}
        {tool.status === 'running' && (
          <Loader2 className="w-4 h-4 text-amber-500 animate-spin ml-auto" />
        )}
      </button>
      {expanded && (
        <div className={`px-3 py-2 space-y-2 overflow-hidden ${bodyClass}`}>
          {/* Show streaming content while the tool is running. */}
          {parsed && parsed.content ? (
            <div className="min-w-0">
              <pre className={`text-xs rounded p-2 overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap ${preClass}`}>
                {parsed.content}
              </pre>
            </div>
          ) : tool.streamContent ? (
            <div className="min-w-0">
              <pre className={`text-xs rounded p-2 overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap ${preClass}`}>
                {tool.streamContent}
              </pre>
            </div>
          ) : null}
          {tool.result !== undefined && (
            <div>
              <div className={`text-xs mb-1 ${detailTextClass}`}>
                {tool.isError ? 'Error' : 'Result'}
              </div>
              <pre className={`text-xs rounded p-2 overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap ${
                tool.isError ? 'text-red-400 bg-red-900/20' : preClass
              }`}>
                {typeof tool.result === 'string'
                  ? tool.result
                  : JSON.stringify(tool.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
