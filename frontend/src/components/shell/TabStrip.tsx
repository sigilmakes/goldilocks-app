import { FileCode2, FileText, MessageSquare, X } from 'lucide-react';
import type { AppTab } from '../../store/tabs';

interface TabStripProps {
  tabs: AppTab[];
  activeTabId: string | null;
  onFocusTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
}

function TabIcon({ tab }: { tab: AppTab }) {
  if (tab.type === 'conversation') {
    return <MessageSquare className="w-4 h-4 text-amber-400" />;
  }
  if (tab.type === 'structure') {
    return <FileCode2 className="w-4 h-4 text-emerald-400" />;
  }
  return <FileText className="w-4 h-4 text-slate-400" />;
}

export default function TabStrip({ tabs, activeTabId, onFocusTab, onCloseTab }: TabStripProps) {
  if (tabs.length === 0) {
    return (
      <div className="h-11 border-b border-slate-700 bg-slate-850/60 px-4 flex items-center text-sm text-slate-500">
        No tabs open
      </div>
    );
  }

  return (
    <div className="h-11 border-b border-slate-700 bg-slate-850/60 overflow-x-auto">
      <div className="flex items-stretch min-w-max px-2 py-1 gap-1">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              className={`group flex items-center gap-2 rounded-lg border px-3 min-w-0 max-w-xs transition-colors ${
                isActive
                  ? 'bg-slate-800 border-slate-600 text-white'
                  : 'bg-slate-900/40 border-transparent text-slate-300 hover:bg-slate-800/70'
              }`}
            >
              <button
                onClick={() => onFocusTab(tab.id)}
                className="flex items-center gap-2 min-w-0 py-2 text-sm"
              >
                <TabIcon tab={tab} />
                <span className="truncate">{tab.title}</span>
              </button>
              <button
                onClick={() => onCloseTab(tab.id)}
                className="p-1 rounded text-slate-500 hover:text-slate-200 hover:bg-slate-700/70 opacity-70 group-hover:opacity-100"
                title="Close tab"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
