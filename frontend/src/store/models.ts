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
  setSelected: (modelId: string) => Promise<void>;
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
        selectedModel: models.length > 0 ? models[0].id : null,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to fetch models';
      set({ error: message, isLoading: false });
    }
  },

  setSelected: async (modelId: string) => {
    set({ selectedModel: modelId });
    try {
      await api.post('/models/select', { modelId });
    } catch (err) {
      console.error('Failed to set model on backend:', err);
    }
  },
}));
