import Editor from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import { useMemo } from 'react';
import { useSettingsStore } from '../../store/settings';
import { getMonacoLanguage } from '../../lib/fileKinds';

interface MonacoEditorProps {
  path: string;
  value: string;
  readOnly?: boolean;
  onChange?: (value: string) => void;
  onSave?: () => void;
}

function getLanguage(path: string): string {
  return getMonacoLanguage(path);
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
