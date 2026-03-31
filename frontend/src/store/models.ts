import { create } from 'zustand';
import { api } from '../api/client';

export interface Model {
  id: string;
  provider: string;
  name: string;
  contextWindow: number;
  supportsThinking: boolean;
}

interface ModelsState {
  models: Model[];
  selectedModel: string | null;
  isLoading: boolean;
  error: string | null;
  
  fetch: () => Promise<void>;
  setSelected: (modelId: string) => void;
}

interface ModelsResponse {
  models: Model[];
}

export const useModelsStore = create<ModelsState>((set) => ({
  models: [],
  selectedModel: null,
  isLoading: false,
  error: null,

  fetch: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.get<ModelsResponse>('/models');
      const models = res.models;
      set({ 
        models, 
        isLoading: false,
        // Auto-select first model if none selected
        selectedModel: models.length > 0 ? models[0].id : null,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to fetch models';
      set({ error: message, isLoading: false });
    }
  },

  setSelected: (modelId: string) => {
    set({ selectedModel: modelId });
  },
}));
