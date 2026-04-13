import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api } from '../api/client';
import { resetUserScopedFrontendState } from './session-reset';

interface AuthResponse {
  token: string;
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
}

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName?: string) => Promise<void>;
  logout: () => void;
  clearError: () => void;
  checkAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
      
      login: async (email, password) => {
        set({ isLoading: true, error: null });
        try {
          const res = await api.post<AuthResponse>('/auth/login', { email, password });
          resetUserScopedFrontendState();
          set({
            user: res.user,
            token: res.token,
            isAuthenticated: true,
            isLoading: false,
          });
        } catch (err: any) {
          set({
            error: err.message ?? 'Login failed',
            isLoading: false,
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
            token: res.token,
            isAuthenticated: true,
            isLoading: false,
          });
        } catch (err: any) {
          set({
            error: err.message ?? 'Registration failed',
            isLoading: false,
          });
          throw err;
        }
      },
      
      logout: () => {
        resetUserScopedFrontendState();
        set({
          user: null,
          token: null,
          isAuthenticated: false,
        });
      },
      
      clearError: () => set({ error: null }),
      
      checkAuth: async () => {
        const { token } = get();
        if (!token) return;
        
        try {
          const res = await api.get<MeResponse>('/auth/me');
          set({ user: res.user, isAuthenticated: true });
        } catch {
          resetUserScopedFrontendState();
          set({ user: null, token: null, isAuthenticated: false });
        }
      },
    }),
    {
      name: 'goldilocks-auth',
      partialize: (state) => ({ token: state.token }),
    }
  )
);
