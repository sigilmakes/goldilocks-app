import { create } from 'zustand';
import { api } from '../api/client';

export interface Conversation {
  id: string;
  title: string;
  model: string | null;
  provider: string | null;
  createdAt: number;
  updatedAt: number;
}

interface ConversationsState {
  conversations: Conversation[];
  activeConversationId: string | null;
  isLoading: boolean;
  error: string | null;

  fetch: () => Promise<void>;
  create: (title?: string) => Promise<Conversation>;
  rename: (id: string, title: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  setActive: (id: string | null) => void;
}

interface ConversationsResponse {
  conversations: Array<{
    id: string;
    title: string;
    model: string | null;
    provider: string | null;
    created_at: number;
    updated_at: number;
  }>;
}

interface ConversationResponse {
  conversation: {
    id: string;
    title: string;
    model: string | null;
    provider: string | null;
    createdAt: number;
    updatedAt: number;
  };
}

export const useConversationsStore = create<ConversationsState>((set) => ({
  conversations: [],
  activeConversationId: null,
  isLoading: false,
  error: null,

  fetch: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.get<ConversationsResponse>('/conversations');
      set({
        conversations: res.conversations.map((c) => ({
          id: c.id,
          title: c.title,
          model: c.model,
          provider: c.provider,
          createdAt: c.created_at,
          updatedAt: c.updated_at,
        })),
        isLoading: false,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to fetch conversations';
      set({ error: message, isLoading: false });
    }
  },

  create: async (title?: string) => {
    const res = await api.post<ConversationResponse>('/conversations', { title });
    const conversation = res.conversation;
    set((state) => ({
      conversations: [conversation, ...state.conversations],
      activeConversationId: conversation.id,
    }));
    return conversation;
  },

  rename: async (id: string, title: string) => {
    await api.patch<ConversationResponse>(`/conversations/${id}`, { title });
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === id ? { ...c, title } : c
      ),
    }));
  },

  remove: async (id: string) => {
    await api.delete(`/conversations/${id}`);
    set((state) => ({
      conversations: state.conversations.filter((c) => c.id !== id),
      activeConversationId:
        state.activeConversationId === id ? null : state.activeConversationId,
    }));
  },

  setActive: (id) => {
    set({ activeConversationId: id });
  },
}));
