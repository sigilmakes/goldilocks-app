import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import type { ToolCall } from '../../store/chat';

interface ToolCallWithStream extends ToolCall {
  streamContent?: string;
}

export default function ToolCallCard({ tool }: { tool: ToolCallWithStream }) {
  // Auto-expand while running so user sees live content
  const [expanded, setExpanded] = useState(tool.status === 'running');

  // Auto-expand when tool starts running
  useEffect(() => {
    if (tool.status === 'running') setExpanded(true);
  }, [tool.status]);

  const statusColor = tool.status === 'running'
    ? 'border-amber-500/50'
    : tool.isError
      ? 'border-red-500/50'
      : 'border-green-500/50';

  return (
    <div className={`border ${statusColor} rounded-lg overflow-hidden`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-slate-700/50 hover:bg-slate-700 transition-colors text-left"
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-slate-400" />
        ) : (
          <ChevronRight className="w-4 h-4 text-slate-400" />
        )}
        <span className="text-sm font-medium text-slate-200">{tool.toolName}</span>
        {tool.status === 'running' && (
          <Loader2 className="w-4 h-4 text-amber-500 animate-spin ml-auto" />
        )}
      </button>
      {expanded && (
        <div className="px-3 py-2 space-y-2 bg-slate-800/50 overflow-hidden">
          {/* Show streaming content while tool args are being generated */}
          {tool.streamContent && (
            <div className="min-w-0">
              <pre className="text-xs text-slate-300 bg-slate-900/50 rounded p-2 overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap">
                {tool.streamContent}
              </pre>
            </div>
          )}
          {/* Show parsed args when available and no stream content */}
          {!tool.streamContent && tool.args && typeof tool.args === 'object' && Object.keys(tool.args as Record<string, unknown>).length > 0 && (
            <div className="min-w-0">
              <div className="text-xs text-slate-500 mb-1">Arguments</div>
              <pre className="text-xs text-slate-300 bg-slate-900/50 rounded p-2 overflow-x-auto max-w-full whitespace-pre-wrap">
                {JSON.stringify(tool.args, null, 2)}
              </pre>
            </div>
          )}
          {tool.result !== undefined && (
            <div>
              <div className="text-xs text-slate-500 mb-1">
                {tool.isError ? 'Error' : 'Result'}
              </div>
              <pre className={`text-xs rounded p-2 overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap ${
                tool.isError ? 'text-red-400 bg-red-900/20' : 'text-slate-300 bg-slate-900/50'
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
