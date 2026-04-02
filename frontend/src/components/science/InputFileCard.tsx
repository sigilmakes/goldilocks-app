import { useState, useMemo, useCallback } from 'react';
import { Copy, Download, ChevronDown, ChevronRight, Check, FileText } from 'lucide-react';

interface InputFileCardProps {
  content: string;
  filename: string;
}

const COLLAPSED_LINES = 10;

/** Simple regex-based QE input syntax highlighter */
function highlightQE(line: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let remaining = line;
  let key = 0;

  // Process the line character by character using regex matches
  while (remaining.length > 0) {
    // Comment (! to end of line)
    const commentMatch = remaining.match(/^(!.*)$/);
    if (commentMatch) {
      parts.push(
        <span key={key++} className="text-green-400">
          {commentMatch[1]}
        </span>
      );
      remaining = '';
      continue;
    }

    // Namelist headers (&CONTROL, &SYSTEM, etc.) or section headers (ATOMIC_SPECIES, K_POINTS, etc.)
    const namelistMatch = remaining.match(/^(&[A-Z_]+)/);
    if (namelistMatch) {
      parts.push(
        <span key={key++} className="text-blue-400 font-semibold">
          {namelistMatch[1]}
        </span>
      );
      remaining = remaining.slice(namelistMatch[1].length);
      continue;
    }

    // Section headers like ATOMIC_SPECIES, ATOMIC_POSITIONS, K_POINTS, CELL_PARAMETERS
    const sectionMatch = remaining.match(/^([A-Z][A-Z_]{2,})/);
    if (sectionMatch) {
      parts.push(
        <span key={key++} className="text-blue-400 font-semibold">
          {sectionMatch[1]}
        </span>
      );
      remaining = remaining.slice(sectionMatch[1].length);
      continue;
    }

    // Numbers (integers and floats, including negative and scientific notation)
    const numberMatch = remaining.match(/^(-?\d+\.?\d*(?:[eEdD][+-]?\d+)?)/);
    if (numberMatch) {
      parts.push(
        <span key={key++} className="text-amber-400">
          {numberMatch[1]}
        </span>
      );
      remaining = remaining.slice(numberMatch[1].length);
      continue;
    }

    // Strings in quotes
    const stringMatch = remaining.match(/^('[^']*'|"[^"]*")/);
    if (stringMatch) {
      parts.push(
        <span key={key++} className="text-emerald-400">
          {stringMatch[1]}
        </span>
      );
      remaining = remaining.slice(stringMatch[1].length);
      continue;
    }

    // Slash (end of namelist)
    if (remaining[0] === '/') {
      parts.push(
        <span key={key++} className="text-blue-400">
          /
        </span>
      );
      remaining = remaining.slice(1);
      continue;
    }

    // Default: plain text (consume one character at a time for safety, but batch plain text)
    const plainMatch = remaining.match(/^([^!&A-Z0-9'"/\-]+|.)/);
    if (plainMatch) {
      parts.push(
        <span key={key++} className="text-slate-300">
          {plainMatch[0]}
        </span>
      );
      remaining = remaining.slice(plainMatch[0].length);
    }
  }

  return parts;
}

export default function InputFileCard({ content, filename }: InputFileCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const lines = useMemo(() => content.split('\n'), [content]);
  const needsCollapse = lines.length > COLLAPSED_LINES;
  const visibleLines = expanded || !needsCollapse ? lines : lines.slice(0, COLLAPSED_LINES);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const textarea = document.createElement('textarea');
      textarea.value = content;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [content]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [content, filename]);

  return (
    <div className="border border-slate-600 rounded-lg bg-slate-800 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-700/50">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-amber-500" />
          <span className="text-sm font-medium text-slate-200">{filename}</span>
          <span className="text-xs text-slate-500">{lines.length} lines</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleCopy}
            className="p-1.5 hover:bg-slate-600 rounded text-slate-400 hover:text-white transition-colors"
            title="Copy to clipboard"
          >
            {copied ? (
              <Check className="w-4 h-4 text-green-400" />
            ) : (
              <Copy className="w-4 h-4" />
            )}
          </button>
          <button
            onClick={handleDownload}
            className="p-1.5 hover:bg-slate-600 rounded text-slate-400 hover:text-white transition-colors"
            title="Download file"
          >
            <Download className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="overflow-x-auto">
        <pre className="px-3 py-2 text-xs font-mono leading-relaxed">
          {visibleLines.map((line, i) => (
            <div key={i} className="flex">
              <span className="select-none text-slate-600 w-8 text-right mr-3 flex-shrink-0">
                {i + 1}
              </span>
              <span>{highlightQE(line)}</span>
            </div>
          ))}
        </pre>
      </div>

      {/* Expand/collapse */}
      {needsCollapse && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-center gap-1 px-3 py-1.5 bg-slate-700/30 hover:bg-slate-700/60 text-xs text-slate-400 hover:text-slate-300 transition-colors"
        >
          {expanded ? (
            <>
              <ChevronDown className="w-3 h-3" />
              Collapse
            </>
          ) : (
            <>
              <ChevronRight className="w-3 h-3" />
              Show all {lines.length} lines
            </>
          )}
        </button>
      )}
    </div>
  );
}
