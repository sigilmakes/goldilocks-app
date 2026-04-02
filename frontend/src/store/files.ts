import { create } from 'zustand';
import { api } from '../api/client';

export interface WorkspaceFile {
  name: string;
  size: number;
  isDirectory: boolean;
  modified: number;
}

interface FilesState {
  files: WorkspaceFile[];
  isLoading: boolean;
  error: string | null;

  fetch: () => Promise<void>;
  upload: (file: File) => Promise<void>;
  remove: (filename: string) => Promise<void>;
  clear: () => void;
}

interface FilesResponse {
  files: WorkspaceFile[];
}

export const useFilesStore = create<FilesState>((set, get) => ({
  files: [],
  isLoading: false,
  error: null,

  fetch: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.get<FilesResponse>('/files');
      set({ files: res.files, isLoading: false });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to fetch files';
      set({ error: message, isLoading: false });
    }
  },

  upload: async (file: File) => {
    set({ isLoading: true, error: null });
    try {
      const content = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          const base64 = result.split(',')[1];
          resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      await api.post('/files/upload', { filename: file.name, content });
      await get().fetch();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to upload file';
      set({ error: message, isLoading: false });
      throw err;
    }
  },

  remove: async (filename: string) => {
    try {
      await api.delete(`/files/${filename}`);
      set((state) => ({
        files: state.files.filter((f) => f.name !== filename),
      }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to delete file';
      set({ error: message });
      throw err;
    }
  },

  clear: () => set({ files: [], error: null }),
}));
