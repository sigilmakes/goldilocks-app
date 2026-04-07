import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Paperclip, Sparkles, Square, Loader2, ArrowDown } from 'lucide-react';
import { useChatStore } from '../../store/chat';
import { useFilesStore } from '../../store/files';
import { useAgent } from '../../hooks/useAgent';
import { ChatSkeleton } from '../ui/Skeleton';
import WelcomeMessage from '../chat/WelcomeMessage';
import MessageBubble from '../chat/MessageBubble';
import { ThinkingBlock } from '../chat/MessageBubble';
import MarkdownContent from '../chat/MarkdownContent';
import ToolCallCard from '../chat/ToolCallCard';
import { useChatPromptStore } from '../../store/chatPrompt';

export default function ChatPanel({ conversationId }: { conversationId: string | null }) {
  const [message, setMessage] = useState('');
  const [stickToBottom, setStickToBottom] = useState(true);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { messages, isStreaming, currentText, currentThinking, activeTools } = useChatStore();
  const pendingPrompt = useChatPromptStore((s) => s.pendingPrompt);
  const consumePrompt = useChatPromptStore((s) => s.consumePrompt);
  const { send, abort, isReady, status, error } = useAgent(conversationId);

  const handleFileAttach = useCallback(async (files: FileList | null) => {
    if (!files) return;
    const filesStore = useFilesStore.getState();
    for (const file of Array.from(files)) {
      try {
        await filesStore.upload(file);
        send(`I've uploaded ${file.name}`);
      } catch (err) {
        console.error('Upload failed:', err);
      }
    }
  }, [send]);

  useEffect(() => {
    setStickToBottom(true);
  }, [conversationId]);

  useEffect(() => {
    if (!stickToBottom) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    container.scrollTo({
      top: container.scrollHeight,
      behavior: isStreaming ? 'auto' : 'smooth',
    });
  }, [messages, currentText, currentThinking, activeTools, isStreaming, stickToBottom]);

  useEffect(() => {
    if (!pendingPrompt || pendingPrompt.conversationId !== conversationId) return;
    if (!isReady || isStreaming) return;
    send(pendingPrompt.text);
    consumePrompt();
  }, [consumePrompt, conversationId, isReady, isStreaming, pendingPrompt, send]);

  const handleSend = () => {
    const text = message.trim();
    if (!text || !isReady || isStreaming) return;
    setStickToBottom(true);
    send(text);
    setMessage('');
  };

  const handleScrollToLatest = () => {
    const container = scrollContainerRef.current;
    if (!container) return;
    setStickToBottom(true);
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  };

  const hasMessages = messages.length > 0 || isStreaming;

  return (
    <div className="h-full flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden relative">
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto overflow-x-hidden p-4 min-h-0 min-w-0"
        onWheelCapture={(event) => {
          if (event.deltaY < 0) {
            setStickToBottom(false);
          }
        }}
        onScroll={(event) => {
          const target = event.currentTarget;
          const distanceFromBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
          setStickToBottom(distanceFromBottom < 64);
        }}
      >
        {!conversationId ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-slate-400">Select or create a conversation to start</p>
          </div>
        ) : !isReady && !hasMessages ? (
          <div className="p-4">
            {status === 'opening' ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
                <p className="text-slate-400 text-sm">Starting your agent pod...</p>
                <p className="text-slate-500 text-xs">This may take a moment on first use</p>
              </div>
            ) : (
              <ChatSkeleton />
            )}
          </div>
        ) : !hasMessages ? (
          <WelcomeMessage onSend={send} isReady={isReady} />
        ) : (
          <div className="space-y-4 max-w-3xl mx-auto pb-16">
            {messages.map((msg, i) => (
              <MessageBubble key={`${msg.timestamp}-${i}`} message={msg} />
            ))}

            {isStreaming && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                  <Sparkles className="w-4 h-4 text-amber-500" />
                </div>
                <div className="flex-1 min-w-0 space-y-2">
                  {currentThinking && <ThinkingBlock content={currentThinking} />}
                  {currentText && <MarkdownContent content={currentText} streaming />}
                  {Array.from(activeTools.values()).map((tool) => (
                    <ToolCallCard key={tool.toolCallId} tool={tool} />
                  ))}
                  {!currentText && !currentThinking && activeTools.size === 0 && (
                    <div className="flex items-center gap-2 text-slate-400">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Thinking...</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="max-w-3xl mx-auto mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}
      </div>

      {!stickToBottom && hasMessages && (
        <div className="absolute bottom-24 right-6 z-10">
          <button
            onClick={handleScrollToLatest}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-full border border-slate-600 bg-slate-800/95 hover:bg-slate-700 text-slate-200 shadow-lg transition-colors"
          >
            <ArrowDown className="w-4 h-4 text-amber-500" />
            Latest
          </button>
        </div>
      )}

      <div className="border-t border-slate-700 p-2 sm:p-4">
        <div className="max-w-3xl mx-auto flex items-end gap-1 sm:gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={!isReady || !conversationId}
            className="p-2 text-slate-400 hover:text-slate-300 hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50"
            title="Attach file"
          >
            <Paperclip className="w-5 h-5" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".cif,.poscar,.vasp,.xyz,.pdb,.json,.txt,.in,.out"
            className="hidden"
            onChange={(e) => void handleFileAttach(e.target.files)}
          />

          <div className="flex-1 relative">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={
                !conversationId
                  ? 'Create or select a conversation first...'
                  : isReady
                    ? 'Ask about DFT calculations or upload a structure...'
                    : status === 'opening'
                      ? 'Starting agent pod...'
                      : 'Connecting...'
              }
              disabled={!isReady || !conversationId}
              className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent resize-none disabled:opacity-50"
              rows={1}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
            />
          </div>

          {isStreaming ? (
            <button
              onClick={abort}
              className="p-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors"
              title="Stop"
            >
              <Square className="w-5 h-5" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              className="p-2 bg-amber-500 hover:bg-amber-600 disabled:bg-amber-500/50 text-white rounded-lg transition-colors"
              disabled={!message.trim() || !isReady}
            >
              <Send className="w-5 h-5" />
            </button>
          )}
        </div>
        <div className="mt-2 text-xs text-slate-500 text-center hidden sm:block">
          Press Enter to send, Shift+Enter for new line
        </div>
      </div>
    </div>
  );
}
