import { Grid3x3, Cpu, ShieldCheck } from 'lucide-react';
import type { PredictionResult } from '../../store/context';

interface KPointsResultCardProps {
  prediction: PredictionResult;
}

export default function KPointsResultCard({ prediction }: KPointsResultCardProps) {
  const {
    kdistMedian,
    kdistLower,
    kdistUpper,
    kGrid,
    isMetal,
    model,
    confidence,
  } = prediction;

  const intervalWidth = kdistUpper - kdistLower;
  const borderColor =
    intervalWidth < 0.08
      ? 'border-green-500'
      : intervalWidth < 0.15
        ? 'border-amber-500'
        : 'border-red-500';

  const confidenceBgColor =
    intervalWidth < 0.08
      ? 'bg-green-500/20 text-green-400'
      : intervalWidth < 0.15
        ? 'bg-amber-500/20 text-amber-400'
        : 'bg-red-500/20 text-red-400';

  // For the confidence interval bar, map values to percentages
  // We define a range for the bar: show from slightly below lower to slightly above upper
  const barMin = Math.max(0, kdistLower - intervalWidth * 0.3);
  const barMax = kdistUpper + intervalWidth * 0.3;
  const barRange = barMax - barMin || 1;

  const lowerPct = ((kdistLower - barMin) / barRange) * 100;
  const medianPct = ((kdistMedian - barMin) / barRange) * 100;
  const upperPct = ((kdistUpper - barMin) / barRange) * 100;

  return (
    <div className={`border-2 ${borderColor} rounded-lg bg-slate-800 overflow-hidden`}>
      {/* Header */}
      <div className="px-4 py-3 bg-slate-700/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Grid3x3 className="w-5 h-5 text-amber-500" />
          <span className="text-sm font-semibold text-white">K-Points Prediction</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Model badge */}
          <span className="px-2 py-0.5 bg-slate-600 rounded text-xs font-medium text-slate-300">
            <Cpu className="w-3 h-3 inline mr-1" />
            {model}
          </span>
          {/* Metal/insulator badge */}
          <span
            className={`px-2 py-0.5 rounded text-xs font-medium ${
              isMetal
                ? 'bg-blue-500/20 text-blue-400'
                : 'bg-purple-500/20 text-purple-400'
            }`}
          >
            {isMetal ? 'Metal' : 'Insulator'}
          </span>
        </div>
      </div>

      <div className="px-4 py-3 space-y-4">
        {/* kdist median — prominent */}
        <div className="text-center">
          <div className="text-3xl font-bold text-white">
            {kdistMedian.toFixed(3)}
          </div>
          <div className="text-xs text-slate-400 mt-1">
            k<sub>dist</sub> (Å⁻¹)
          </div>
        </div>

        {/* Confidence interval bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-slate-400">
            <span>{kdistLower.toFixed(3)}</span>
            <span className="text-slate-300">Confidence Interval</span>
            <span>{kdistUpper.toFixed(3)}</span>
          </div>
          <div className="relative h-3 bg-slate-700 rounded-full overflow-hidden">
            {/* Interval range */}
            <div
              className={`absolute h-full rounded-full ${
                intervalWidth < 0.08
                  ? 'bg-green-500/30'
                  : intervalWidth < 0.15
                    ? 'bg-amber-500/30'
                    : 'bg-red-500/30'
              }`}
              style={{
                left: `${lowerPct}%`,
                width: `${upperPct - lowerPct}%`,
              }}
            />
            {/* Median marker */}
            <div
              className="absolute top-0 h-full w-1 bg-white rounded"
              style={{ left: `${medianPct}%`, transform: 'translateX(-50%)' }}
            />
          </div>
        </div>

        {/* K-grid display */}
        <div className="flex items-center justify-between bg-slate-700/50 rounded-lg px-3 py-2">
          <span className="text-sm text-slate-400">K-Grid</span>
          <span className="text-lg font-mono font-semibold text-white">
            {kGrid[0]} × {kGrid[1]} × {kGrid[2]}
          </span>
        </div>

        {/* Confidence badge */}
        <div className="flex items-center justify-center">
          <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium ${confidenceBgColor}`}>
            <ShieldCheck className="w-3.5 h-3.5" />
            {(confidence * 100).toFixed(0)}% confidence · interval ±{(intervalWidth / 2).toFixed(3)}
          </span>
        </div>
      </div>
    </div>
  );
}
