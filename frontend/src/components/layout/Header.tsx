import { PanelLeft, PanelRight, User, LogOut, Settings } from 'lucide-react';
import { useAuthStore } from '../../store/auth';
import { useState, useRef, useEffect } from 'react';

interface HeaderProps {
  onToggleSidebar: () => void;
  onToggleContext: () => void;
  sidebarOpen: boolean;
  contextOpen: boolean;
}

export default function Header({
  onToggleSidebar,
  onToggleContext,
  sidebarOpen,
  contextOpen,
}: HeaderProps) {
  const { user, logout } = useAuthStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <header className="h-14 border-b border-slate-700 bg-slate-800 flex items-center justify-between px-4">
      <div className="flex items-center gap-4">
        <button
          onClick={onToggleSidebar}
          className={`p-2 rounded-lg hover:bg-slate-700 transition-colors ${
            sidebarOpen ? 'text-amber-500' : 'text-slate-400'
          }`}
          title="Toggle sidebar"
        >
          <PanelLeft className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-amber-500 rounded-full flex items-center justify-center">
            <div className="w-5 h-5 bg-amber-400 rounded-full flex items-center justify-center">
              <div className="w-2.5 h-2.5 bg-amber-300 rounded-full" />
            </div>
          </div>
          <span className="font-semibold text-white">Goldilocks</span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {/* Model selector placeholder */}
        <select className="px-3 py-1.5 bg-slate-700 border border-slate-600 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500">
          <option value="claude-sonnet">Claude 4 Sonnet</option>
          <option value="claude-opus">Claude 4 Opus</option>
          <option value="gpt-4o">GPT-4o</option>
        </select>

        <button
          onClick={onToggleContext}
          className={`p-2 rounded-lg hover:bg-slate-700 transition-colors ${
            contextOpen ? 'text-amber-500' : 'text-slate-400'
          }`}
          title="Toggle context panel"
        >
          <PanelRight className="w-5 h-5" />
        </button>

        {/* User menu */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="flex items-center gap-2 p-2 rounded-lg hover:bg-slate-700 transition-colors"
          >
            <div className="w-8 h-8 bg-slate-600 rounded-full flex items-center justify-center">
              <User className="w-4 h-4 text-slate-300" />
            </div>
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full mt-2 w-56 bg-slate-700 rounded-lg shadow-xl border border-slate-600 py-1 z-50">
              <div className="px-4 py-2 border-b border-slate-600">
                <div className="text-sm font-medium text-white">
                  {user?.displayName || 'User'}
                </div>
                <div className="text-xs text-slate-400">{user?.email}</div>
              </div>
              <button className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-300 hover:bg-slate-600">
                <Settings className="w-4 h-4" />
                Settings
              </button>
              <button
                onClick={logout}
                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-400 hover:bg-slate-600"
              >
                <LogOut className="w-4 h-4" />
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
