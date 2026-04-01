import { create } from 'zustand';

export interface StructureInfo {
  formula: string;
  spacegroup: string;
  spacegroupNumber: number;
  latticeSystem: string;
  a: number;
  b: number;
  c: number;
  alpha: number;
  beta: number;
  gamma: number;
  volume: number;
  natoms: number;
  species: string[];
  density: number;
  filePath: string;
}

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
  // Current structure
  structure: StructureInfo | null;
  // Parameters
  functional: 'PBEsol' | 'PBE';
  pseudoMode: 'efficiency' | 'precision';
  mlModel: 'ALIGNN' | 'RF';
  confidence: number;
  // Last prediction
  prediction: PredictionResult | null;
  // Actions
  setStructure: (info: StructureInfo | null) => void;
  setFunctional: (f: 'PBEsol' | 'PBE') => void;
  setPseudoMode: (m: 'efficiency' | 'precision') => void;
  setMlModel: (m: 'ALIGNN' | 'RF') => void;
  setConfidence: (c: number) => void;
  setPrediction: (p: PredictionResult | null) => void;
  reset: () => void;
}

const initialState = {
  structure: null,
  functional: 'PBEsol' as const,
  pseudoMode: 'efficiency' as const,
  mlModel: 'ALIGNN' as const,
  confidence: 0.90,
  prediction: null,
};

export const useContextStore = create<ContextState>((set) => ({
  ...initialState,

  setStructure: (info) => set({ structure: info }),
  setFunctional: (f) => set({ functional: f }),
  setPseudoMode: (m) => set({ pseudoMode: m }),
  setMlModel: (m) => set({ mlModel: m }),
  setConfidence: (c) => set({ confidence: c }),
  setPrediction: (p) => set({ prediction: p }),
  reset: () => set({ ...initialState }),
}));
