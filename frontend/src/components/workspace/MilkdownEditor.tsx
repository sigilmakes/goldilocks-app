import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react';
import { Editor, rootCtx, defaultValueCtx } from '@milkdown/kit/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { history } from '@milkdown/kit/plugin/history';
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';
import { ProsemirrorAdapterProvider } from '@prosemirror-adapter/react';

interface MilkdownEditorInnerProps {
  initialValue: string;
  editorKey: string;
  onChange?: (content: string) => void;
}

function MilkdownEditorInner({ initialValue, editorKey, onChange }: MilkdownEditorInnerProps) {
  useEditor((root) => {
    const editor = Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root);
        ctx.set(defaultValueCtx, initialValue);
        if (onChange) {
          ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
            onChange(markdown);
          });
        }
      })
      .use(commonmark)
      .use(gfm)
      .use(history)
      .use(listener);

    return editor;
  }, [editorKey]);

  return <Milkdown />;
}

export default function MilkdownEditor({ initialValue, editorKey, onChange }: MilkdownEditorInnerProps) {
  return (
    <div className="milkdown-editor h-full min-h-0 overflow-hidden">
      <MilkdownProvider>
        <ProsemirrorAdapterProvider>
          <MilkdownEditorInner initialValue={initialValue} editorKey={editorKey} onChange={onChange} />
        </ProsemirrorAdapterProvider>
      </MilkdownProvider>
    </div>
  );
}
