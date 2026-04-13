import { useMemo } from 'react';
import { marked } from 'marked';
import MermaidDiagram from '../ui/MermaidDiagram';

marked.setOptions({ breaks: true, gfm: true });

/** Sentinel used to neutralize mermaid fences during streaming */
const MERMAID_FENCE_RE = /```mermaid\n([\s\S]*?)```/g;
const MERMAID_STREAMING_RE = /```mermaid/g;

export default function MarkdownContent({ content, streaming = false }: { content: string; streaming?: boolean }) {
  // Extract mermaid blocks from the source, replace with placeholders
  const { text, mermaidBlocks } = useMemo(() => {
    const blocks: string[] = [];
    let text = content;

    if (streaming) {
      // During streaming, neutralize mermaid fences — they break on partial content
      // (Same approach as obsidian-pi-plugin)
      text = text.replace(MERMAID_STREAMING_RE, '```mermaid-preview');

      // Close any unclosed code fences
      const fenceCount = (text.match(/^```/gm) || []).length;
      if (fenceCount % 2 !== 0) {
        text += '\n```';
      }
    } else {
      // For completed messages, extract mermaid blocks into separate React components
      text = text.replace(MERMAID_FENCE_RE, (_match, code) => {
        const idx = blocks.length;
        blocks.push(code.trim());
        return `<div data-mermaid-idx="${idx}"></div>`;
      });
    }

    return { text, mermaidBlocks: blocks };
  }, [content, streaming]);

  const html = useMemo(() => {
    try {
      return marked.parse(text) as string;
    } catch {
      return text;
    }
  }, [text]);

  // If no mermaid blocks, use the fast path
  if (mermaidBlocks.length === 0) {
    return (
      <div
        className="chat-markdown text-slate-200"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  // Split HTML on mermaid placeholders and interleave with MermaidDiagram components
  const parts = html.split(/<div data-mermaid-idx="(\d+)"><\/div>/);
  return (
    <div className="chat-markdown text-slate-200">
      {parts.map((part, i) => {
        // Even indices are HTML, odd indices are mermaid block indices
        if (i % 2 === 0) {
          return part ? <span key={i} dangerouslySetInnerHTML={{ __html: part }} /> : null;
        }
        const idx = parseInt(part, 10);
        return <MermaidDiagram key={`mermaid-${idx}`} code={mermaidBlocks[idx]} />;
      })}
    </div>
  );
}
