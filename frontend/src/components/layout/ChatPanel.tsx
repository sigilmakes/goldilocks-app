import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Paperclip, Sparkles, Square, Loader2 } from 'lucide-react';
import { useChatStore } from '../../store/chat';
import { useConversationsStore } from '../../store/conversations';
import { useFilesStore } from '../../store/files';
import { useAgent } from '../../hooks/useAgent';
import { ChatSkeleton } from '../ui/Skeleton';
import WelcomeMessage from '../chat/WelcomeMessage';
import MessageBubble from '../chat/MessageBubble';
import { ThinkingBlock } from '../chat/MessageBubble';
import MarkdownContent from '../chat/MarkdownContent';
import ToolCallCard from '../chat/ToolCallCard';

export default function ChatPanel() {
  const [message, setMessage] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const { messages, isStreaming, currentText, currentThinking, activeTools } = useChatStore();
  const activeConversationId = useConversationsStore((s) => s.activeConversationId);
  const { send, abort, isReady, error } = useAgent(activeConversationId);

  const handleFileAttach = useCallback(async (files: FileList | null) => {
    if (!files) return;
    const filesStore = useFilesStore.getState();
    for (const file of Array.from(files)) {
      try {
        await filesStore.upload(file);
        // Mention the file in the chat so pi knows about it
        send(`I've uploaded ${file.name}`);
      } catch (err) {
        console.error('Upload failed:', err);
      }
    }
  }, [send]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, currentText, currentThinking]);

  const handleSend = () => {
    const text = message.trim();
    if (!text || !isReady || isStreaming) return;
    send(text);
    setMessage('');
  };

  const hasMessages = messages.length > 0 || isStreaming;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-4 min-h-0">
        {!activeConversationId ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-slate-400">Select or create a conversation to start</p>
          </div>
        ) : !isReady && !hasMessages ? (
          <div className="p-4">
            <ChatSkeleton />
          </div>
        ) : !hasMessages ? (
          <WelcomeMessage onSend={send} isReady={isReady} />
        ) : (
          <div className="space-y-4 max-w-3xl mx-auto">
            {messages.map((msg, i) => (
              <MessageBubble key={`${msg.timestamp}-${i}`} message={msg} />
            ))}
            
            {/* Streaming content */}
            {isStreaming && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                  <Sparkles className="w-4 h-4 text-amber-500" />
                </div>
                <div className="flex-1 min-w-0 space-y-2">
                  {currentThinking && (
                    <ThinkingBlock content={currentThinking} />
                  )}
                  {currentText && (
                    <MarkdownContent content={currentText} streaming />
                  )}
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
            
            <div ref={messagesEndRef} />
          </div>
        )}
        
        {error && (
          <div className="max-w-3xl mx-auto mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="border-t border-slate-700 p-2 sm:p-4">
        <div className="max-w-3xl mx-auto flex items-end gap-1 sm:gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={!isReady || !activeConversationId}
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
            onChange={(e) => handleFileAttach(e.target.files)}
          />
          
          <div className="flex-1 relative">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={
                !activeConversationId 
                  ? "Create or select a conversation first..." 
                  : isReady 
                    ? "Ask about DFT calculations or upload a structure..." 
                    : "Connecting..."
              }
              disabled={!isReady || !activeConversationId}
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
