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
  
  fetch: (conversationId: string) => Promise<void>;
  upload: (conversationId: string, file: File) => Promise<void>;
  remove: (conversationId: string, filename: string) => Promise<void>;
  clear: () => void;
}

interface FilesResponse {
  files: WorkspaceFile[];
}

interface UploadResponse {
  file: {
    name: string;
    path: string;
    size: number;
  };
}

export const useFilesStore = create<FilesState>((set, get) => ({
  files: [],
  isLoading: false,
  error: null,

  fetch: async (conversationId: string) => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.get<FilesResponse>(`/conversations/${conversationId}/files`);
      set({ files: res.files, isLoading: false });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to fetch files';
      set({ error: message, isLoading: false });
    }
  },

  upload: async (conversationId: string, file: File) => {
    set({ isLoading: true, error: null });
    try {
      // Read file as base64
      const content = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          // Remove data URL prefix
          const base64 = result.split(',')[1];
          resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      await api.post<UploadResponse>(`/conversations/${conversationId}/upload`, {
        filename: file.name,
        content,
      });

      // Refresh file list
      await get().fetch(conversationId);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to upload file';
      set({ error: message, isLoading: false });
      throw err;
    }
  },

  remove: async (conversationId: string, filename: string) => {
    try {
      await api.delete(`/conversations/${conversationId}/files/${filename}`);
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
