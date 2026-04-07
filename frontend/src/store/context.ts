import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface PredictionResult {
  kdistMedian: number;
  kdistLower: number;
  kdistUpper: number;
  kGrid: [number, number, number];
  isMetal: boolean;
  model: 'ALIGNN' | 'RF';
  confidence: number;
}

export interface GenerationDefaults {
  functional: 'PBEsol' | 'PBE';
  pseudoMode: 'efficiency' | 'precision';
  model: 'ALIGNN' | 'RF';
  confidence: 0.85 | 0.9 | 0.95;
}

interface ContextState {
  prediction: PredictionResult | null;
  generationDefaults: GenerationDefaults;
  setPrediction: (p: PredictionResult | null) => void;
  updateGenerationDefaults: (patch: Partial<GenerationDefaults>) => void;
  reset: () => void;
}

const defaultGenerationDefaults: GenerationDefaults = {
  functional: 'PBEsol',
  pseudoMode: 'efficiency',
  model: 'ALIGNN',
  confidence: 0.95,
};

export const useContextStore = create<ContextState>()(
  persist(
    (set) => ({
      prediction: null,
      generationDefaults: defaultGenerationDefaults,
      setPrediction: (p) => set({ prediction: p }),
      updateGenerationDefaults: (patch) =>
        set((state) => ({
          generationDefaults: { ...state.generationDefaults, ...patch },
        })),
      reset: () => set({ prediction: null }),
    }),
    {
      name: 'goldilocks-context',
      partialize: (state) => ({ generationDefaults: state.generationDefaults }),
    }
  )
);
