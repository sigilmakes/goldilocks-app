import { create } from 'zustand';
import { api } from '../api/client';
import { useSettingsStore } from './settings';

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

export const useModelsStore = create<ModelsState>((set, get) => ({
  models: [],
  selectedModel: null,
  isLoading: false,
  error: null,

  fetch: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.get<ModelsResponse>('/models');
      const models = res.models;
      const currentSelected = get().selectedModel;
      const preferredModel = useSettingsStore.getState().defaultModel;
      const validModelIds = new Set(models.map((model) => model.id));
      const nextSelected =
        (currentSelected && validModelIds.has(currentSelected) ? currentSelected : null)
        ?? (preferredModel && validModelIds.has(preferredModel) ? preferredModel : null)
        ?? (models[0]?.id ?? null);

      set({
        models,
        isLoading: false,
        selectedModel: nextSelected,
      });

      if (nextSelected && nextSelected !== currentSelected) {
        try {
          await api.post('/models/select', { modelId: nextSelected });
        } catch (err) {
          console.error('Failed to set initial model on backend:', err);
        }
      }
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
