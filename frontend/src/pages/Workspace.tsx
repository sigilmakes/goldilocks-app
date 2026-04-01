import { useState } from 'react';
import Header from '../components/layout/Header';
import Sidebar from '../components/layout/Sidebar';
import ChatPanel from '../components/layout/ChatPanel';
import ContextPanel from '../components/layout/ContextPanel';
import ConnectionBanner from '../components/ui/ConnectionBanner';

export default function Workspace() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [contextOpen, setContextOpen] = useState(true);

  return (
    <div className="h-screen flex flex-col bg-slate-900">
      <ConnectionBanner />
      <Header
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        onToggleContext={() => setContextOpen(!contextOpen)}
        sidebarOpen={sidebarOpen}
        contextOpen={contextOpen}
      />
      
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Sidebar */}
        <div
          className={`${
            sidebarOpen ? 'w-64' : 'w-0'
          } transition-all duration-200 overflow-hidden border-r border-slate-700 bg-slate-800`}
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
          } transition-all duration-200 overflow-hidden border-l border-slate-700 bg-slate-800`}
        >
          <ContextPanel />
        </div>
      </div>
    </div>
  );
}
