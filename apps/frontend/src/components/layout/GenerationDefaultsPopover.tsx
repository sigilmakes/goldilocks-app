import { useEffect, useRef, useState } from 'react';
import { Settings2 } from 'lucide-react';
import { useContextStore } from '../../store/context';
import { useSettingsStore } from '../../store/settings';
import { useToastStore } from '../../store/toast';

export default function GenerationDefaultsPopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const defaults = useContextStore((s) => s.generationDefaults);
  const updateGenerationDefaults = useContextStore((s) => s.updateGenerationDefaults);
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const defaultFunctional = useSettingsStore((s) => s.defaultFunctional);
  const addToast = useToastStore((s) => s.addToast);

  useEffect(() => {
    if (defaultFunctional && defaultFunctional !== defaults.functional) {
      updateGenerationDefaults({ functional: defaultFunctional });
    }
  }, [defaultFunctional, defaults.functional, updateGenerationDefaults]);

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  const handleFunctionalChange = async (value: 'PBEsol' | 'PBE') => {
    updateGenerationDefaults({ functional: value });
    try {
      await updateSettings({ defaultFunctional: value });
    } catch {
      addToast('Failed to persist default functional', 'warning');
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((value) => !value)}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm transition-colors ${
          open
            ? 'bg-slate-700 border-slate-500 text-white'
            : 'bg-slate-800 border-slate-600 text-slate-300 hover:bg-slate-700'
        }`}
        title="Generation defaults"
      >
        <Settings2 className="w-4 h-4" />
        <span className="hidden md:inline">Defaults</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-[min(92vw,22rem)] rounded-xl border border-slate-600 bg-slate-800 shadow-2xl z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-700">
            <div className="text-sm font-medium text-white">Generation defaults</div>
            <div className="text-xs text-slate-400 mt-1">
              Used by structure actions and generation flows.
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4">
            <label className="block">
              <span className="block text-xs font-medium text-slate-400 mb-1.5">Functional</span>
              <select
                value={defaults.functional}
                onChange={(e) => void handleFunctionalChange(e.target.value as 'PBEsol' | 'PBE')}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              >
                <option value="PBEsol">PBEsol</option>
                <option value="PBE">PBE</option>
              </select>
            </label>

            <label className="block">
              <span className="block text-xs font-medium text-slate-400 mb-1.5">Pseudopotential</span>
              <select
                value={defaults.pseudoMode}
                onChange={(e) => updateGenerationDefaults({ pseudoMode: e.target.value as 'efficiency' | 'precision' })}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              >
                <option value="efficiency">Efficiency</option>
                <option value="precision">Precision</option>
              </select>
            </label>

            <label className="block">
              <span className="block text-xs font-medium text-slate-400 mb-1.5">Prediction model</span>
              <select
                value={defaults.model}
                onChange={(e) => updateGenerationDefaults({ model: e.target.value as 'ALIGNN' | 'RF' })}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              >
                <option value="ALIGNN">ALIGNN</option>
                <option value="RF">Random Forest</option>
              </select>
            </label>

            <label className="block">
              <span className="block text-xs font-medium text-slate-400 mb-1.5">Confidence</span>
              <select
                value={defaults.confidence}
                onChange={(e) => updateGenerationDefaults({ confidence: Number(e.target.value) as 0.85 | 0.9 | 0.95 })}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              >
                <option value={0.95}>95%</option>
                <option value={0.9}>90%</option>
                <option value={0.85}>85%</option>
              </select>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
