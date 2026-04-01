import { useState, useEffect, useCallback, useRef } from 'react';
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

        {/* Context Panel with resize handle */}
        {contextOpen && (
          <ResizableContextPanel>
            <ContextPanel />
          </ResizableContextPanel>
        )}
      </div>
    </div>
  );
}

function ResizableContextPanel({ children }: { children: React.ReactNode }) {
  const [width, setWidth] = useState(320);
  const isResizing = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    startX.current = e.clientX;
    startWidth.current = width;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [width]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      // Dragging left increases width (panel is on the right)
      const delta = startX.current - e.clientX;
      const newWidth = Math.min(800, Math.max(200, startWidth.current + delta));
      setWidth(newWidth);
    };

    const onMouseUp = () => {
      if (isResizing.current) {
        isResizing.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  return (
    <div
      className="relative border-l border-slate-700 bg-slate-800 hidden sm:flex flex-col min-h-0"
      style={{ width: `${width}px`, flexShrink: 0 }}
    >
      {/* Drag handle */}
      <div
        onMouseDown={onMouseDown}
        className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize z-10 hover:bg-amber-500/30 active:bg-amber-500/50 transition-colors"
      />
      <div className="flex-1 min-h-0 overflow-hidden">
        {children}
      </div>
    </div>
  );
}
