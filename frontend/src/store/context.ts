import { create } from 'zustand';

export interface PredictionResult {
  kdistMedian: number;
  kdistLower: number;
  kdistUpper: number;
  kGrid: [number, number, number];
  isMetal: boolean;
  model: 'ALIGNN' | 'RF';
  confidence: number;
}

interface ContextState {
  // Last prediction result (set by ToolCallCard when predict tool completes)
  prediction: PredictionResult | null;
  setPrediction: (p: PredictionResult | null) => void;
  reset: () => void;
}

export const useContextStore = create<ContextState>((set) => ({
  prediction: null,
  setPrediction: (p) => set({ prediction: p }),
  reset: () => set({ prediction: null }),
}));
