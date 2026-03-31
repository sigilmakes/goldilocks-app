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

interface ChatState {
  messages: ChatMessage[];
  isStreaming: boolean;
  currentText: string;
  currentThinking: string;
  activeTools: Map<string, ToolCall>;
  
  // Actions
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
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isStreaming: false,
  currentText: '',
  currentThinking: '',
  activeTools: new Map(),

  addUserMessage: (text, files) => {
    set((state) => ({
      messages: [
        ...state.messages,
        { role: 'user', text, files, timestamp: Date.now() },
      ],
    }));
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

  updateToolCall: (toolCallId, _content) => {
    // Could show streaming output from tools
    const state = get();
    const tool = state.activeTools.get(toolCallId);
    if (tool) {
      // For now, just keep it as-is
    }
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
    // Finalize the current assistant message
    const state = get();
    const blocks: AssistantBlock[] = [];

    // Add thinking if present
    if (state.currentThinking) {
      blocks.push({ type: 'thinking', content: state.currentThinking });
    }

    // Add text if present
    if (state.currentText) {
      blocks.push({ type: 'text', content: state.currentText });
    }

    // Add tool calls
    for (const tool of state.activeTools.values()) {
      blocks.push({ type: 'tool_call', data: tool });
    }

    if (blocks.length > 0) {
      set((state) => ({
        messages: [
          ...state.messages,
          { role: 'assistant', blocks, timestamp: Date.now() },
        ],
        currentText: '',
        currentThinking: '',
        activeTools: new Map(),
      }));
    }
  },

  endAgent: () => {
    // Ensure any remaining content is captured
    const state = get();
    if (state.currentText || state.currentThinking || state.activeTools.size > 0) {
      state.endMessage();
    }
    set({ isStreaming: false });
  },

  clearMessages: () => {
    set({
      messages: [],
      isStreaming: false,
      currentText: '',
      currentThinking: '',
      activeTools: new Map(),
    });
  },

  setStreaming: (streaming) => set({ isStreaming: streaming }),
}));
