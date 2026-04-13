import { create } from 'zustand';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  createdAt: number;
}

interface ToastState {
  toasts: Toast[];
  addToast: (message: string, type?: ToastType) => void;
  removeToast: (id: string) => void;
}

let nextId = 0;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  addToast: (message, type = 'info') => {
    const id = `toast-${++nextId}`;
    const toast: Toast = {
      id,
      message,
      type,
      createdAt: Date.now(),
    };

    set((state) => {
      // Keep max 3 visible toasts
      const toasts = [...state.toasts, toast];
      if (toasts.length > 3) {
        return { toasts: toasts.slice(-3) };
      }
      return { toasts };
    });

    // Auto-dismiss after 5 seconds
    setTimeout(() => {
      get().removeToast(id);
    }, 5000);
  },

  removeToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },
}));
