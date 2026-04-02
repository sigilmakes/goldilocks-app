import { Grid3x3, RefreshCw, ShieldCheck } from 'lucide-react';
import { useContextStore } from '../../store/context';

export default function PredictionSummary() {
  const prediction = useContextStore((s) => s.prediction);

  if (!prediction) {
    return (
      <div className="bg-slate-700/50 rounded-lg p-3">
        <h3 className="text-sm font-medium text-white mb-2">Prediction</h3>
        <p className="text-sm text-slate-400">No prediction yet</p>
      </div>
    );
  }

  const { kdistMedian, kdistLower, kdistUpper, kGrid, confidence, model } = prediction;
  const intervalWidth = kdistUpper - kdistLower;

  const barMin = Math.max(0, kdistLower - intervalWidth * 0.3);
  const barMax = kdistUpper + intervalWidth * 0.3;
  const barRange = barMax - barMin || 1;

  const lowerPct = ((kdistLower - barMin) / barRange) * 100;
  const medianPct = ((kdistMedian - barMin) / barRange) * 100;
  const upperPct = ((kdistUpper - barMin) / barRange) * 100;

  const intervalColor =
    intervalWidth < 0.08
      ? 'bg-green-500/30'
      : intervalWidth < 0.15
        ? 'bg-amber-500/30'
        : 'bg-red-500/30';

  const badgeColor =
    intervalWidth < 0.08
      ? 'text-green-400'
      : intervalWidth < 0.15
        ? 'text-amber-400'
        : 'text-red-400';

  return (
    <div className="bg-slate-700/50 rounded-lg p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Grid3x3 className="w-4 h-4 text-amber-500" />
          <h3 className="text-sm font-medium text-white">Last Prediction</h3>
        </div>
        <span className="text-xs text-slate-500">{model}</span>
      </div>

      {/* Key values */}
      <div className="grid grid-cols-2 gap-2 text-center">
        <div className="bg-slate-800/50 rounded px-2 py-1.5">
          <div className="text-lg font-bold text-white">{kdistMedian.toFixed(3)}</div>
          <div className="text-[10px] text-slate-400">k<sub>dist</sub></div>
        </div>
        <div className="bg-slate-800/50 rounded px-2 py-1.5">
          <div className="text-lg font-bold text-white font-mono">
            {kGrid[0]}×{kGrid[1]}×{kGrid[2]}
          </div>
          <div className="text-[10px] text-slate-400">Grid</div>
        </div>
      </div>

      {/* Mini confidence interval */}
      <div className="space-y-1">
        <div className="relative h-2 bg-slate-800 rounded-full overflow-hidden">
          <div
            className={`absolute h-full rounded-full ${intervalColor}`}
            style={{
              left: `${lowerPct}%`,
              width: `${upperPct - lowerPct}%`,
            }}
          />
          <div
            className="absolute top-0 h-full w-0.5 bg-white rounded"
            style={{ left: `${medianPct}%`, transform: 'translateX(-50%)' }}
          />
        </div>
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-slate-500">{kdistLower.toFixed(3)}</span>
          <span className={`flex items-center gap-0.5 ${badgeColor}`}>
            <ShieldCheck className="w-3 h-3" />
            {(confidence * 100).toFixed(0)}%
          </span>
          <span className="text-slate-500">{kdistUpper.toFixed(3)}</span>
        </div>
      </div>

      {/* Run again placeholder */}
      <button
        className="w-full flex items-center justify-center gap-1.5 py-1.5 bg-slate-600 hover:bg-slate-500 text-slate-300 hover:text-white rounded text-xs transition-colors"
      >
        <RefreshCw className="w-3 h-3" />
        Run again
      </button>
    </div>
  );
}
