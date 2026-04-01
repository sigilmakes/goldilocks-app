import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

// Initialize mermaid once with dark theme
let initialized = false;
function ensureInit() {
  if (initialized) return;
  initialized = true;
  mermaid.initialize({
    startOnLoad: false,
    theme: 'dark',
    themeVariables: {
      primaryColor: '#f59e0b',
      primaryTextColor: '#f8fafc',
      primaryBorderColor: '#d97706',
      lineColor: '#94a3b8',
      secondaryColor: '#1e293b',
      tertiaryColor: '#334155',
      background: '#1e293b',
      mainBkg: '#1e293b',
      nodeBorder: '#475569',
      clusterBkg: '#0f172a',
      titleColor: '#f8fafc',
      edgeLabelBackground: '#1e293b',
    },
    securityLevel: 'loose',
    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  });
}

let idCounter = 0;

export default function MermaidDiagram({ code }: { code: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const idRef = useRef(`mermaid-${++idCounter}`);

  useEffect(() => {
    if (!code.trim()) return;
    ensureInit();

    let cancelled = false;

    (async () => {
      try {
        const { svg: rendered } = await mermaid.render(idRef.current, code.trim());
        if (!cancelled) {
          setSvg(rendered);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to render diagram');
          setSvg(null);
        }
        // Clean up any leftover error element mermaid might have injected
        const errEl = document.getElementById('d' + idRef.current);
        if (errEl) errEl.remove();
      }
    })();

    return () => { cancelled = true; };
  }, [code]);

  if (error) {
    return (
      <div className="border border-red-500/30 rounded-lg p-3 my-2 bg-red-500/5">
        <div className="text-xs text-red-400 mb-1">Mermaid diagram error</div>
        <pre className="text-xs text-slate-400 overflow-x-auto">{code}</pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="border border-slate-600 rounded-lg p-4 my-2 bg-slate-800/50 text-center text-slate-400 text-sm">
        Rendering diagram...
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="my-2 overflow-x-auto rounded-lg border border-slate-600 bg-slate-800/50 p-2 [&_svg]:max-w-full [&_svg]:h-auto"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
