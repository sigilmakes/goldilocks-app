import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api } from '../api/client';

export interface ApiKeyInfo {
  provider: string;
  hasKey: boolean;
  isServerKey: boolean;
  createdAt?: number;
}

interface SettingsState {
  // Theme
  theme: 'dark' | 'light';
  // API keys (metadata only)
  apiKeys: ApiKeyInfo[];
  // User preferences
  defaultModel: string | null;
  defaultFunctional: 'PBEsol' | 'PBE';
  // Loading state
  isLoading: boolean;
  error: string | null;
  // Actions
  setTheme(theme: 'dark' | 'light'): void;
  fetchSettings(): Promise<void>;
  updateSettings(settings: Partial<{ defaultModel: string; defaultFunctional: string }>): Promise<void>;
  addApiKey(provider: string, key: string): Promise<void>;
  removeApiKey(provider: string): Promise<void>;
  fetchApiKeys(): Promise<void>;
}

interface SettingsResponse {
  defaultModel?: string;
  defaultFunctional?: string;
}

interface ApiKeysResponse {
  apiKeys: ApiKeyInfo[];
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'dark',
      apiKeys: [],
      defaultModel: null,
      defaultFunctional: 'PBEsol',
      isLoading: false,
      error: null,

      setTheme: (theme) => {
        set({ theme });
        // Apply theme to document root
        if (theme === 'dark') {
          document.documentElement.classList.add('dark');
          document.documentElement.classList.remove('light');
        } else {
          document.documentElement.classList.add('light');
          document.documentElement.classList.remove('dark');
        }
      },

      fetchSettings: async () => {
        set({ isLoading: true, error: null });
        try {
          const res = await api.get<SettingsResponse>('/settings');
          set({
            defaultModel: res.defaultModel ?? null,
            defaultFunctional: (res.defaultFunctional as 'PBEsol' | 'PBE') ?? 'PBEsol',
            isLoading: false,
          });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Failed to fetch settings';
          set({ error: message, isLoading: false });
        }
      },

      updateSettings: async (settings) => {
        set({ isLoading: true, error: null });
        try {
          await api.patch('/settings', settings);
          set((state) => ({
            defaultModel: settings.defaultModel ?? state.defaultModel,
            defaultFunctional: (settings.defaultFunctional as 'PBEsol' | 'PBE') ?? state.defaultFunctional,
            isLoading: false,
          }));
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Failed to update settings';
          set({ error: message, isLoading: false });
        }
      },

      addApiKey: async (provider, key) => {
        set({ isLoading: true, error: null });
        try {
          await api.put('/settings/api-key', { provider, key });
          // Refresh API keys after adding
          const res = await api.get<ApiKeysResponse>('/settings/api-keys');
          set({ apiKeys: res.apiKeys, isLoading: false });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Failed to add API key';
          set({ error: message, isLoading: false });
          throw err;
        }
      },

      removeApiKey: async (provider) => {
        set({ isLoading: true, error: null });
        try {
          await api.delete(`/settings/api-key/${provider}`);
          set((state) => ({
            apiKeys: state.apiKeys.map((k) =>
              k.provider === provider ? { ...k, hasKey: false, isServerKey: false } : k
            ),
            isLoading: false,
          }));
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Failed to remove API key';
          set({ error: message, isLoading: false });
          throw err;
        }
      },

      fetchApiKeys: async () => {
        set({ isLoading: true, error: null });
        try {
          const res = await api.get<ApiKeysResponse>('/settings/api-keys');
          set({ apiKeys: res.apiKeys, isLoading: false });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Failed to fetch API keys';
          set({ error: message, isLoading: false });
        }
      },
    }),
    {
      name: 'goldilocks-settings',
      partialize: (state) => ({ theme: state.theme }),
    }
  )
);
