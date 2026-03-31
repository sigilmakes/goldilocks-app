import { useState } from 'react';
import { Send, Paperclip, Sparkles } from 'lucide-react';

export default function ChatPanel() {
  const [message, setMessage] = useState('');

  // Placeholder - will be replaced with actual chat in Phase 2
  const hasMessages = false;

  return (
    <div className="flex-1 flex flex-col">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-4">
        {!hasMessages ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-4">
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
            <div className="flex flex-wrap gap-2 justify-center">
              {[
                'Upload a CIF file',
                'Search for BaTiO3',
                'Explain k-point convergence',
                'Help me set up an SCF calculation',
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm text-slate-300 transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Messages will be rendered here in Phase 2 */}
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="border-t border-slate-700 p-4">
        <div className="flex items-end gap-2">
          <button
            className="p-2 text-slate-400 hover:text-slate-300 hover:bg-slate-700 rounded-lg transition-colors"
            title="Attach file"
          >
            <Paperclip className="w-5 h-5" />
          </button>
          
          <div className="flex-1 relative">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Ask about DFT calculations or upload a structure..."
              className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent resize-none"
              rows={1}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  // Send message - will be implemented in Phase 2
                  console.log('Send:', message);
                  setMessage('');
                }
              }}
            />
          </div>

          <button
            className="p-2 bg-amber-500 hover:bg-amber-600 disabled:bg-amber-500/50 text-white rounded-lg transition-colors"
            disabled={!message.trim()}
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
        <div className="mt-2 text-xs text-slate-500 text-center">
          Press Enter to send, Shift+Enter for new line
        </div>
      </div>
    </div>
  );
}
