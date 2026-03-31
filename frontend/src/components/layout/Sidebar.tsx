import { Plus, MessageSquare, Folder, ChevronDown } from 'lucide-react';
import { useState } from 'react';

export default function Sidebar() {
  const [libraryOpen, setLibraryOpen] = useState(true);

  // Placeholder data
  const conversations = [
    { id: '1', title: 'BaTiO3 SCF calculation', date: 'Today' },
    { id: '2', title: 'Si band structure', date: 'Yesterday' },
    { id: '3', title: 'Fe convergence test', date: 'Mar 28' },
  ];

  const structures = [
    { id: '1', name: 'BaTiO3 perovskite', formula: 'BaTiO3' },
    { id: '2', name: 'Silicon diamond', formula: 'Si' },
  ];

  return (
    <div className="h-full flex flex-col p-3">
      {/* New conversation button */}
      <button className="flex items-center gap-2 w-full px-3 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition-colors mb-4">
        <Plus className="w-4 h-4" />
        New Conversation
      </button>

      {/* Conversations list */}
      <div className="flex-1 overflow-y-auto">
        <div className="text-xs font-medium text-slate-400 uppercase tracking-wider px-3 mb-2">
          Conversations
        </div>
        <div className="space-y-1">
          {conversations.map((conv) => (
            <button
              key={conv.id}
              className="w-full flex items-start gap-2 px-3 py-2 rounded-lg hover:bg-slate-700 transition-colors text-left group"
            >
              <MessageSquare className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-white truncate">{conv.title}</div>
                <div className="text-xs text-slate-500">{conv.date}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-slate-700 my-3" />

      {/* Structure library */}
      <div>
        <button
          onClick={() => setLibraryOpen(!libraryOpen)}
          className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-slate-700 rounded-lg transition-colors"
        >
          <Folder className="w-4 h-4 text-slate-400" />
          <span className="text-sm text-slate-300 flex-1">Structure Library</span>
          <ChevronDown
            className={`w-4 h-4 text-slate-400 transition-transform ${
              libraryOpen ? '' : '-rotate-90'
            }`}
          />
        </button>
        
        {libraryOpen && (
          <div className="mt-1 space-y-1 pl-2">
            {structures.map((struct) => (
              <button
                key={struct.id}
                className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-slate-700 transition-colors text-left"
              >
                <div className="w-2 h-2 bg-amber-500 rounded-full" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-slate-300 truncate">{struct.name}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="mt-4 pt-3 border-t border-slate-700">
        <div className="text-xs text-slate-500 text-center">
          Goldilocks v0.1.0
        </div>
      </div>
    </div>
  );
}
