import { create } from 'zustand';

export interface ToolCall {
  toolCallId: string;
  toolName: string;
  args: unknown;
  result?: unknown;
  isError?: boolean;
  status: 'running' | 'done';
}

export type AssistantBlock =
  | { type: 'text'; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'tool_call'; data: ToolCall };

export type ChatMessage =
  | { role: 'user'; text: string; files?: string[]; timestamp: number }
  | { role: 'assistant'; blocks: AssistantBlock[]; timestamp: number };

// --- localStorage persistence helpers ---

const STORAGE_KEY = 'goldilocks-chat-history';
const MAX_STORED_CONVERSATIONS = 50;

function loadHistory(): Record<string, ChatMessage[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* corrupt data, start fresh */ }
  return {};
}

/** Trim large tool results to avoid blowing localStorage quota */
function trimForStorage(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((msg) => {
    if (msg.role !== 'assistant') return msg;
    return {
      ...msg,
      blocks: msg.blocks.map((block) => {
        if (block.type !== 'tool_call') return block;
        const result = block.data.result;
        const resultStr = typeof result === 'string' ? result : JSON.stringify(result ?? '');
        // Truncate results larger than 2KB
        if (resultStr.length > 2048) {
          return {
            ...block,
            data: { ...block.data, result: resultStr.slice(0, 2048) + '\n... (truncated for storage)' },
          };
        }
        return block;
      }),
    };
  });
}

function saveHistory(history: Record<string, ChatMessage[]>) {
  try {
    // Prune oldest conversations if we exceed the limit
    const keys = Object.keys(history);
    if (keys.length > MAX_STORED_CONVERSATIONS) {
      const sorted = keys.sort((a, b) => {
        const aLast = history[a]?.[history[a].length - 1]?.timestamp ?? 0;
        const bLast = history[b]?.[history[b].length - 1]?.timestamp ?? 0;
        return aLast - bLast;
      });
      for (let i = 0; i < sorted.length - MAX_STORED_CONVERSATIONS; i++) {
        delete history[sorted[i]];
      }
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch {
    console.warn('Failed to save chat history to localStorage (quota exceeded?)');
  }
}

// ---

interface ChatState {
  messages: ChatMessage[];
  isStreaming: boolean;
  currentText: string;
  currentThinking: string;
  activeTools: Map<string, ToolCall>;

  /** The conversation ID whose messages are currently loaded */
  activeConversationId: string | null;

  // Actions
  /** Load messages for a conversation (from localStorage cache) */
  loadConversation: (conversationId: string | null) => void;
  addUserMessage: (text: string, files?: string[]) => void;
  startAssistantMessage: () => void;
  appendTextDelta: (delta: string) => void;
  appendThinkingDelta: (delta: string) => void;
  startToolCall: (toolCallId: string, toolName: string, args: unknown) => void;
  updateToolCall: (toolCallId: string, content: string) => void;
  endToolCall: (toolCallId: string, result: unknown, isError: boolean) => void;
  endMessage: () => void;
  endAgent: () => void;
  clearMessages: () => void;
  setStreaming: (streaming: boolean) => void;
  /** Delete stored history for a conversation */
  deleteConversationHistory: (conversationId: string) => void;
}

/** Persist current messages to localStorage for the active conversation */
function persistMessages(conversationId: string | null, messages: ChatMessage[]) {
  if (!conversationId) return;
  const history = loadHistory();
  if (messages.length === 0) {
    delete history[conversationId];
  } else {
    history[conversationId] = trimForStorage(messages);
  }
  saveHistory(history);
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isStreaming: false,
  currentText: '',
  currentThinking: '',
  activeTools: new Map(),
  activeConversationId: null,

  loadConversation: (conversationId) => {
    // Save current conversation's messages first
    const state = get();
    if (state.activeConversationId && state.messages.length > 0) {
      persistMessages(state.activeConversationId, state.messages);
    }

    if (!conversationId) {
      set({
        messages: [],
        isStreaming: false,
        currentText: '',
        currentThinking: '',
        activeTools: new Map(),
        activeConversationId: null,
      });
      return;
    }

    // Load from localStorage
    const history = loadHistory();
    const stored = history[conversationId] ?? [];

    set({
      messages: stored,
      isStreaming: false,
      currentText: '',
      currentThinking: '',
      activeTools: new Map(),
      activeConversationId: conversationId,
    });
  },

  addUserMessage: (text, files) => {
    set((state) => {
      const newMessages = [
        ...state.messages,
        { role: 'user' as const, text, files, timestamp: Date.now() },
      ];
      // Persist after adding
      persistMessages(state.activeConversationId, newMessages);
      return { messages: newMessages };
    });
  },

  startAssistantMessage: () => {
    set({
      isStreaming: true,
      currentText: '',
      currentThinking: '',
      activeTools: new Map(),
    });
  },

  appendTextDelta: (delta) => {
    set((state) => ({
      currentText: state.currentText + delta,
    }));
  },

  appendThinkingDelta: (delta) => {
    set((state) => ({
      currentThinking: state.currentThinking + delta,
    }));
  },

  startToolCall: (toolCallId, toolName, args) => {
    set((state) => {
      const newTools = new Map(state.activeTools);
      newTools.set(toolCallId, {
        toolCallId,
        toolName,
        args,
        status: 'running',
      });
      return { activeTools: newTools };
    });
  },

  updateToolCall: (_toolCallId, _content) => {
    // Could show streaming output from tools — no-op for now
  },

  endToolCall: (toolCallId, result, isError) => {
    set((state) => {
      const newTools = new Map(state.activeTools);
      const tool = newTools.get(toolCallId);
      if (tool) {
        newTools.set(toolCallId, {
          ...tool,
          result,
          isError,
          status: 'done',
        });
      }
      return { activeTools: newTools };
    });
  },

  endMessage: () => {
    const state = get();
    const blocks: AssistantBlock[] = [];

    if (state.currentThinking) {
      blocks.push({ type: 'thinking', content: state.currentThinking });
    }
    if (state.currentText) {
      blocks.push({ type: 'text', content: state.currentText });
    }
    for (const tool of state.activeTools.values()) {
      blocks.push({ type: 'tool_call', data: tool });
    }

    if (blocks.length > 0) {
      set((state) => {
        const newMessages = [
          ...state.messages,
          { role: 'assistant' as const, blocks, timestamp: Date.now() },
        ];
        // Persist after completing a message
        persistMessages(state.activeConversationId, newMessages);
        return {
          messages: newMessages,
          currentText: '',
          currentThinking: '',
          activeTools: new Map(),
        };
      });
    }
  },

  endAgent: () => {
    const state = get();
    if (state.currentText || state.currentThinking || state.activeTools.size > 0) {
      state.endMessage();
    }
    set({ isStreaming: false });
  },

  clearMessages: () => {
    const state = get();
    persistMessages(state.activeConversationId, []);
    set({
      messages: [],
      isStreaming: false,
      currentText: '',
      currentThinking: '',
      activeTools: new Map(),
    });
  },

  setStreaming: (streaming) => set({ isStreaming: streaming }),

  deleteConversationHistory: (conversationId) => {
    const history = loadHistory();
    delete history[conversationId];
    saveHistory(history);
  },
}));
