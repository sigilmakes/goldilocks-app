import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { isStructurePath } from '../lib/workspaceTabs';

export type AppTab =
  | {
      id: string;
      type: 'conversation';
      conversationId: string;
      title: string;
    }
  | {
      id: string;
      type: 'file';
      path: string;
      title: string;
    }
  | {
      id: string;
      type: 'structure';
      path: string;
      title: string;
    };

interface TabsState {
  tabs: AppTab[];
  activeTabId: string | null;
  openConversationTab: (conversationId: string, title?: string) => void;
  openFileTab: (path: string, title?: string) => void;
  openStructureTab: (path: string, title?: string) => void;
  openWorkspacePath: (path: string) => void;
  focusTab: (tabId: string) => void;
  closeTab: (tabId: string) => void;
  closeConversationTabs: (conversationId: string) => void;
  updateConversationTitle: (conversationId: string, title: string) => void;
  closeAllTabs: () => void;
}

function fileName(value: string): string {
  return value.split('/').pop() ?? value;
}

function focusOrAddTab(state: TabsState, tab: AppTab) {
  const existing = state.tabs.find((candidate) => candidate.id === tab.id);
  if (existing) {
    return { tabs: state.tabs, activeTabId: existing.id };
  }

  return {
    tabs: [...state.tabs, tab],
    activeTabId: tab.id,
  };
}

export const useTabsStore = create<TabsState>()(
  persist(
    (set) => ({
      tabs: [],
      activeTabId: null,

      openConversationTab: (conversationId, title = 'Conversation') =>
        set((state) =>
          focusOrAddTab(state, {
            id: `conversation:${conversationId}`,
            type: 'conversation',
            conversationId,
            title,
          })
        ),

      openFileTab: (path, title = fileName(path)) =>
        set((state) =>
          focusOrAddTab(state, {
            id: `file:${path}`,
            type: 'file',
            path,
            title,
          })
        ),

      openStructureTab: (path, title = fileName(path)) =>
        set((state) =>
          focusOrAddTab(state, {
            id: `structure:${path}`,
            type: 'structure',
            path,
            title,
          })
        ),

      openWorkspacePath: (path) =>
        set((state) => {
          const title = fileName(path);
          const tab: AppTab = isStructurePath(path)
            ? {
                id: `structure:${path}`,
                type: 'structure',
                path,
                title,
              }
            : {
                id: `file:${path}`,
                type: 'file',
                path,
                title,
              };
          return focusOrAddTab(state, tab);
        }),

      focusTab: (tabId) => set({ activeTabId: tabId }),

      closeTab: (tabId) =>
        set((state) => {
          const index = state.tabs.findIndex((tab) => tab.id === tabId);
          if (index === -1) return state;

          const tabs = state.tabs.filter((tab) => tab.id !== tabId);
          if (state.activeTabId !== tabId) {
            return { tabs };
          }

          const nextActive = tabs[index] ?? tabs[index - 1] ?? null;
          return {
            tabs,
            activeTabId: nextActive?.id ?? null,
          };
        }),

      closeConversationTabs: (conversationId) =>
        set((state) => {
          const toRemove = new Set(
            state.tabs
              .filter((tab) => tab.type === 'conversation' && tab.conversationId === conversationId)
              .map((tab) => tab.id)
          );

          if (toRemove.size === 0) return state;

          const tabs = state.tabs.filter((tab) => !toRemove.has(tab.id));
          const activeTabId = state.activeTabId && toRemove.has(state.activeTabId)
            ? tabs[tabs.length - 1]?.id ?? null
            : state.activeTabId;

          return { tabs, activeTabId };
        }),

      updateConversationTitle: (conversationId, title) =>
        set((state) => ({
          tabs: state.tabs.map((tab) =>
            tab.type === 'conversation' && tab.conversationId === conversationId
              ? { ...tab, title }
              : tab
          ),
        })),

      closeAllTabs: () => set({ tabs: [], activeTabId: null }),
    }),
    {
      name: 'goldilocks-tabs',
      partialize: (state) => ({
        tabs: state.tabs,
        activeTabId: state.activeTabId,
      }),
    }
  )
);
