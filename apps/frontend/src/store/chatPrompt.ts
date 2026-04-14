import { create } from 'zustand';

interface PendingPrompt {
  conversationId: string;
  text: string;
}

interface ChatPromptState {
  pendingPrompt: PendingPrompt | null;
  queuePrompt: (conversationId: string, text: string) => void;
  consumePrompt: () => void;
}

export const useChatPromptStore = create<ChatPromptState>((set) => ({
  pendingPrompt: null,
  queuePrompt: (conversationId, text) => set({ pendingPrompt: { conversationId, text } }),
  consumePrompt: () => set({ pendingPrompt: null }),
}));
