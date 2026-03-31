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
