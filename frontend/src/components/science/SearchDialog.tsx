import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X, Loader2, Database, AlertCircle } from 'lucide-react';
import { api } from '../../api/client';
import { useContextStore, type StructureInfo } from '../../store/context';

interface SearchDialogProps {
  open: boolean;
  onClose: () => void;
}

interface SearchResult {
  id: string;
  formula: string;
  spacegroup: string;
  spacegroupNumber?: number;
  natoms: number;
  source: string;
}

interface SearchResponse {
  results: SearchResult[];
}

type DatabaseSource = 'jarvis' | 'mp' | 'mc3d' | 'oqmd';

const databases: { id: DatabaseSource; label: string }[] = [
  { id: 'jarvis', label: 'JARVIS' },
  { id: 'mp', label: 'Materials Project' },
  { id: 'mc3d', label: 'MC3D' },
  { id: 'oqmd', label: 'OQMD' },
];

const limitOptions = [5, 10, 20];

export default function SearchDialog({ open, onClose }: SearchDialogProps) {
  const [formula, setFormula] = useState('');
  const [database, setDatabase] = useState<DatabaseSource>('jarvis');
  const [limit, setLimit] = useState(10);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const setStructure = useContextStore((s) => s.setStructure);

  // Focus input when dialog opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  // Close on click outside
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  // Close on escape
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  const handleSearch = async () => {
    if (!formula.trim()) return;
    setIsLoading(true);
    setError(null);
    setHasSearched(true);

    try {
      const res = await api.post<SearchResponse>('/structures/search', {
        formula: formula.trim(),
        database,
        limit,
      });
      setResults(res.results ?? []);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Search failed';
      setError(message);
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUse = async (result: SearchResult) => {
    // Create a minimal StructureInfo from search result and load it
    const info: StructureInfo = {
      formula: result.formula,
      spacegroup: result.spacegroup,
      spacegroupNumber: result.spacegroupNumber ?? 0,
      latticeSystem: '',
      a: 0,
      b: 0,
      c: 0,
      alpha: 0,
      beta: 0,
      gamma: 0,
      volume: 0,
      natoms: result.natoms,
      species: [],
      density: 0,
      filePath: `${result.source}:${result.id}`,
    };
    setStructure(info);
    onClose();
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div
        ref={dialogRef}
        className="w-full max-w-2xl bg-slate-800 border border-slate-600 rounded-xl shadow-2xl max-h-[80vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5 text-amber-500" />
            <h2 className="text-lg font-semibold text-white">Search Structure Database</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search controls */}
        <div className="px-5 py-4 space-y-3 border-b border-slate-700">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={formula}
              onChange={(e) => setFormula(e.target.value)}
              placeholder="Enter formula (e.g. BaTiO3, Si, GaAs)"
              className="flex-1 px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSearch();
              }}
            />
            <button
              onClick={handleSearch}
              disabled={isLoading || !formula.trim()}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-600 disabled:text-slate-400 text-white font-medium rounded-lg transition-colors flex items-center gap-2"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
              Search
            </button>
          </div>

          <div className="flex gap-3">
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-400">Database:</label>
              <select
                value={database}
                onChange={(e) => setDatabase(e.target.value as DatabaseSource)}
                className="px-2 py-1 bg-slate-700 border border-slate-600 rounded text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
              >
                {databases.map((db) => (
                  <option key={db.id} value={db.id}>
                    {db.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-400">Limit:</label>
              <select
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
                className="px-2 py-1 bg-slate-700 border border-slate-600 rounded text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
              >
                {limitOptions.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm mb-3">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="w-8 h-8 text-amber-500 animate-spin mb-3" />
              <p className="text-sm text-slate-400">Searching {databases.find((d) => d.id === database)?.label}...</p>
            </div>
          ) : results.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="text-left py-2 px-2 text-slate-400 font-medium">ID</th>
                  <th className="text-left py-2 px-2 text-slate-400 font-medium">Formula</th>
                  <th className="text-left py-2 px-2 text-slate-400 font-medium">Space Group</th>
                  <th className="text-right py-2 px-2 text-slate-400 font-medium">Atoms</th>
                  <th className="py-2 px-2" />
                </tr>
              </thead>
              <tbody>
                {results.map((result) => (
                  <tr
                    key={result.id}
                    className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors"
                  >
                    <td className="py-2 px-2 text-slate-300 font-mono text-xs">{result.id}</td>
                    <td className="py-2 px-2 text-white font-medium">{result.formula}</td>
                    <td className="py-2 px-2 text-slate-300">{result.spacegroup}</td>
                    <td className="py-2 px-2 text-slate-300 text-right">{result.natoms}</td>
                    <td className="py-2 px-2 text-right">
                      <button
                        onClick={() => handleUse(result)}
                        className="px-3 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 rounded text-xs font-medium transition-colors"
                      >
                        Use
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : hasSearched && !error ? (
            <div className="text-center py-12">
              <Search className="w-8 h-8 text-slate-600 mx-auto mb-2" />
              <p className="text-sm text-slate-400">No results found</p>
              <p className="text-xs text-slate-500 mt-1">Try a different formula or database</p>
            </div>
          ) : (
            <div className="text-center py-12">
              <Database className="w-8 h-8 text-slate-600 mx-auto mb-2" />
              <p className="text-sm text-slate-400">Enter a formula to search</p>
              <p className="text-xs text-slate-500 mt-1">
                Search across JARVIS, Materials Project, MC3D, and OQMD
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
