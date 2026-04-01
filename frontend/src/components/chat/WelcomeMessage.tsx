import { useState, useEffect } from 'react';
import { Sparkles } from 'lucide-react';

export default function WelcomeMessage({ onSend, isReady }: { onSend: (text: string) => void; isReady: boolean }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Trigger fade-in animation
    const timer = setTimeout(() => setVisible(true), 50);
    return () => clearTimeout(timer);
  }, []);

  const suggestions = [
    'Upload a CIF file',
    'Search for BaTiO3',
    'Explain k-point convergence',
    'Help me set up an SCF calculation',
    'What pseudopotentials should I use?',
    'Compare ALIGNN vs RF',
  ];

  const handleSuggestion = (text: string) => {
    if (isReady) {
      onSend(text);
    }
  };

  return (
    <div
      className={`h-full flex flex-col items-center justify-center text-center px-4 transition-opacity duration-500 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <div className="w-16 h-16 bg-amber-500/20 rounded-full flex items-center justify-center mb-4">
        <Sparkles className="w-8 h-8 text-amber-500" />
      </div>
      <h2 className="text-xl font-semibold text-white mb-2">
        Welcome to Goldilocks
      </h2>
      <p className="text-slate-400 max-w-md mb-6">
        I can help you generate Quantum ESPRESSO input files with ML-predicted 
        k-point grids. Upload a crystal structure to get started, or ask me anything 
        about DFT calculations.
      </p>

      {/* Quick Start card */}
      <div className="w-full max-w-md bg-slate-800 rounded-lg border border-slate-700 p-4 mb-6 text-left">
        <h3 className="text-sm font-semibold text-white mb-3">Quick Start</h3>
        <div className="space-y-2">
          {[
            { step: '1', label: 'Upload a crystal structure', detail: 'CIF, POSCAR, or XYZ' },
            { step: '2', label: 'Predict k-points', detail: 'ML-optimized grid' },
            { step: '3', label: 'Generate QE input', detail: 'Ready to run' },
          ].map((item) => (
            <div key={item.step} className="flex items-center gap-3">
              <div className="w-6 h-6 bg-amber-500/20 rounded-full flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-bold text-amber-500">{item.step}</span>
              </div>
              <div>
                <span className="text-sm text-slate-200">{item.label}</span>
                <span className="text-xs text-slate-500 ml-2">{item.detail}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Suggestions */}
      <div className="flex flex-wrap gap-2 justify-center">
        {suggestions.map((suggestion, i) => (
          <button
            key={suggestion}
            onClick={() => handleSuggestion(suggestion)}
            disabled={!isReady}
            className={`px-3 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 rounded-lg text-sm text-slate-300 transition-all duration-300 ${
              visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
            }`}
            style={{ transitionDelay: `${150 + i * 75}ms` }}
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}
