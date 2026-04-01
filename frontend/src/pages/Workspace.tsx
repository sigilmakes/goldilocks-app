import { useState, useEffect, useCallback } from 'react';
import Header from '../components/layout/Header';
import Sidebar from '../components/layout/Sidebar';
import ChatPanel from '../components/layout/ChatPanel';
import ContextPanel from '../components/layout/ContextPanel';
import ConnectionBanner from '../components/ui/ConnectionBanner';

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [query]);
  return matches;
}

export default function Workspace() {
  const isMobile = useMediaQuery('(max-width: 767px)');
  const isTablet = useMediaQuery('(max-width: 1023px)');

  // Auto-collapse sidebar on mobile, context panel on tablet
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile);
  const [contextOpen, setContextOpen] = useState(!isTablet);

  // React to viewport changes
  useEffect(() => {
    if (isMobile) setSidebarOpen(false);
    else setSidebarOpen(true);
  }, [isMobile]);

  useEffect(() => {
    if (isTablet) setContextOpen(false);
    else setContextOpen(true);
  }, [isTablet]);

  // On mobile, close sidebar when selecting a conversation (click overlay)
  const closeSidebarOverlay = useCallback(() => {
    if (isMobile && sidebarOpen) setSidebarOpen(false);
  }, [isMobile, sidebarOpen]);

  return (
    <div className="h-screen flex flex-col bg-slate-900">
      <ConnectionBanner />
      <Header
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        onToggleContext={() => setContextOpen(!contextOpen)}
        sidebarOpen={sidebarOpen}
        contextOpen={contextOpen}
        isMobile={isMobile}
      />
      
      <div className="flex-1 flex overflow-hidden min-h-0 relative">
        {/* Mobile sidebar overlay backdrop */}
        {isMobile && sidebarOpen && (
          <div
            className="absolute inset-0 bg-black/50 z-20"
            onClick={closeSidebarOverlay}
          />
        )}

        {/* Sidebar */}
        <div
          className={`${
            isMobile
              ? `absolute top-0 left-0 h-full z-30 transition-transform duration-200 w-64 ${
                  sidebarOpen ? 'translate-x-0' : '-translate-x-full'
                }`
              : `${sidebarOpen ? 'w-64' : 'w-0'} transition-all duration-200 overflow-hidden`
          } border-r border-slate-700 bg-slate-800`}
        >
          <Sidebar />
        </div>

        {/* Chat Panel */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          <ChatPanel />
        </div>

        {/* Context Panel */}
        <div
          className={`${
            contextOpen ? 'w-80' : 'w-0'
          } transition-all duration-200 overflow-hidden border-l border-slate-700 bg-slate-800 hidden sm:block`}
        >
          <ContextPanel />
        </div>
      </div>
    </div>
  );
}
