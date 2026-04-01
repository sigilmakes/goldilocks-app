import { useState, useEffect, useCallback } from 'react';
import { Folder, Trash2, Loader2, Plus, ChevronDown } from 'lucide-react';
import { api } from '../../api/client';
import { useContextStore, type StructureInfo } from '../../store/context';

interface LibraryEntry {
  id: string;
  name: string;
  formula: string;
  filePath: string;
}

interface LibraryResponse {
  structures: LibraryEntry[];
}

export default function StructureLibrary() {
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const structure = useContextStore((s) => s.structure);
  const setStructure = useContextStore((s) => s.setStructure);

  const fetchLibrary = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get<LibraryResponse>('/library');
      setEntries(res.structures ?? []);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load library';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLibrary();
  }, [fetchLibrary]);

  const handleLoad = useCallback(
    async (entry: LibraryEntry) => {
      try {
        const res = await api.get<{ structure: StructureInfo }>(`/library/${entry.id}`);
        if (res.structure) {
          setStructure(res.structure);
        }
      } catch (err: unknown) {
        console.error('Failed to load structure:', err);
      }
    },
    [setStructure]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      if (!confirm('Remove this structure from the library?')) return;
      try {
        await api.delete(`/library/${id}`);
        setEntries((prev) => prev.filter((e) => e.id !== id));
      } catch (err: unknown) {
        console.error('Failed to delete structure:', err);
      }
    },
    []
  );

  const handleSaveCurrent = useCallback(async () => {
    if (!structure) return;
    try {
      await api.post('/library', {
        formula: structure.formula,
        name: `${structure.formula} (${structure.spacegroup})`,
        filePath: structure.filePath,
      });
      await fetchLibrary();
    } catch (err: unknown) {
      console.error('Failed to save structure:', err);
    }
  }, [structure, fetchLibrary]);

  return (
    <div>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-slate-700 rounded-lg transition-colors"
      >
        <Folder className="w-4 h-4 text-slate-400" />
        <span className="text-sm text-slate-300 flex-1">Structure Library</span>
        <ChevronDown
          className={`w-4 h-4 text-slate-400 transition-transform ${
            isOpen ? '' : '-rotate-90'
          }`}
        />
      </button>

      {isOpen && (
        <div className="mt-1 space-y-1 pl-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-3">
              <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />
            </div>
          ) : error ? (
            <p className="text-xs text-red-400 px-3 py-1">{error}</p>
          ) : entries.length === 0 ? (
            <p className="text-xs text-slate-500 px-3 py-2">No saved structures</p>
          ) : (
            entries.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center gap-2 w-full px-3 py-1.5 rounded-lg hover:bg-slate-700 transition-colors group"
              >
                <button
                  onClick={() => handleLoad(entry)}
                  className="flex items-center gap-2 flex-1 min-w-0 text-left"
                >
                  <div className="w-2 h-2 bg-amber-500 rounded-full flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-slate-300 truncate">{entry.name}</div>
                    <div className="text-xs text-slate-500">{entry.formula}</div>
                  </div>
                </button>
                <button
                  onClick={() => handleDelete(entry.id)}
                  className="p-1 opacity-0 group-hover:opacity-100 hover:bg-slate-600 rounded transition-all"
                  title="Remove from library"
                >
                  <Trash2 className="w-3.5 h-3.5 text-slate-400 hover:text-red-400" />
                </button>
              </div>
            ))
          )}

          {/* Save current */}
          {structure && (
            <button
              onClick={handleSaveCurrent}
              className="flex items-center gap-2 w-full px-3 py-1.5 rounded-lg hover:bg-slate-700 transition-colors text-amber-400 text-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              Save current ({structure.formula})
            </button>
          )}
        </div>
      )}
    </div>
  );
}
