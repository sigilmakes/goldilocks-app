import ConversationSidebar from '../sidebar/ConversationSidebar';
import WorkspaceSidebar from '../sidebar/WorkspaceSidebar';

export type SidebarMode = 'conversations' | 'workspace';

interface SidebarHostProps {
  mode: SidebarMode;
  onModeChange: (mode: SidebarMode) => void;
  selectedPath: string | null;
  onOpenPath: (path: string) => void;
  onNavigate?: () => void;
}

export default function SidebarHost({
  mode,
  onModeChange,
  selectedPath,
  onOpenPath,
  onNavigate,
}: SidebarHostProps) {
  return (
    <div className="h-full flex flex-col min-h-0 bg-slate-800">
      <div className="p-3 border-b border-slate-700">
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-900/70 p-1">
          <button
            onClick={() => onModeChange('conversations')}
            className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              mode === 'conversations'
                ? 'bg-slate-700 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Conversations
          </button>
          <button
            onClick={() => onModeChange('workspace')}
            className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              mode === 'workspace'
                ? 'bg-slate-700 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Workspace
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {mode === 'conversations' ? (
          <ConversationSidebar onNavigate={onNavigate} />
        ) : (
          <WorkspaceSidebar
            selectedPath={selectedPath}
            onOpenPath={onOpenPath}
            onNavigate={onNavigate}
          />
        )}
      </div>
    </div>
  );
}
