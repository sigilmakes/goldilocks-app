import { create } from 'zustand';
import { api } from '../api/client';
import { resetUserScopedFrontendState } from './session-reset';

interface AuthResponse {
  user: User;
}

interface MeResponse {
  user: User;
}

export interface User {
  id: string;
  email: string;
  displayName: string | null;
  settings: Record<string, unknown>;
  createdAt?: number;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  hasCheckedAuth: boolean;
  error: string | null;

  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName?: string) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
  checkAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: false,
  hasCheckedAuth: false,
  error: null,

  login: async (email, password) => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.post<AuthResponse>('/auth/login', { email, password });
      resetUserScopedFrontendState();
      set({
        user: res.user,
        isAuthenticated: true,
        isLoading: false,
        hasCheckedAuth: true,
      });
    } catch (err: any) {
      set({
        error: err.message ?? 'Login failed',
        isLoading: false,
        hasCheckedAuth: true,
      });
      throw err;
    }
  },

  register: async (email, password, displayName) => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.post<AuthResponse>('/auth/register', { email, password, displayName });
      resetUserScopedFrontendState();
      set({
        user: res.user,
        isAuthenticated: true,
        isLoading: false,
        hasCheckedAuth: true,
      });
    } catch (err: any) {
      set({
        error: err.message ?? 'Registration failed',
        isLoading: false,
        hasCheckedAuth: true,
      });
      throw err;
    }
  },

  logout: async () => {
    set({ isLoading: true });
    try {
      await api.post('/auth/logout');
    } catch {
      // If the cookie is already gone, local cleanup still matters.
    } finally {
      resetUserScopedFrontendState();
      set({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        hasCheckedAuth: true,
        error: null,
      });
    }
  },

  clearError: () => set({ error: null }),

  checkAuth: async () => {
    set({ isLoading: true });
    try {
      const res = await api.get<MeResponse>('/auth/me');
      set({
        user: res.user,
        isAuthenticated: true,
        isLoading: false,
        hasCheckedAuth: true,
      });
    } catch {
      resetUserScopedFrontendState();
      set({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        hasCheckedAuth: true,
      });
    }
  },
}));
