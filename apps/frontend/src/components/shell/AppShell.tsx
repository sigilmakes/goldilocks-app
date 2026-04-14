import { useCallback, useEffect, useMemo, useState } from 'react';
import Header from '../layout/Header';
import ConnectionBanner from '../ui/ConnectionBanner';
import { useTabsStore } from '../../store/tabs';
import TabStrip from './TabStrip';
import SidebarHost, { type SidebarMode } from './SidebarHost';
import TabContentHost from './TabContentHost';

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const mq = window.matchMedia(query);
    const handler = (event: MediaQueryListEvent) => setMatches(event.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [query]);

  return matches;
}

export default function AppShell() {
  const isMobile = useMediaQuery('(max-width: 767px)');
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('conversations');

  const tabs = useTabsStore((s) => s.tabs);
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const focusTab = useTabsStore((s) => s.focusTab);
  const closeTab = useTabsStore((s) => s.closeTab);
  const openWorkspacePath = useTabsStore((s) => s.openWorkspacePath);

  useEffect(() => {
    setSidebarOpen(!isMobile);
  }, [isMobile]);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? null,
    [tabs, activeTabId]
  );

  const selectedPath = activeTab && 'path' in activeTab ? activeTab.path : null;

  const closeSidebarOverlay = useCallback(() => {
    if (isMobile && sidebarOpen) {
      setSidebarOpen(false);
    }
  }, [isMobile, sidebarOpen]);

  return (
    <div className="h-screen flex flex-col bg-slate-900">
      <ConnectionBanner />
      <Header
        onToggleSidebar={() => setSidebarOpen((open) => !open)}
        sidebarOpen={sidebarOpen}
        activeTabTitle={activeTab?.title ?? null}
      />

      <div className="flex-1 flex overflow-hidden min-h-0 relative">
        {isMobile && sidebarOpen && (
          <div
            className="absolute inset-0 bg-black/50 z-20"
            onClick={closeSidebarOverlay}
          />
        )}

        <div
          className={`border-r border-slate-700 bg-slate-800 ${
            isMobile
              ? `absolute top-0 left-0 h-full z-30 transition-transform duration-200 w-80 max-w-[85vw] ${
                  sidebarOpen ? 'translate-x-0' : '-translate-x-full'
                }`
              : `${sidebarOpen ? 'w-80' : 'w-0'} transition-all duration-200 overflow-hidden`
          }`}
        >
          <SidebarHost
            mode={sidebarMode}
            onModeChange={setSidebarMode}
            selectedPath={selectedPath}
            onOpenPath={openWorkspacePath}
            onNavigate={() => {
              if (isMobile) setSidebarOpen(false);
            }}
          />
        </div>

        <div className="flex-1 min-w-0 min-h-0 flex flex-col">
          <TabStrip
            tabs={tabs}
            activeTabId={activeTabId}
            onFocusTab={focusTab}
            onCloseTab={closeTab}
          />
          <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
            <TabContentHost tab={activeTab} />
          </div>
        </div>
      </div>
    </div>
  );
}
