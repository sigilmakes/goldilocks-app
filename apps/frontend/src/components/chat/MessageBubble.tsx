import { useState } from 'react';
import { Sparkles, ChevronDown, ChevronRight } from 'lucide-react';
import type { ChatMessage, AssistantBlock } from '../../store/chat';
import MarkdownContent from './MarkdownContent';
import ToolCallCard from './ToolCallCard';
import { useSettingsStore } from '../../store/settings';

export default function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === 'user') {
    return (
      <div className="flex gap-3 justify-end">
        <div className="max-w-[80%] bg-amber-500/20 rounded-lg px-4 py-2">
          <p className="text-slate-200 whitespace-pre-wrap">{message.text}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center flex-shrink-0">
        <Sparkles className="w-4 h-4 text-amber-500" />
      </div>
      <div className="flex-1 min-w-0 space-y-2">
        {message.blocks.map((block, i) => (
          <AssistantBlockRenderer key={i} block={block} />
        ))}
      </div>
    </div>
  );
}

function AssistantBlockRenderer({ block }: { block: AssistantBlock }) {
  if (block.type === 'text') {
    return <MarkdownContent content={block.content} />;
  }

  if (block.type === 'thinking') {
    return <ThinkingBlock content={block.content} />;
  }

  if (block.type === 'tool_call') {
    return <ToolCallCard tool={block.data} />;
  }

  return null;
}

export function ThinkingBlock({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);
  const theme = useSettingsStore((s) => s.theme);
  const headerClass = theme === 'light'
    ? 'bg-slate-900/50 hover:bg-slate-900/60 text-slate-300'
    : 'bg-slate-700/50 hover:bg-slate-700 text-slate-400';
  const bodyClass = theme === 'light'
    ? 'bg-slate-800/50 text-slate-300'
    : 'bg-slate-800/50 text-slate-400';

  return (
    <div className="border border-slate-600 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className={`w-full flex items-center gap-2 px-3 py-2 transition-colors text-left ${headerClass}`}
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4" />
        ) : (
          <ChevronRight className="w-4 h-4" />
        )}
        <span className="text-sm">Thinking</span>
      </button>
      {expanded && (
        <div className={`px-3 py-2 text-sm whitespace-pre-wrap ${bodyClass}`}>
          {content}
        </div>
      )}
    </div>
  );
}
