import { create } from 'zustand';
import { api, type FileEntry } from '../api/client';

export interface WorkspaceFile {
  name: string;
  path: string;
  size: number;
  isDirectory: boolean;
  modified: number;
}

interface FilesState {
  tree: FileEntry[];
  files: WorkspaceFile[];
  revision: number;
  isLoading: boolean;
  error: string | null;

  fetch: () => Promise<void>;
  upload: (file: File) => Promise<void>;
  remove: (path: string) => Promise<void>;
  touch: () => void;
  clear: () => void;
}

interface FilesResponse {
  entries: FileEntry[];
}

function flattenEntries(entries: FileEntry[], out: WorkspaceFile[] = []): WorkspaceFile[] {
  for (const entry of entries) {
    out.push({
      name: entry.name,
      path: entry.path,
      size: entry.size ?? 0,
      isDirectory: entry.type === 'dir',
      modified: entry.modified ?? 0,
    });
    if (entry.children) flattenEntries(entry.children, out);
  }
  return out;
}

export const useFilesStore = create<FilesState>((set, get) => ({
  tree: [],
  files: [],
  revision: 0,
  isLoading: false,
  error: null,

  fetch: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.get<FilesResponse>('/files');
      const tree = res.entries || [];
      set((state) => ({
        tree,
        files: flattenEntries(tree),
        revision: state.revision + 1,
        isLoading: false,
      }));
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

      const res = await api.post<{ ok: true; name: string; path: string; size: number }>('/files/upload', {
        filename: file.name,
        content,
        contentType: file.type || 'application/octet-stream',
      });
      set((state) => ({
        files: state.files.some((existing) => existing.path === res.path)
          ? state.files
          : [
              {
                name: res.name,
                path: res.path,
                size: res.size,
                isDirectory: false,
                modified: Date.now(),
              },
              ...state.files,
            ],
        revision: state.revision + 1,
        isLoading: false,
      }));
      void get().fetch();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to upload file';
      set({ error: message, isLoading: false });
      throw err;
    }
  },

  remove: async (path: string) => {
    try {
      await api.delete(`/files/${encodeURIComponent(path)}`);
      set((state) => ({
        files: state.files.filter((file) => file.path !== path),
        revision: state.revision + 1,
      }));
      void get().fetch();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to delete file';
      set({ error: message });
      throw err;
    }
  },

  touch: () => set((state) => ({ revision: state.revision + 1 })),

  clear: () => set({ files: [], tree: [], revision: 0, error: null }),
}));