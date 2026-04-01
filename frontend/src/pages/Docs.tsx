import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Search,
  BookOpen,
  Terminal,
  Settings2,
  HelpCircle,
  Upload,
  Sparkles,
  FileText,
  CheckCircle,
} from 'lucide-react';

type Tab = 'getting-started' | 'cli' | 'parameters' | 'faq';

const tabs: { id: Tab; label: string; icon: typeof BookOpen }[] = [
  { id: 'getting-started', label: 'Getting Started', icon: BookOpen },
  { id: 'cli', label: 'CLI Reference', icon: Terminal },
  { id: 'parameters', label: 'Parameters', icon: Settings2 },
  { id: 'faq', label: 'FAQ', icon: HelpCircle },
];

export default function Docs() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<Tab>('getting-started');
  const [searchQuery, setSearchQuery] = useState('');

  return (
    <div className="h-screen flex flex-col bg-slate-900">
      {/* Header */}
      <header className="h-14 border-b border-slate-700 bg-slate-800 flex items-center px-4 gap-4">
        <button
          onClick={() => navigate('/')}
          className="p-2 rounded-lg hover:bg-slate-700 transition-colors text-slate-400 hover:text-white"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-semibold text-white">Documentation</h1>
      </header>

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Search bar + tabs */}
        <div className="border-b border-slate-700 bg-slate-800 px-4 pt-3 pb-0 space-y-3">
          {/* Search */}
          <div className="relative max-w-xl">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search documentation..."
              className="w-full pl-10 pr-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          {/* Tabs */}
          <div className="flex overflow-x-auto -mb-px">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm whitespace-nowrap transition-colors border-b-2 ${
                  activeTab === tab.id
                    ? 'border-amber-500 text-amber-500'
                    : 'border-transparent text-slate-400 hover:text-white'
                }`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-3xl mx-auto">
            {activeTab === 'getting-started' && <GettingStartedTab filter={searchQuery} />}
            {activeTab === 'cli' && <CliTab filter={searchQuery} />}
            {activeTab === 'parameters' && <ParametersTab filter={searchQuery} />}
            {activeTab === 'faq' && <FaqTab filter={searchQuery} />}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Utility: returns true if any of the text content matches the filter */
function matchesFilter(filter: string, ...texts: string[]): boolean {
  if (!filter.trim()) return true;
  const q = filter.toLowerCase();
  return texts.some((t) => t.toLowerCase().includes(q));
}

function Heading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xl font-semibold text-white mb-4">{children}</h2>;
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-base font-semibold text-white mt-6 mb-2">{children}</h3>;
}

function Prose({ children }: { children: React.ReactNode }) {
  return <div className="text-sm text-slate-300 leading-relaxed space-y-3">{children}</div>;
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="bg-slate-800 border border-slate-700 rounded-lg p-4 text-sm text-slate-300 overflow-x-auto font-mono">
      {children}
    </pre>
  );
}

/* ─── Getting Started ─── */

function GettingStartedTab({ filter }: { filter: string }) {
  const steps = [
    {
      icon: Upload,
      title: '1. Upload a Crystal Structure',
      desc: 'Upload a CIF, POSCAR, or XYZ file using the file panel on the right, or simply paste it into the chat. Goldilocks will parse the structure automatically.',
    },
    {
      icon: Sparkles,
      title: '2. Predict K-Points',
      desc: 'Ask Goldilocks to predict the optimal k-point grid. It uses ML models (ALIGNN or Random Forest) trained on thousands of DFT convergence tests to find the "just right" k-point density.',
    },
    {
      icon: FileText,
      title: '3. Generate Input Files',
      desc: 'Goldilocks generates a complete Quantum ESPRESSO input file with the predicted k-points, recommended pseudopotentials, and sensible defaults for all other parameters.',
    },
    {
      icon: CheckCircle,
      title: '4. Review & Download',
      desc: 'Review the generated input in the chat, make any adjustments, and download the files from the workspace panel. You\'re ready to run your DFT calculation!',
    },
  ];

  const filtered = steps.filter((s) => matchesFilter(filter, s.title, s.desc));
  if (filtered.length === 0 && filter) {
    return <EmptySearch />;
  }

  return (
    <div>
      <Heading>Getting Started</Heading>
      <Prose>
        <p>
          Goldilocks is an AI-powered assistant for generating Quantum ESPRESSO input files
          with ML-predicted k-point grids. Follow these steps to get started:
        </p>
      </Prose>

      <div className="mt-6 space-y-4">
        {filtered.map((step) => (
          <div
            key={step.title}
            className="flex gap-4 p-4 bg-slate-800 rounded-lg border border-slate-700"
          >
            <div className="w-10 h-10 bg-amber-500/20 rounded-lg flex items-center justify-center flex-shrink-0">
              <step.icon className="w-5 h-5 text-amber-500" />
            </div>
            <div>
              <div className="text-sm font-semibold text-white mb-1">{step.title}</div>
              <p className="text-sm text-slate-400">{step.desc}</p>
            </div>
          </div>
        ))}
      </div>

      <SubHeading>Tips</SubHeading>
      <Prose>
        <ul className="list-disc list-inside space-y-1 text-slate-400">
          <li>You can drag and drop files directly into the chat window</li>
          <li>Use the Parameters panel on the right to adjust settings before generating</li>
          <li>Goldilocks automatically detects metallic vs insulating systems</li>
          <li>Ask follow-up questions to tweak or regenerate files</li>
        </ul>
      </Prose>
    </div>
  );
}

/* ─── CLI Reference ─── */

const CLI_COMMANDS = [
  {
    command: 'goldilocks predict <file>',
    description: 'Predict k-point grid for a crystal structure',
    example: 'goldilocks predict BaTiO3.cif --model alignn --functional pbesol',
  },
  {
    command: 'goldilocks generate <file>',
    description: 'Generate full QE input from structure file',
    example: 'goldilocks generate Si.cif --output si_scf.in',
  },
  {
    command: 'goldilocks search <formula>',
    description: 'Search Materials Project for a structure',
    example: 'goldilocks search BaTiO3 --limit 5',
  },
  {
    command: 'goldilocks convert <file>',
    description: 'Convert between structure file formats',
    example: 'goldilocks convert POSCAR --to cif --output structure.cif',
  },
  {
    command: 'goldilocks validate <file>',
    description: 'Validate a QE input file for common errors',
    example: 'goldilocks validate scf.in --fix',
  },
  {
    command: 'goldilocks compare <file1> <file2>',
    description: 'Compare two structures or input files',
    example: 'goldilocks compare BaTiO3_cubic.cif BaTiO3_tetra.cif',
  },
];

function CliTab({ filter }: { filter: string }) {
  const filtered = CLI_COMMANDS.filter((cmd) =>
    matchesFilter(filter, cmd.command, cmd.description, cmd.example)
  );

  if (filtered.length === 0 && filter) return <EmptySearch />;

  return (
    <div>
      <Heading>CLI Reference</Heading>
      <Prose>
        <p>
          Goldilocks provides CLI commands that the AI assistant can execute. You can also
          reference these when asking questions about capabilities.
        </p>
      </Prose>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700">
              <th className="text-left py-3 px-4 text-slate-400 font-medium">Command</th>
              <th className="text-left py-3 px-4 text-slate-400 font-medium">Description</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((cmd) => (
              <tr key={cmd.command} className="border-b border-slate-700/50">
                <td className="py-3 px-4">
                  <code className="text-amber-500 bg-slate-800 px-2 py-0.5 rounded text-xs font-mono">
                    {cmd.command}
                  </code>
                </td>
                <td className="py-3 px-4 text-slate-300">{cmd.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <SubHeading>Examples</SubHeading>
      <div className="space-y-3">
        {filtered.map((cmd) => (
          <div key={cmd.command}>
            <p className="text-xs text-slate-500 mb-1">{cmd.description}</p>
            <CodeBlock>{cmd.example}</CodeBlock>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Parameters ─── */

const PARAMETERS = [
  {
    name: 'Functional',
    key: 'functional',
    description:
      'The exchange-correlation functional used in the DFT calculation. PBEsol is optimized for solids and is the recommended default. PBE is more general-purpose and widely used in the literature.',
    options: ['PBEsol (recommended for solids)', 'PBE (general-purpose)'],
  },
  {
    name: 'Pseudopotential Mode',
    key: 'pseudo_mode',
    description:
      'Controls the pseudopotential precision. "Efficiency" uses fewer electrons and lower cutoffs for faster calculations. "Precision" includes more electrons for higher accuracy.',
    options: ['Efficiency (faster)', 'Precision (more accurate)'],
  },
  {
    name: 'ML Model',
    key: 'ml_model',
    description:
      'The machine learning model used for k-point prediction. ALIGNN is a graph neural network that considers atomic connectivity and is generally more accurate. Random Forest is faster and works well for simple structures.',
    options: ['ALIGNN (more accurate, slower)', 'Random Forest (faster, simpler)'],
  },
  {
    name: 'Confidence Level',
    key: 'confidence',
    description:
      'The confidence level for the k-point prediction interval. Higher confidence means denser k-point grids (more conservative). 95% is recommended for production calculations.',
    options: ['95% (conservative, recommended)', '90% (balanced)', '85% (aggressive)'],
  },
];

function ParametersTab({ filter }: { filter: string }) {
  const filtered = PARAMETERS.filter((p) =>
    matchesFilter(filter, p.name, p.description, ...p.options)
  );

  if (filtered.length === 0 && filter) return <EmptySearch />;

  return (
    <div>
      <Heading>Parameters</Heading>
      <Prose>
        <p>
          Goldilocks uses several parameters to control k-point prediction and input file
          generation. These can be set in the Parameters panel or specified in your prompt.
        </p>
      </Prose>

      <div className="mt-6 space-y-6">
        {filtered.map((param) => (
          <div
            key={param.key}
            className="bg-slate-800 rounded-lg border border-slate-700 p-4"
          >
            <h3 className="text-sm font-semibold text-white mb-2">{param.name}</h3>
            <p className="text-sm text-slate-400 mb-3">{param.description}</p>
            <div className="space-y-1">
              <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                Options
              </div>
              {param.options.map((opt) => (
                <div
                  key={opt}
                  className="text-sm text-slate-300 pl-3 border-l-2 border-slate-600 py-0.5"
                >
                  {opt}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── FAQ ─── */

const FAQ_ITEMS = [
  {
    question: 'How does Goldilocks predict k-point grids?',
    answer:
      'Goldilocks uses machine learning models trained on thousands of DFT convergence tests from the Materials Project. The models learn the relationship between crystal structure features (symmetry, lattice parameters, atomic species) and the k-point density needed for converged total energy.',
  },
  {
    question: 'What does "just right" mean for k-points?',
    answer:
      'The name "Goldilocks" reflects the goal: not too many (wasteful) and not too few (inaccurate). The ML models predict the minimum k-point grid that achieves convergence within 1 meV/atom, based on the specified confidence level.',
  },
  {
    question: 'How does metal detection work?',
    answer:
      'Goldilocks uses a separate classifier to predict whether a material is metallic or insulating. Metals require denser k-point grids and Methfessel-Paxton smearing, while insulators use Gaussian smearing with wider spacing. This is determined automatically from the structure.',
  },
  {
    question: 'Can I use my own pseudopotentials?',
    answer:
      'Yes! By default, Goldilocks selects pseudopotentials from the SSSP library (efficiency or precision). You can specify custom pseudopotentials by editing the generated input file or telling the assistant which ones to use.',
  },
  {
    question: 'What file formats are supported?',
    answer:
      'Goldilocks supports CIF, POSCAR/VASP, XYZ, and PDB files for structure input. It can generate Quantum ESPRESSO .in files and can also convert between formats.',
  },
  {
    question: 'Is ALIGNN or Random Forest more accurate?',
    answer:
      'ALIGNN generally provides more accurate predictions, especially for complex structures with many atoms or unusual chemistry. Random Forest is faster and works well for common, simple structures (binary compounds, standard perovskites, etc.).',
  },
  {
    question: 'What if the prediction seems wrong?',
    answer:
      'You can always ask the assistant to adjust the k-point grid. Mention that you want a denser or sparser grid, or specify exact k-point numbers. The prediction is a starting point, and convergence testing is always recommended for publication-quality results.',
  },
];

function FaqTab({ filter }: { filter: string }) {
  const filtered = FAQ_ITEMS.filter((item) =>
    matchesFilter(filter, item.question, item.answer)
  );

  if (filtered.length === 0 && filter) return <EmptySearch />;

  return (
    <div>
      <Heading>Frequently Asked Questions</Heading>

      <div className="mt-4 space-y-3">
        {filtered.map((item) => (
          <FaqItem key={item.question} question={item.question} answer={item.answer} />
        ))}
      </div>
    </div>
  );
}

function FaqItem({ question, answer }: { question: string; answer: string }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-700/50 transition-colors"
      >
        <span className="text-sm font-medium text-white pr-4">{question}</span>
        <span
          className={`text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        >
          ▾
        </span>
      </button>
      {isOpen && (
        <div className="px-4 pb-4">
          <p className="text-sm text-slate-400 leading-relaxed">{answer}</p>
        </div>
      )}
    </div>
  );
}

function EmptySearch() {
  return (
    <div className="text-center py-12">
      <Search className="w-10 h-10 text-slate-600 mx-auto mb-3" />
      <p className="text-sm text-slate-400">No results found for this search.</p>
      <p className="text-xs text-slate-500 mt-1">Try different keywords or clear the search.</p>
    </div>
  );
}
