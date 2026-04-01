import { useState, useRef, useEffect } from 'react';
import { Send, Paperclip, Sparkles, Square, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { useChatStore, type ChatMessage, type AssistantBlock, type ToolCall } from '../../store/chat';
import { useConversationsStore } from '../../store/conversations';
import { useAgent } from '../../hooks/useAgent';
import { useContextStore, type PredictionResult } from '../../store/context';
import KPointsResultCard from '../science/KPointsResultCard';
import InputFileCard from '../science/InputFileCard';

export default function ChatPanel() {
  const [message, setMessage] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  const { messages, isStreaming, currentText, currentThinking, activeTools } = useChatStore();
  const activeConversationId = useConversationsStore((s) => s.activeConversationId);
  const { send, abort, isReady, error } = useAgent(activeConversationId);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, currentText, currentThinking]);

  const handleSend = () => {
    const text = message.trim();
    if (!text || !isReady || isStreaming) return;
    send(text);
    setMessage('');
  };

  const hasMessages = messages.length > 0 || isStreaming;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-4 min-h-0">
        {!activeConversationId ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-slate-400">Select or create a conversation to start</p>
          </div>
        ) : !hasMessages ? (
          <WelcomeMessage />
        ) : (
          <div className="space-y-4 max-w-3xl mx-auto">
            {messages.map((msg, i) => (
              <MessageBubble key={i} message={msg} />
            ))}
            
            {/* Streaming content */}
            {isStreaming && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                  <Sparkles className="w-4 h-4 text-amber-500" />
                </div>
                <div className="flex-1 space-y-2">
                  {currentThinking && (
                    <ThinkingBlock content={currentThinking} />
                  )}
                  {currentText && (
                    <div className="text-slate-200 whitespace-pre-wrap">{currentText}</div>
                  )}
                  {Array.from(activeTools.values()).map((tool) => (
                    <ToolCallCard key={tool.toolCallId} tool={tool} />
                  ))}
                  {!currentText && !currentThinking && activeTools.size === 0 && (
                    <div className="flex items-center gap-2 text-slate-400">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Thinking...</span>
                    </div>
                  )}
                </div>
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </div>
        )}
        
        {error && (
          <div className="max-w-3xl mx-auto mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="border-t border-slate-700 p-4">
        <div className="max-w-3xl mx-auto flex items-end gap-2">
          <button
            className="p-2 text-slate-400 hover:text-slate-300 hover:bg-slate-700 rounded-lg transition-colors"
            title="Attach file"
          >
            <Paperclip className="w-5 h-5" />
          </button>
          
          <div className="flex-1 relative">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={
                !activeConversationId 
                  ? "Create or select a conversation first..." 
                  : isReady 
                    ? "Ask about DFT calculations or upload a structure..." 
                    : "Connecting..."
              }
              disabled={!isReady || !activeConversationId}
              className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent resize-none disabled:opacity-50"
              rows={1}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
            />
          </div>

          {isStreaming ? (
            <button
              onClick={abort}
              className="p-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors"
              title="Stop"
            >
              <Square className="w-5 h-5" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              className="p-2 bg-amber-500 hover:bg-amber-600 disabled:bg-amber-500/50 text-white rounded-lg transition-colors"
              disabled={!message.trim() || !isReady}
            >
              <Send className="w-5 h-5" />
            </button>
          )}
        </div>
        <div className="mt-2 text-xs text-slate-500 text-center">
          Press Enter to send, Shift+Enter for new line
        </div>
      </div>
    </div>
  );
}

