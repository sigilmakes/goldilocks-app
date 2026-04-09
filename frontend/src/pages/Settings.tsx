import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  User,
  Key,
  SlidersHorizontal,
  Palette,
  Info,
  FileCode2,
  Eye,
  EyeOff,
  Trash2,
  X,
  Check,
  ExternalLink,
  Sun,
  Moon,
  Loader2,
} from 'lucide-react';
import { useAuthStore } from '../store/auth';
import { useSettingsStore, type ApiKeyInfo } from '../store/settings';
import { useModelsStore } from '../store/models';
import { useToastStore } from '../store/toast';
import { formatExtensionList, parseExtensionList } from '../lib/fileAssociations';

type Section = 'profile' | 'apikeys' | 'preferences' | 'workspace' | 'appearance' | 'about';

const sections: { id: Section; label: string; icon: typeof User }[] = [
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'apikeys', label: 'API Keys', icon: Key },
  { id: 'preferences', label: 'Preferences', icon: SlidersHorizontal },
  { id: 'workspace', label: 'Workspace', icon: FileCode2 },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'about', label: 'About', icon: Info },
];

const PROVIDERS = [
  { id: 'anthropic', name: 'Anthropic', description: 'Claude models' },
  { id: 'openai', name: 'OpenAI', description: 'GPT models' },
  { id: 'google', name: 'Google', description: 'Gemini models' },
];

