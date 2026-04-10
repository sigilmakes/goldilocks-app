import { create } from 'zustand';

export interface ToolCall {
  toolCallId: string;
  toolName: string;
  args: unknown;
  result?: unknown;
  isError?: boolean;
  status: 'running' | 'done';
  /** Accumulated streaming content from toolcall_delta events. */
  streamContent?: string;
}

export type AssistantBlock =
  | { type: 'text'; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'tool_call'; data: ToolCall };

export type ChatMessage =
  | { role: 'user'; text: string; files?: string[]; timestamp: number }
  | { role: 'assistant'; blocks: AssistantBlock[]; timestamp: number };

function patchPersistedTool(
  messages: ChatMessage[],
  toolCallId: string,
  updater: (tool: ToolCall) => ToolCall,
): ChatMessage[] {
  let changed = false;
  const nextMessages = messages.map((message) => {
    if (message.role !== 'assistant') return message;

    let blockChanged = false;
    const nextBlocks = message.blocks.map((block) => {
      if (block.type !== 'tool_call' || block.data.toolCallId !== toolCallId) {
        return block;
      }
      blockChanged = true;
      changed = true;
      return { type: 'tool_call' as const, data: updater(block.data) };
    });

    return blockChanged ? { ...message, blocks: nextBlocks } : message;
  });

  return changed ? nextMessages : messages;
}

interface ChatState {
  messages: ChatMessage[];
  isStreaming: boolean;
  currentText: string;
  currentThinking: string;
  activeTools: Map<string, ToolCall>;

  /** The conversation ID whose messages are currently loaded */
  activeConversationId: string | null;

  // Actions
  loadConversation: (conversationId: string | null) => void;
  setMessages: (messages: ChatMessage[]) => void;
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
  activeConversationId: null,

  loadConversation: (conversationId) => {
    set({
      messages: [],
      isStreaming: false,
      currentText: '',
      currentThinking: '',
      activeTools: new Map(),
      activeConversationId: conversationId,
    });
  },

  setMessages: (messages) => {
    set({ messages });
  },

  addUserMessage: (text, files) => {
    set((state) => ({
      messages: [
        ...state.messages,
        { role: 'user' as const, text, files, timestamp: Date.now() },
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
      const existing = newTools.get(toolCallId);
      if (existing) {
        newTools.set(toolCallId, {
          ...existing,
          toolCallId,
          toolName,
          args,
          status: 'running',
        });
        return { activeTools: newTools };
      }

      const patchedMessages = patchPersistedTool(state.messages, toolCallId, (tool) => ({
        ...tool,
        toolName,
        args,
        status: 'running',
      }));

      if (patchedMessages !== state.messages) {
        return { messages: patchedMessages };
      }

      newTools.set(toolCallId, {
        toolCallId,
        toolName,
        args,
        status: 'running',
      });
      return { activeTools: newTools };
    });
  },

  updateToolCall: (toolCallId, content) => {
    set((state) => {
      const newTools = new Map(state.activeTools);
      const tool = newTools.get(toolCallId);
      if (tool) {
        newTools.set(toolCallId, {
          ...tool,
          streamContent: (tool.streamContent ?? '') + content,
        });
        return { activeTools: newTools };
      }

      const patchedMessages = patchPersistedTool(state.messages, toolCallId, (persistedTool) => ({
        ...persistedTool,
        streamContent: (persistedTool.streamContent ?? '') + content,
      }));

      return patchedMessages !== state.messages ? { messages: patchedMessages } : { activeTools: newTools };
    });
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
        return { activeTools: newTools };
      }

      const patchedMessages = patchPersistedTool(state.messages, toolCallId, (persistedTool) => ({
        ...persistedTool,
        result,
        isError,
        status: 'done',
      }));

      return patchedMessages !== state.messages ? { messages: patchedMessages } : { activeTools: newTools };
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
      set((state) => ({
        messages: [
          ...state.messages,
          { role: 'assistant' as const, blocks, timestamp: Date.now() },
        ],
        currentText: '',
        currentThinking: '',
        activeTools: new Map(),
      }));
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