function WelcomeMessage() {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-4">
      <div className="w-16 h-16 bg-amber-500/20 rounded-full flex items-center justify-center mb-4">
        <Sparkles className="w-8 h-8 text-amber-500" />
      </div>
      <h2 className="text-xl font-semibold text-white mb-2">
        Welcome to Goldilocks
      </h2>
      <p className="text-slate-400 max-w-md mb-6">
        I can help you generate Quantum ESPRESSO input files with ML-predicted 
        k-point grids. Upload a crystal structure to get started, or ask me anything 
        about DFT calculations.
      </p>
      <div className="flex flex-wrap gap-2 justify-center">
        {[
          'Upload a CIF file',
          'Search for BaTiO3',
          'Explain k-point convergence',
          'Help me set up an SCF calculation',
        ].map((suggestion) => (
          <button
            key={suggestion}
            className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm text-slate-300 transition-colors"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === 'user') {
    return (
      <div className="flex gap-3 justify-end">
        <div className="max-w-[80%] bg-amber-500/20 rounded-lg px-4 py-2">
          <p className="text-slate-200 whitespace-pre-wrap">{message.text}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center flex-shrink-0">
        <Sparkles className="w-4 h-4 text-amber-500" />
      </div>
      <div className="flex-1 space-y-2">
        {message.blocks.map((block, i) => (
          <AssistantBlockRenderer key={i} block={block} />
        ))}
      </div>
    </div>
  );
}

function AssistantBlockRenderer({ block }: { block: AssistantBlock }) {
  if (block.type === 'text') {
    return <div className="text-slate-200 whitespace-pre-wrap">{block.content}</div>;
  }

  if (block.type === 'thinking') {
    return <ThinkingBlock content={block.content} />;
  }

  if (block.type === 'tool_call') {
    return <ToolCallCard tool={block.data} />;
  }

  return null;
}

function ThinkingBlock({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-slate-600 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-slate-700/50 hover:bg-slate-700 transition-colors text-left"
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-slate-400" />
        ) : (
          <ChevronRight className="w-4 h-4 text-slate-400" />
        )}
        <span className="text-sm text-slate-400">Thinking</span>
      </button>
      {expanded && (
        <div className="px-3 py-2 text-sm text-slate-400 whitespace-pre-wrap bg-slate-800/50">
          {content}
        </div>
      )}
    </div>
  );
}

/** Attempt to parse a goldilocks predict result from tool output */
function parsePredictionResult(result: unknown): PredictionResult | null {
  try {
    const text = typeof result === 'string' ? result : JSON.stringify(result);
    const json = typeof result === 'string' ? JSON.parse(result) : result;
    if (json && typeof json === 'object' && 'kdist_median' in (json as Record<string, unknown>)) {
      const r = json as Record<string, unknown>;
      return {
        kdistMedian: Number(r.kdist_median ?? r.kdistMedian),
        kdistLower: Number(r.kdist_lower ?? r.kdistLower),
        kdistUpper: Number(r.kdist_upper ?? r.kdistUpper),
        kGrid: (r.k_grid ?? r.kGrid ?? [1, 1, 1]) as [number, number, number],
        isMetal: Boolean(r.is_metal ?? r.isMetal),
        model: (r.model as 'ALIGNN' | 'RF') ?? 'ALIGNN',
        confidence: Number(r.confidence ?? 0.9),
      };
    }
    // Try parsing from text output
    const medianMatch = text.match(/kdist[_\s]*median[":\s]+([\d.]+)/i);
    if (medianMatch) {
      const lowerMatch = text.match(/kdist[_\s]*lower[":\s]+([\d.]+)/i);
      const upperMatch = text.match(/kdist[_\s]*upper[":\s]+([\d.]+)/i);
      const gridMatch = text.match(/k[_\s]*grid[":\s]+\[?(\d+)[,\sx×]+(\d+)[,\sx×]+(\d+)/i);
      const metalMatch = text.match(/is[_\s]*metal[":\s]+(true|false)/i);
      return {
        kdistMedian: parseFloat(medianMatch[1]),
        kdistLower: lowerMatch ? parseFloat(lowerMatch[1]) : parseFloat(medianMatch[1]) - 0.03,
        kdistUpper: upperMatch ? parseFloat(upperMatch[1]) : parseFloat(medianMatch[1]) + 0.03,
        kGrid: gridMatch ? [parseInt(gridMatch[1]), parseInt(gridMatch[2]), parseInt(gridMatch[3])] : [4, 4, 4],
        isMetal: metalMatch ? metalMatch[1] === 'true' : false,
        model: 'ALIGNN',
        confidence: 0.9,
      };
    }
  } catch {
    // not parseable
  }
  return null;
}

/** Check if bash args contain a specific goldilocks subcommand */
function getGoldilocksCommand(args: unknown): string | null {
  if (!args || typeof args !== 'object') return null;
  const a = args as Record<string, unknown>;
  const cmd = String(a.command ?? a.cmd ?? '');
  if (cmd.includes('goldilocks predict') || cmd.includes('goldilocks-predict')) return 'predict';
  if (cmd.includes('goldilocks generate') || cmd.includes('goldilocks-generate')) return 'generate';
  if (cmd.includes('goldilocks search') || cmd.includes('goldilocks-search')) return 'search';
  return null;
}

function ToolCallCard({ tool }: { tool: ToolCall }) {
  const [expanded, setExpanded] = useState(false);
  const setPrediction = useContextStore((s) => s.setPrediction);

  const statusColor = tool.status === 'running' 
    ? 'border-amber-500/50' 
    : tool.isError 
      ? 'border-red-500/50' 
      : 'border-green-500/50';

  // Try to render specialized cards for goldilocks tool calls
  if (tool.toolName === 'bash' && tool.status === 'done' && !tool.isError && tool.result !== undefined) {
    const cmd = getGoldilocksCommand(tool.args);

    if (cmd === 'predict') {
      const prediction = parsePredictionResult(tool.result);
      if (prediction) {
        // Side-effect: update context store (only on first render via ref would be cleaner,
        // but for simplicity we rely on Zustand's shallow equality check)
        try { setPrediction(prediction); } catch { /* noop */ }
        return <KPointsResultCard prediction={prediction} />;
      }
    }

    if (cmd === 'generate') {
      const resultText = typeof tool.result === 'string' ? tool.result : JSON.stringify(tool.result, null, 2);
      // Extract filename from the command args if possible
      const argsStr = typeof tool.args === 'object' ? JSON.stringify(tool.args) : String(tool.args);
      const fnMatch = argsStr.match(/(-o|--output)\s+([\w./-]+)/)
        ?? argsStr.match(/([\w-]+\.(?:in|pw\.in))/i);
      const filename = fnMatch ? fnMatch[fnMatch.length - 1] : 'pw.in';
      if (resultText.length > 20) {
        return <InputFileCard content={resultText} filename={filename} />;
      }
    }

    if (cmd === 'search') {
      // Try to render a simple table from search results
      try {
        const data = typeof tool.result === 'string' ? JSON.parse(tool.result as string) : tool.result;
        if (data && typeof data === 'object' && 'results' in (data as Record<string, unknown>)) {
          const results = (data as { results: Array<{ id: string; formula: string; spacegroup?: string; natoms?: number }> }).results;
          return (
            <div className="border border-slate-600 rounded-lg bg-slate-800 overflow-hidden">
              <div className="px-3 py-2 bg-slate-700/50 text-sm font-medium text-white">Search Results ({results.length})</div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-700">
                    <th className="text-left py-1.5 px-3 text-slate-400">ID</th>
                    <th className="text-left py-1.5 px-3 text-slate-400">Formula</th>
                    <th className="text-left py-1.5 px-3 text-slate-400">Space Group</th>
                    <th className="text-right py-1.5 px-3 text-slate-400">Atoms</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r, i) => (
                    <tr key={i} className="border-b border-slate-700/50">
                      <td className="py-1.5 px-3 text-slate-300 font-mono">{r.id}</td>
                      <td className="py-1.5 px-3 text-white">{r.formula}</td>
                      <td className="py-1.5 px-3 text-slate-300">{r.spacegroup ?? '—'}</td>
                      <td className="py-1.5 px-3 text-slate-300 text-right">{r.natoms ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
      } catch { /* fall through to default */ }
    }
  }

  // Default card
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
        <div className="px-3 py-2 space-y-2 bg-slate-800/50">
          <div>
            <div className="text-xs text-slate-500 mb-1">Arguments</div>
            <pre className="text-xs text-slate-300 bg-slate-900/50 rounded p-2 overflow-x-auto">
              {JSON.stringify(tool.args, null, 2)}
            </pre>
          </div>
          {tool.result !== undefined && (
            <div>
              <div className="text-xs text-slate-500 mb-1">Result</div>
              <pre className="text-xs text-slate-300 bg-slate-900/50 rounded p-2 overflow-x-auto">
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
