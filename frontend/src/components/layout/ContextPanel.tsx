import { useState } from 'react';
import { Box, Settings2, Files, Upload } from 'lucide-react';

type Tab = 'structure' | 'parameters' | 'files';

export default function ContextPanel() {
  const [activeTab, setActiveTab] = useState<Tab>('structure');

  const tabs = [
    { id: 'structure' as Tab, label: 'Structure', icon: Box },
    { id: 'parameters' as Tab, label: 'Parameters', icon: Settings2 },
    { id: 'files' as Tab, label: 'Files', icon: Files },
  ];

  return (
    <div className="h-full flex flex-col">
      {/* Tab bar */}
      <div className="flex border-b border-slate-700">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-sm transition-colors ${
              activeTab === tab.id
                ? 'text-amber-500 border-b-2 border-amber-500 bg-slate-700/50'
                : 'text-slate-400 hover:text-slate-300 hover:bg-slate-700/30'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            <span className="hidden lg:inline">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'structure' && <StructureTab />}
        {activeTab === 'parameters' && <ParametersTab />}
        {activeTab === 'files' && <FilesTab />}
      </div>
    </div>
  );
}

function StructureTab() {
  return (
    <div className="space-y-4">
      {/* 3D viewer placeholder */}
      <div className="aspect-square bg-slate-700 rounded-lg flex items-center justify-center border border-slate-600 border-dashed">
        <div className="text-center text-slate-400">
          <Box className="w-12 h-12 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No structure loaded</p>
          <p className="text-xs mt-1">Upload a CIF file to visualize</p>
        </div>
      </div>

      {/* Structure info placeholder */}
      <div className="bg-slate-700/50 rounded-lg p-3">
        <h3 className="text-sm font-medium text-white mb-2">Structure Info</h3>
        <p className="text-sm text-slate-400">No structure selected</p>
      </div>
    </div>
  );
}

function ParametersTab() {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-1.5">
          Functional
        </label>
        <select className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500">
          <option value="pbesol">PBEsol</option>
          <option value="pbe">PBE</option>
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-300 mb-1.5">
          Pseudopotential Mode
        </label>
        <select className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500">
          <option value="efficiency">Efficiency</option>
          <option value="precision">Precision</option>
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-300 mb-1.5">
          ML Model
        </label>
        <select className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500">
          <option value="alignn">ALIGNN (More accurate)</option>
          <option value="rf">Random Forest (Faster)</option>
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-300 mb-1.5">
          Confidence Level
        </label>
        <select className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500">
          <option value="0.95">95% (Conservative)</option>
          <option value="0.90">90%</option>
          <option value="0.85">85%</option>
        </select>
      </div>

      <button
        disabled
        className="w-full py-2 px-4 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-600 disabled:text-slate-400 text-white font-medium rounded-lg transition-colors"
      >
        Quick Generate
      </button>
      <p className="text-xs text-slate-500 text-center">
        Load a structure to enable quick generation
      </p>
    </div>
  );
}

function FilesTab() {
  return (
    <div className="space-y-4">
      {/* Upload dropzone */}
      <div className="border-2 border-dashed border-slate-600 rounded-lg p-6 text-center hover:border-amber-500/50 transition-colors cursor-pointer">
        <Upload className="w-8 h-8 mx-auto text-slate-400 mb-2" />
        <p className="text-sm text-slate-300">Drop files here or click to upload</p>
        <p className="text-xs text-slate-500 mt-1">CIF, POSCAR, or XYZ files</p>
      </div>

      {/* File list placeholder */}
      <div>
        <h3 className="text-sm font-medium text-slate-300 mb-2">Workspace Files</h3>
        <div className="bg-slate-700/50 rounded-lg p-3 text-center">
          <p className="text-sm text-slate-400">No files in workspace</p>
        </div>
      </div>
    </div>
  );
}
