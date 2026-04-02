import { Plus, MessageSquare, Trash2 } from 'lucide-react';
import { useEffect } from 'react';
import { useConversationsStore, type Conversation } from '../../store/conversations';
import { useChatStore } from '../../store/chat';
import { useFilesStore } from '../../store/files';
import { useToastStore } from '../../store/toast';
import { ConversationListSkeleton } from '../ui/Skeleton';

export default function Sidebar() {
  const {
    conversations,
    activeConversationId,
    isLoading,
    fetch,
    create,
    remove,
    setActive,
  } = useConversationsStore();
  
  const loadConversation = useChatStore((s) => s.loadConversation);
  const deleteConversationHistory = useChatStore((s) => s.deleteConversationHistory);
  const clearFiles = useFilesStore((s) => s.clear);

  // Fetch conversations on mount
  useEffect(() => {
    fetch();
  }, [fetch]);

  const addToast = useToastStore((s) => s.addToast);

  const handleNewConversation = async () => {
    try {
      const conv = await create();
      loadConversation(conv.id);
      clearFiles();
      addToast('Conversation created', 'success');
    } catch (err) {
      console.error('Failed to create conversation:', err);
      addToast('Failed to create conversation', 'error');
    }
  };

  const handleSelectConversation = (id: string) => {
    if (id !== activeConversationId) {
      loadConversation(id);
      clearFiles();
      setActive(id);
    }
  };

  const handleDeleteConversation = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm('Delete this conversation?')) {
      try {
        await remove(id);
        deleteConversationHistory(id);
        addToast('Conversation deleted', 'success');
      } catch (err) {
        console.error('Failed to delete conversation:', err);
        addToast('Failed to delete conversation', 'error');
      }
    }
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="h-full flex flex-col p-3">
      {/* New conversation button */}
      <button
        onClick={handleNewConversation}
        className="flex items-center gap-2 w-full px-3 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition-colors mb-4"
      >
        <Plus className="w-4 h-4" />
        New Conversation
      </button>

      {/* Conversations list */}
      <div className="flex-1 overflow-y-auto">
        <div className="text-xs font-medium text-slate-400 uppercase tracking-wider px-3 mb-2">
          Conversations
        </div>
        
        {isLoading ? (
          <ConversationListSkeleton count={5} />
        ) : conversations.length === 0 ? (
          <div className="px-3 py-4 text-sm text-slate-500 text-center">
            No conversations yet
          </div>
        ) : (
          <div className="space-y-1">
            {conversations.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                isActive={conv.id === activeConversationId}
                onSelect={() => handleSelectConversation(conv.id)}
                onDelete={(e) => handleDeleteConversation(e, conv.id)}
                formatDate={formatDate}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="mt-4 pt-3 border-t border-slate-700">
        <div className="text-xs text-slate-500 text-center">
          Goldilocks v0.1.0
        </div>
      </div>
    </div>
  );
}

function ConversationItem({
  conversation,
  isActive,
  onSelect,
  onDelete,
  formatDate,
}: {
  conversation: Conversation;
  isActive: boolean;
  onSelect: () => void;
  onDelete: (e: React.MouseEvent) => void;
  formatDate: (timestamp: number) => string;
}) {
  return (
    <button
      onClick={onSelect}
      className={`w-full flex items-start gap-2 px-3 py-2 rounded-lg transition-colors text-left group ${
        isActive ? 'bg-slate-700' : 'hover:bg-slate-700/50'
      }`}
    >
      <MessageSquare className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm text-white truncate">{conversation.title}</div>
        <div className="text-xs text-slate-500">{formatDate(conversation.updatedAt)}</div>
      </div>
      <button
        onClick={onDelete}
        className="p-1 opacity-0 group-hover:opacity-100 hover:bg-slate-600 rounded transition-all"
        title="Delete conversation"
      >
        <Trash2 className="w-3.5 h-3.5 text-slate-400 hover:text-red-400" />
      </button>
    </button>
  );
}
