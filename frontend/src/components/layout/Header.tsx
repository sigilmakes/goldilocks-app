import { PanelLeft, PanelRight, User, LogOut, Settings, Sun, Moon } from 'lucide-react';
import { useAuthStore } from '../../store/auth';
import { useModelsStore } from '../../store/models';
import { useSettingsStore, type ApiKeyInfo } from '../../store/settings';
import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ModelSelectorSkeleton } from '../ui/Skeleton';

interface HeaderProps {
  onToggleSidebar: () => void;
  onToggleContext: () => void;
  sidebarOpen: boolean;
  contextOpen: boolean;
  isMobile?: boolean;
}

export default function Header({
  onToggleSidebar,
  onToggleContext,
  sidebarOpen,
  contextOpen,
  isMobile: _isMobile = false,
}: HeaderProps) {
  const { user, logout } = useAuthStore();
  const { theme, setTheme, apiKeys, fetchApiKeys } = useSettingsStore();
  const navigate = useNavigate();
  const { models, selectedModel, isLoading, fetch, setSelected } = useModelsStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Fetch models and API keys on mount
  useEffect(() => {
    fetch();
    fetchApiKeys();
  }, [fetch, fetchApiKeys]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedModelData = models.find(m => m.id === selectedModel);

  // Determine key source for selected model

  return (
    <header className="h-14 border-b border-slate-700 bg-slate-800 flex items-center justify-between px-2 sm:px-4">
      <div className="flex items-center gap-2 sm:gap-4">
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
          <span className="font-semibold text-white hidden sm:inline">Goldilocks</span>
        </div>
      </div>

      <div className="flex items-center gap-1 sm:gap-2">
        {/* Model selector */}
        {isLoading ? (
          <ModelSelectorSkeleton />
        ) : models.length === 0 ? (
          <div className="px-3 py-1.5 text-slate-500 text-sm">
            No models available
          </div>
        ) : (
          <select 
            value={selectedModel ?? ''} 
            onChange={(e) => setSelected(e.target.value)}
            className="px-2 sm:px-3 py-1.5 bg-slate-700 border border-slate-600 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500 max-w-[120px] sm:max-w-[200px]"
          >
            {models.map((model) => (
              <option key={`${model.provider}-${model.id}`} value={model.id}>
                {model.name}
              </option>
            ))}
          </select>
        )}

        {selectedModelData?.supportsThinking && (
          <span className="text-xs text-amber-500 bg-amber-500/10 px-2 py-1 rounded hidden sm:inline">
            Thinking
          </span>
        )}

        {/* API key usage indicator */}
        {selectedModelData && (
          <KeySourceBadge provider={selectedModelData.provider} apiKeys={apiKeys} />
        )}

        {/* Theme toggle */}
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="p-2 rounded-lg hover:bg-slate-700 transition-colors text-slate-400 hover:text-amber-500"
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        </button>

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
              <button
                onClick={() => { navigate('/settings'); setMenuOpen(false); }}
                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-300 hover:bg-slate-600"
              >
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

function KeySourceBadge({ provider, apiKeys }: { provider: string; apiKeys: ApiKeyInfo[] }) {
  const keyInfo = apiKeys.find((k) => k.provider === provider);

  if (!keyInfo || !keyInfo.hasKey) return null;

  if (keyInfo.isServerKey) {
    return (
      <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 hidden sm:inline">
        Server
      </span>
    );
  }

  return (
    <span className="text-xs px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 hidden sm:inline">
      Your key
    </span>
  );
}
