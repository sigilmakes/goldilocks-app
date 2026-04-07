import Editor from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import { useMemo } from 'react';
import { useSettingsStore } from '../../store/settings';

interface MonacoEditorProps {
  path: string;
  value: string;
  readOnly?: boolean;
  onChange?: (value: string) => void;
  onSave?: () => void;
}

function getLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript',
    js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
    json: 'json', jsonc: 'json',
    css: 'css', scss: 'scss', less: 'less',
    html: 'html', htm: 'html', xml: 'xml', svg: 'xml',
    py: 'python',
    rs: 'rust', go: 'go',
    java: 'java', kt: 'kotlin', kts: 'kotlin',
    c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cc: 'cpp',
    cs: 'csharp', rb: 'ruby', php: 'php',
    sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell',
    yaml: 'yaml', yml: 'yaml',
    toml: 'ini', ini: 'ini', cfg: 'ini',
    sql: 'sql', lua: 'lua', swift: 'swift', r: 'r',
    graphql: 'graphql', gql: 'graphql',
    md: 'markdown',
  };
  return map[ext] ?? 'plaintext';
}

export default function MonacoEditor({ path, value, readOnly = false, onChange, onSave }: MonacoEditorProps) {
  const theme = useSettingsStore((s) => s.theme);
  const workspaceViewer = useSettingsStore((s) => s.workspaceViewer);

  const options = useMemo<Monaco.editor.IStandaloneEditorConstructionOptions>(() => ({
    readOnly,
    fontSize: workspaceViewer.monacoFontSize,
    tabSize: workspaceViewer.monacoTabSize,
    lineNumbers: workspaceViewer.monacoLineNumbers ? 'on' : 'off',
    minimap: { enabled: workspaceViewer.monacoMinimap },
    wordWrap: workspaceViewer.monacoWordWrap ? 'on' : 'off',
    insertSpaces: true,
    automaticLayout: true,
    scrollBeyondLastLine: false,
    renderWhitespace: 'selection',
    cursorBlinking: 'smooth',
    smoothScrolling: true,
    padding: { top: 12 },
    bracketPairColorization: { enabled: true },
    guides: { bracketPairs: true, indentation: true },
  }), [readOnly, workspaceViewer]);

  return (
    <div className="h-full min-h-0 min-w-0">
      <Editor
        height="100%"
        path={path}
        language={getLanguage(path)}
        theme={theme === 'dark' ? 'vs-dark' : 'vs'}
        value={value}
        options={options}
        onChange={(nextValue) => onChange?.(nextValue ?? '')}
        onMount={(editor, monaco) => {
          editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
            onSave?.();
          });
        }}
      />
    </div>
  );
}
