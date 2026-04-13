import { useAuthStore } from '../store/auth';

const API_BASE = '/api';

class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  method: string,
  path: string,
  data?: unknown
): Promise<T> {
  const token = useAuthStore.getState().token;
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
  });
  
  const json = await res.json().catch(() => ({}));
  
  if (!res.ok) {
    throw new ApiError(
      json.error ?? `Request failed with status ${res.status}`,
      res.status,
      json
    );
  }
  
  return json as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, data?: unknown) => request<T>('POST', path, data),
  patch: <T>(path: string, data?: unknown) => request<T>('PATCH', path, data),
  put: <T>(path: string, data?: unknown) => request<T>('PUT', path, data),
  delete: <T>(path: string) => request<T>('DELETE', path),
};

// ─── File API ────────────────────────────────────────────────────────────────

export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children?: FileEntry[];
  size?: number;
  modified?: number;
}

export async function fetchFiles(search?: string): Promise<{ entries: FileEntry[] }> {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  const qs = params.toString();
  return api.get<{ entries: FileEntry[] }>(`/files${qs ? `?${qs}` : ''}`);
}

export async function fetchFile(path: string): Promise<{ content: string }> {
  return api.get<{ content: string }>(`/files/${encodeURIComponent(path)}`);
}

export async function putFile(path: string, content: string): Promise<void> {
  await api.put(`/files/${encodeURIComponent(path)}`, { content });
}

export async function deleteFile(path: string): Promise<void> {
  await api.delete(`/files/${encodeURIComponent(path)}`);
}

export async function moveFile(from: string, to: string): Promise<void> {
  await api.post('/files/move', { from, to });
}

export async function mkdir(path: string): Promise<void> {
  await api.post('/files/mkdir', { path });
}

export function rawFileUrl(path: string): string {
  return `/api/files/${encodeURIComponent(path)}/raw`;
}

export function getAuthHeaders(): Record<string, string> {
  const token = useAuthStore.getState().token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function downloadWorkspaceFile(path: string): Promise<void> {
  const res = await fetch(rawFileUrl(path), { headers: getAuthHeaders() });
  if (!res.ok) {
    throw new ApiError(`Request failed with status ${res.status}`, res.status);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = path.split('/').pop() ?? path;
  a.click();
  URL.revokeObjectURL(url);
}
