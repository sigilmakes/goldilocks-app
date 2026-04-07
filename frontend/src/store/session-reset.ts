import { useChatStore } from './chat';
import { useChatPromptStore } from './chatPrompt';
import { useConversationsStore } from './conversations';
import { useFilesStore } from './files';
import { useSettingsStore } from './settings';
import { useTabsStore } from './tabs';

export function resetUserScopedFrontendState() {
  useChatStore.setState({
    messages: [],
    isStreaming: false,
    currentText: '',
    currentThinking: '',
    activeTools: new Map(),
    activeConversationId: null,
  });

  useChatPromptStore.setState({ pendingPrompt: null });

  useConversationsStore.setState({
    conversations: [],
    activeConversationId: null,
    isLoading: false,
    error: null,
  });

  useFilesStore.setState({
    files: [],
    revision: 0,
    isLoading: false,
    error: null,
  });

  useTabsStore.setState({ tabs: [], activeTabId: null });
  useTabsStore.persist.clearStorage();

  useSettingsStore.setState((state) => ({
    ...state,
    apiKeys: [],
    defaultModel: null,
    defaultFunctional: 'PBEsol',
    isLoading: false,
    error: null,
  }));
}
