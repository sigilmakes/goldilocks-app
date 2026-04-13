import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api } from '../api/client';
import {
  DEFAULT_WORKSPACE_VIEWER_SETTINGS,
  normalizeWorkspaceViewerSettings,
  type WorkspaceViewerSettings,
} from '../lib/fileAssociations';

export interface ApiKeyInfo {
  provider: string;
  hasKey: boolean;
  createdAt?: number;
}

interface SettingsState {
  theme: 'dark' | 'light';
  apiKeys: ApiKeyInfo[];
  defaultModel: string | null;
  defaultFunctional: 'PBEsol' | 'PBE';
  workspaceViewer: WorkspaceViewerSettings;
  isLoading: boolean;
  error: string | null;
  setTheme(theme: 'dark' | 'light'): void;
  fetchSettings(): Promise<void>;
  updateSettings(settings: Partial<{ defaultModel: string; defaultFunctional: string }>): Promise<void>;
  updateWorkspaceViewer(settings: Partial<WorkspaceViewerSettings>): void;
  addApiKey(provider: string, key: string): Promise<void>;
  removeApiKey(provider: string): Promise<void>;
  fetchApiKeys(): Promise<void>;
}

export interface ServerSettings {
  defaultModel: string | null;
  defaultFunctional: 'PBEsol' | 'PBE';
}

interface SettingsResponse {
  settings: ServerSettings;
}

interface ApiKeysResponse {
  apiKeys: ApiKeyInfo[];
}

function applyTheme(theme: 'dark' | 'light') {
  if (theme === 'dark') {
    document.documentElement.classList.add('dark');
    document.documentElement.classList.remove('light');
  } else {
    document.documentElement.classList.add('light');
    document.documentElement.classList.remove('dark');
  }
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'dark',
      apiKeys: [],
      defaultModel: null,
      defaultFunctional: 'PBEsol',
      workspaceViewer: DEFAULT_WORKSPACE_VIEWER_SETTINGS,
      isLoading: false,
      error: null,

      setTheme: (theme) => {
        set({ theme });
        applyTheme(theme);
      },

      fetchSettings: async () => {
        set({ isLoading: true, error: null });
        try {
          const res = await api.get<SettingsResponse>('/settings');
          const s = res.settings;
          set({
            defaultModel: s.defaultModel ?? null,
            defaultFunctional: s.defaultFunctional ?? 'PBEsol',
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
          const res = await api.patch<SettingsResponse>('/settings', settings);
          const s = res.settings;
          set({
            defaultModel: s.defaultModel ?? null,
            defaultFunctional: s.defaultFunctional ?? 'PBEsol',
            isLoading: false,
          });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Failed to update settings';
          set({ error: message, isLoading: false });
        }
      },

      updateWorkspaceViewer: (settings) => {
        set((state) => ({
          workspaceViewer: normalizeWorkspaceViewerSettings({
            ...state.workspaceViewer,
            ...settings,
          }),
        }));
      },

      addApiKey: async (provider, key) => {
        set({ isLoading: true, error: null });
        try {
          await api.put('/settings/api-key', { provider, key });
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
              k.provider === provider ? { ...k, hasKey: false } : k
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
      partialize: (state) => ({
        theme: state.theme,
        workspaceViewer: state.workspaceViewer,
      }),
      merge: (persisted, current) => {
        const typedPersisted = persisted as Partial<SettingsState> | undefined;
        return {
          ...current,
          ...typedPersisted,
          workspaceViewer: normalizeWorkspaceViewerSettings({
            ...DEFAULT_WORKSPACE_VIEWER_SETTINGS,
            ...typedPersisted?.workspaceViewer,
          }),
        } satisfies SettingsState;
      },
      onRehydrateStorage: () => (state) => {
        if (state) applyTheme(state.theme);
      },
    }
  )
);
