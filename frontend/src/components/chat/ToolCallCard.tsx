import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { useContextStore, type PredictionResult } from '../../store/context';
import type { ToolCall } from '../../store/chat';
import KPointsResultCard from '../science/KPointsResultCard';
import InputFileCard from '../science/InputFileCard';

/** Attempt to parse a goldilocks predict result from tool output */
export function parsePredictionResult(result: unknown): PredictionResult | null {
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
export function getGoldilocksCommand(args: unknown): string | null {
  if (!args || typeof args !== 'object') return null;
  const a = args as Record<string, unknown>;
  const cmd = String(a.command ?? a.cmd ?? '');
  if (cmd.includes('goldilocks predict') || cmd.includes('goldilocks-predict')) return 'predict';
  if (cmd.includes('goldilocks generate') || cmd.includes('goldilocks-generate')) return 'generate';
  if (cmd.includes('goldilocks search') || cmd.includes('goldilocks-search')) return 'search';
  return null;
}

export default function ToolCallCard({ tool }: { tool: ToolCall }) {
  const [expanded, setExpanded] = useState(false);
  const setPrediction = useContextStore((s) => s.setPrediction);

  // Update context store prediction when a predict tool completes (§4.5)
  const predictionResult = tool.toolName === 'bash' && tool.status === 'done' && !tool.isError
    ? (getGoldilocksCommand(tool.args) === 'predict' ? parsePredictionResult(tool.result) : null)
    : null;

  useEffect(() => {
    if (predictionResult) {
      setPrediction(predictionResult);
    }
  }, [predictionResult, setPrediction]);

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
        <div className="px-3 py-2 space-y-2 bg-slate-800/50 overflow-hidden">
          <div className="min-w-0">
            <div className="text-xs text-slate-500 mb-1">Arguments</div>
            <pre className="text-xs text-slate-300 bg-slate-900/50 rounded p-2 overflow-x-auto max-w-full">
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