export default function Settings() {
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState<Section>('profile');

  return (
    <div className="h-screen flex flex-col bg-slate-900 dark:bg-slate-900">
      {/* Header */}
      <header className="h-14 border-b border-slate-700 bg-slate-800 flex items-center px-4 gap-4">
        <button
          onClick={() => navigate('/')}
          className="p-2 rounded-lg hover:bg-slate-700 transition-colors text-slate-400 hover:text-white"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-semibold text-white">Settings</h1>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Section nav */}
        <nav className="w-56 border-r border-slate-700 bg-slate-800 p-3 hidden md:block">
          <div className="space-y-1">
            {sections.map((section) => (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  activeSection === section.id
                    ? 'bg-slate-700 text-amber-500'
                    : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
                }`}
              >
                <section.icon className="w-4 h-4" />
                {section.label}
              </button>
            ))}
          </div>
        </nav>

        {/* Mobile nav */}
        <div className="md:hidden border-b border-slate-700 bg-slate-800 flex overflow-x-auto px-2">
          {sections.map((section) => (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-xs whitespace-nowrap transition-colors border-b-2 ${
                activeSection === section.id
                  ? 'border-amber-500 text-amber-500'
                  : 'border-transparent text-slate-400'
              }`}
            >
              <section.icon className="w-3.5 h-3.5" />
              {section.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-2xl mx-auto space-y-6">
            {activeSection === 'profile' && <ProfileSection />}
            {activeSection === 'apikeys' && <ApiKeysSection />}
            {activeSection === 'preferences' && <PreferencesSection />}
            {activeSection === 'workspace' && <WorkspaceSection />}
            {activeSection === 'appearance' && <AppearanceSection />}
            {activeSection === 'about' && <AboutSection />}
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-slate-800 rounded-lg border border-slate-700">
      <div className="px-6 py-4 border-b border-slate-700">
        <h2 className="text-base font-semibold text-white">{title}</h2>
      </div>
      <div className="px-6 py-4">{children}</div>
    </div>
  );
}

function ProfileSection() {
  const user = useAuthStore((s) => s.user);

  return (
    <SectionCard title="Profile">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-400 mb-1">Display Name</label>
          <div className="px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm">
            {user?.displayName || 'Not set'}
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-400 mb-1">Email</label>
          <div className="px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm">
            {user?.email || 'Not set'}
          </div>
        </div>
        <p className="text-xs text-slate-500">
          Profile information is read-only. Contact an administrator to make changes.
        </p>
      </div>
    </SectionCard>
  );
}

function ApiKeysSection() {
  const { apiKeys, fetchApiKeys, addApiKey, removeApiKey, isLoading } = useSettingsStore();
  const addToast = useToastStore((s) => s.addToast);
  const [modalProvider, setModalProvider] = useState<string | null>(null);

  useEffect(() => {
    fetchApiKeys();
  }, [fetchApiKeys]);

  const getKeyInfo = (providerId: string): ApiKeyInfo | undefined => {
    return apiKeys.find((k) => k.provider === providerId);
  };

  const handleRemoveKey = async (provider: string) => {
    if (!confirm(`Remove your API key for ${provider}?`)) return;
    try {
      await removeApiKey(provider);
      addToast('API key removed', 'success');
    } catch {
      addToast('Failed to remove API key', 'error');
    }
  };

  return (
    <>
      <SectionCard title="API Keys">
        <div className="space-y-3">
          <p className="text-sm text-slate-400 mb-4">
            Configure API keys for LLM providers. Your keys are encrypted and stored securely.
          </p>
          {PROVIDERS.map((provider) => {
            const keyInfo = getKeyInfo(provider.id);
            return (
              <div
                key={provider.id}
                className="flex items-center justify-between p-3 bg-slate-700/50 rounded-lg"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-slate-600 rounded-lg flex items-center justify-center">
                    <Key className="w-5 h-5 text-slate-300" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-white">{provider.name}</div>
                    <div className="text-xs text-slate-400">{provider.description}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <KeyStatusBadge keyInfo={keyInfo} />
                  <button
                    onClick={() => setModalProvider(provider.id)}
                    className="px-3 py-1.5 text-xs bg-slate-600 hover:bg-slate-500 text-white rounded-lg transition-colors"
                  >
                    {keyInfo?.hasKey ? 'Replace' : 'Add Key'}
                  </button>
                  {keyInfo?.hasKey && (
                    <button
                      onClick={() => handleRemoveKey(provider.id)}
                      className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-600 rounded-lg transition-colors"
                      title="Remove key"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </SectionCard>

      {modalProvider && (
        <ApiKeyModal
          provider={modalProvider}
          providerName={PROVIDERS.find((p) => p.id === modalProvider)?.name ?? modalProvider}
          onClose={() => setModalProvider(null)}
          onSubmit={async (key) => {
            try {
              await addApiKey(modalProvider, key);
              addToast('API key added successfully', 'success');
              setModalProvider(null);
            } catch {
              addToast('Failed to add API key', 'error');
            }
          }}
          isLoading={isLoading}
        />
      )}
    </>
  );
}

function KeyStatusBadge({ keyInfo }: { keyInfo?: ApiKeyInfo }) {
  if (!keyInfo || !keyInfo.hasKey) {
    return (
      <span className="px-2 py-0.5 text-xs rounded-full bg-slate-600 text-slate-400">
        Not configured
      </span>
    );
  }

  return (
    <span className="px-2 py-0.5 text-xs rounded-full bg-green-500/20 text-green-400">
      Your key
    </span>
  );
}

function ApiKeyModal({
  provider: _provider,
  providerName,
  onClose,
  onSubmit,
  isLoading,
}: {
  provider: string;
  providerName: string;
  onClose: () => void;
  onSubmit: (key: string) => Promise<void>;
  isLoading: boolean;
}) {
  const [key, setKey] = useState('');
  const [showKey, setShowKey] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim()) return;
    await onSubmit(key.trim());
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-lg border border-slate-700 w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
          <h3 className="text-base font-semibold text-white">
            Add {providerName} API Key
          </h3>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white rounded transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1.5">
              API Key
            </label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={`Enter your ${providerName} API key...`}
                className="w-full px-3 py-2 pr-10 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-white transition-colors"
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <p className="text-xs text-slate-500">
            Your API key is encrypted and stored securely on the server.
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!key.trim() || isLoading}
              className="px-4 py-2 text-sm bg-amber-500 hover:bg-amber-600 disabled:bg-slate-600 disabled:text-slate-400 text-white rounded-lg transition-colors flex items-center gap-2"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  Save Key
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PreferencesSection() {
  const { defaultModel, defaultFunctional, updateSettings } = useSettingsStore();
  const { models, fetch: fetchModels, setSelected } = useModelsStore();
  const addToast = useToastStore((s) => s.addToast);

  useEffect(() => {
    if (models.length === 0) fetchModels();
  }, [models.length, fetchModels]);

  const handleModelChange = async (value: string) => {
    try {
      await updateSettings({ defaultModel: value });
      if (value) {
        await setSelected(value);
      }
      addToast('Default model updated', 'success');
    } catch {
      addToast('Failed to update preferences', 'error');
    }
  };

  const handleFunctionalChange = async (value: string) => {
    try {
      await updateSettings({ defaultFunctional: value });
      addToast('Default functional updated', 'success');
    } catch {
      addToast('Failed to update preferences', 'error');
    }
  };

  return (
    <SectionCard title="Preferences">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-400 mb-1.5">
            Default Model
          </label>
          <select
            value={defaultModel ?? ''}
            onChange={(e) => handleModelChange(e.target.value)}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
          >
            <option value="">Auto (use first available)</option>
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-400 mb-1.5">
            Default DFT Functional
          </label>
          <select
            value={defaultFunctional}
            onChange={(e) => handleFunctionalChange(e.target.value)}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
          >
            <option value="PBEsol">PBEsol</option>
            <option value="PBE">PBE</option>
          </select>
          <p className="text-xs text-slate-500 mt-1">
            PBEsol is recommended for solids. PBE is more general-purpose.
          </p>
        </div>
      </div>
    </SectionCard>
  );
}

function WorkspaceSection() {
  const { workspaceViewer, updateWorkspaceViewer } = useSettingsStore();
  const [monacoExtensionsInput, setMonacoExtensionsInput] = useState(() => formatExtensionList(workspaceViewer.monacoExtensions));
  const [imageExtensionsInput, setImageExtensionsInput] = useState(() => formatExtensionList(workspaceViewer.imageViewerExtensions));
  const addToast = useToastStore((s) => s.addToast);

  useEffect(() => {
    setMonacoExtensionsInput(formatExtensionList(workspaceViewer.monacoExtensions));
    setImageExtensionsInput(formatExtensionList(workspaceViewer.imageViewerExtensions));
  }, [workspaceViewer.imageViewerExtensions, workspaceViewer.monacoExtensions]);

  const applyExtensionSettings = () => {
    updateWorkspaceViewer({
      monacoExtensions: parseExtensionList(monacoExtensionsInput),
      imageViewerExtensions: parseExtensionList(imageExtensionsInput),
    });
    addToast('Workspace viewer file types updated', 'success');
  };

  return (
    <div className="space-y-6">
      <SectionCard title="File associations">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1.5">
              Monaco file types
            </label>
            <input
              type="text"
              value={monacoExtensionsInput}
              onChange={(e) => setMonacoExtensionsInput(e.target.value)}
              placeholder="ts, tsx, js, py, json, txt, in, out"
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
            <p className="text-xs text-slate-500 mt-1">
              Comma-separated extensions. If an extension appears in both lists, the image viewer wins.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1.5">
              Image viewer file types
            </label>
            <input
              type="text"
              value={imageExtensionsInput}
              onChange={(e) => setImageExtensionsInput(e.target.value)}
              placeholder="png, jpg, jpeg, webp, svg"
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <div className="flex justify-end">
            <button
              onClick={applyExtensionSettings}
              className="px-4 py-2 text-sm bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition-colors"
            >
              Apply file types
            </button>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Monaco editor">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1.5">
              Font size
            </label>
            <input
              type="range"
              min={10}
              max={24}
              value={workspaceViewer.monacoFontSize}
              onChange={(e) => updateWorkspaceViewer({ monacoFontSize: Number(e.target.value) })}
              className="w-full"
            />
            <div className="text-xs text-slate-500 mt-1">{workspaceViewer.monacoFontSize}px</div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1.5">
              Tab size
            </label>
            <select
              value={workspaceViewer.monacoTabSize}
              onChange={(e) => updateWorkspaceViewer({ monacoTabSize: Number(e.target.value) as 2 | 4 | 8 })}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
              <option value={2}>2 spaces</option>
              <option value={4}>4 spaces</option>
              <option value={8}>8 spaces</option>
            </select>
          </div>

          <div className="space-y-3">
            <SettingsCheckbox
              label="Word wrap"
              description="Wrap long lines to fit the editor width."
              checked={workspaceViewer.monacoWordWrap}
              onChange={(checked) => updateWorkspaceViewer({ monacoWordWrap: checked })}
            />
            <SettingsCheckbox
              label="Line numbers"
              description="Show line numbers in the gutter."
              checked={workspaceViewer.monacoLineNumbers}
              onChange={(checked) => updateWorkspaceViewer({ monacoLineNumbers: checked })}
            />
            <SettingsCheckbox
              label="Minimap"
              description="Show the Monaco minimap on the right side."
              checked={workspaceViewer.monacoMinimap}
              onChange={(checked) => updateWorkspaceViewer({ monacoMinimap: checked })}
            />
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Image and PDF viewers">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1.5">
              Transparent image background
            </label>
            <select
              value={workspaceViewer.imageBackground}
              onChange={(e) => updateWorkspaceViewer({ imageBackground: e.target.value as 'checkered' | 'dark' | 'light' })}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
              <option value="checkered">Checkered</option>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1.5">
              Default image fit
            </label>
            <select
              value={workspaceViewer.imageFitMode}
              onChange={(e) => updateWorkspaceViewer({ imageFitMode: e.target.value as 'contain' | 'actual' })}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
              <option value="contain">Fit to view</option>
              <option value="actual">Actual size</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1.5">
              Default PDF zoom
            </label>
            <select
              value={workspaceViewer.pdfDefaultZoom}
              onChange={(e) => updateWorkspaceViewer({ pdfDefaultZoom: Number(e.target.value) as 50 | 75 | 100 | 125 | 150 | 200 })}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
              <option value={50}>50%</option>
              <option value={75}>75%</option>
              <option value={100}>100%</option>
              <option value={125}>125%</option>
              <option value={150}>150%</option>
              <option value={200}>200%</option>
            </select>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}

function SettingsCheckbox({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-start justify-between gap-4 cursor-pointer">
      <div>
        <div className="text-sm font-medium text-white">{label}</div>
        <div className="text-xs text-slate-500 mt-1">{description}</div>
      </div>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 rounded border-slate-600 bg-slate-700 text-amber-500 focus:ring-amber-500"
      />
    </label>
  );
}

function AppearanceSection() {
  const { theme, setTheme } = useSettingsStore();

  return (
    <SectionCard title="Appearance">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-400 mb-3">
            Theme
          </label>
          <div className="flex gap-3">
            <button
              onClick={() => setTheme('dark')}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg border transition-colors ${
                theme === 'dark'
                  ? 'border-amber-500 bg-amber-500/10 text-amber-500'
                  : 'border-slate-600 bg-slate-700/50 text-slate-400 hover:border-slate-500'
              }`}
            >
              <Moon className="w-5 h-5" />
              <span className="text-sm font-medium">Dark</span>
            </button>
            <button
              onClick={() => setTheme('light')}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg border transition-colors ${
                theme === 'light'
                  ? 'border-amber-500 bg-amber-500/10 text-amber-500'
                  : 'border-slate-600 bg-slate-700/50 text-slate-400 hover:border-slate-500'
              }`}
            >
              <Sun className="w-5 h-5" />
              <span className="text-sm font-medium">Light</span>
            </button>
          </div>
        </div>
      </div>
    </SectionCard>
  );
}

function AboutSection() {
  return (
    <SectionCard title="About Goldilocks">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-amber-500 rounded-full flex items-center justify-center">
            <div className="w-8 h-8 bg-amber-400 rounded-full flex items-center justify-center">
              <div className="w-4 h-4 bg-amber-300 rounded-full" />
            </div>
          </div>
          <div>
            <div className="text-base font-semibold text-white">Goldilocks</div>
            <div className="text-sm text-slate-400">v0.1.0</div>
          </div>
        </div>
        <p className="text-sm text-slate-400">
          AI-powered assistant for Quantum ESPRESSO input generation with ML-predicted
          k-point grids. Getting your DFT parameters just right.
        </p>
        <div className="space-y-2">
          <a
            href="https://github.com/goldilocks-app"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm text-amber-500 hover:text-amber-400 transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
            GitHub Repository
          </a>
          <a
            href="/docs"
            className="flex items-center gap-2 text-sm text-amber-500 hover:text-amber-400 transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
            Documentation
          </a>
        </div>
        <div className="pt-2 border-t border-slate-700">
          <p className="text-xs text-slate-500">
            Built with React, Zustand, and Tailwind CSS. Powered by Claude, GPT, and Gemini.
          </p>
        </div>
      </div>
    </SectionCard>
  );
}
