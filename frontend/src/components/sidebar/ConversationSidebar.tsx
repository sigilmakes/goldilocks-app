import { Plus, MessageSquare, Trash2, AlertTriangle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useConversationsStore, type Conversation } from '../../store/conversations';
import { useChatStore } from '../../store/chat';
import { useFilesStore } from '../../store/files';
import { useToastStore } from '../../store/toast';
import { useTabsStore } from '../../store/tabs';
import { ConversationListSkeleton } from '../ui/Skeleton';

interface DeleteDialogState {
  conversationId: string;
  title: string;
}

export default function ConversationSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const {
    conversations,
    activeConversationId,
    isLoading,
    fetch,
    create,
    remove,
    setActive,
  } = useConversationsStore();

  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState | null>(null);
  const [skipDeleteConfirm, setSkipDeleteConfirm] = useState(false);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[]>([]);

  const loadConversation = useChatStore((s) => s.loadConversation);
  const clearFiles = useFilesStore((s) => s.clear);
  const openConversationTab = useTabsStore((s) => s.openConversationTab);
  const closeConversationTabs = useTabsStore((s) => s.closeConversationTabs);
  const updateConversationTitle = useTabsStore((s) => s.updateConversationTitle);
  const addToast = useToastStore((s) => s.addToast);

  useEffect(() => {
    void fetch();
  }, [fetch]);

  useEffect(() => {
    for (const conversation of conversations) {
      updateConversationTitle(conversation.id, conversation.title);
    }
  }, [conversations, updateConversationTitle]);

  const visibleConversations = useMemo(
    () => conversations.filter((conversation) => !pendingDeleteIds.includes(conversation.id)),
    [conversations, pendingDeleteIds]
  );

  const handleNewConversation = async () => {
    try {
      const conversation = await create();
      loadConversation(conversation.id);
      clearFiles();
      setActive(conversation.id);
      openConversationTab(conversation.id, conversation.title);
      addToast('Conversation created', 'success');
      onNavigate?.();
    } catch (err) {
      console.error('Failed to create conversation:', err);
      addToast('Failed to create conversation', 'error');
    }
  };

  const handleSelectConversation = (conversation: Conversation) => {
    if (pendingDeleteIds.includes(conversation.id)) return;

    if (conversation.id !== activeConversationId) {
      loadConversation(conversation.id);
      clearFiles();
      setActive(conversation.id);
    }
    openConversationTab(conversation.id, conversation.title);
    onNavigate?.();
  };

  const requestDeleteConversation = (conversation: Conversation) => {
    if (skipDeleteConfirm) {
      void confirmDeleteConversation(conversation.id);
      return;
    }

    setDeleteDialog({ conversationId: conversation.id, title: conversation.title });
  };

  const confirmDeleteConversation = async (id: string) => {
    const wasActive = activeConversationId === id;
    setDeleteDialog(null);
    setPendingDeleteIds((current) => [...current, id]);

    if (wasActive) {
      loadConversation(null);
      clearFiles();
      setActive(null);
    }
    closeConversationTabs(id);

    try {
      await remove(id);
      addToast('Conversation deleted', 'success');
    } catch (err) {
      console.error('Failed to delete conversation:', err);
      setPendingDeleteIds((current) => current.filter((value) => value !== id));
      addToast('Failed to delete conversation', 'error');
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
    <>
      <div className="h-full flex flex-col p-3 min-h-0">
        <button
          onClick={handleNewConversation}
          className="flex items-center gap-2 w-full px-3 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition-colors mb-4"
        >
          <Plus className="w-4 h-4" />
          New Conversation
        </button>

        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="text-xs font-medium text-slate-400 uppercase tracking-wider px-3 mb-2">
            Conversations
          </div>

          {isLoading ? (
            <ConversationListSkeleton count={5} />
          ) : visibleConversations.length === 0 ? (
            <div className="px-3 py-4 text-sm text-slate-500 text-center">
              No conversations yet
            </div>
          ) : (
            <div className="space-y-1">
              {visibleConversations.map((conversation) => (
                <ConversationItem
                  key={conversation.id}
                  conversation={conversation}
                  isActive={conversation.id === activeConversationId}
                  onSelect={() => handleSelectConversation(conversation)}
                  onDelete={() => requestDeleteConversation(conversation)}
                  formatDate={formatDate}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {deleteDialog && (
        <DeleteConversationDialog
          title={deleteDialog.title}
          skipDeleteConfirm={skipDeleteConfirm}
          onSkipDeleteConfirmChange={setSkipDeleteConfirm}
          onCancel={() => setDeleteDialog(null)}
          onConfirm={() => void confirmDeleteConversation(deleteDialog.conversationId)}
        />
      )}
    </>
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
  onDelete: () => void;
  formatDate: (timestamp: number) => string;
}) {
  return (
    <div
      className={`w-full flex items-start gap-2 px-3 py-2 rounded-lg transition-colors group ${
        isActive ? 'bg-slate-700' : 'hover:bg-slate-700/50'
      }`}
    >
      <button
        onClick={onSelect}
        className="flex items-start gap-2 flex-1 min-w-0 text-left"
      >
        <MessageSquare className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm text-white truncate">{conversation.title}</div>
          <div className="text-xs text-slate-500">{formatDate(conversation.updatedAt)}</div>
        </div>
      </button>

      <button
        onClick={onDelete}
        className="p-1 opacity-0 group-hover:opacity-100 hover:bg-slate-600 rounded transition-all flex-shrink-0"
        title="Delete conversation"
      >
        <Trash2 className="w-3.5 h-3.5 text-slate-400 hover:text-red-400" />
      </button>
    </div>
  );
}

function DeleteConversationDialog({
  title,
  skipDeleteConfirm,
  onSkipDeleteConfirmChange,
  onCancel,
  onConfirm,
}: {
  title: string;
  skipDeleteConfirm: boolean;
  onSkipDeleteConfirmChange: (value: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [dontAskAgain, setDontAskAgain] = useState(skipDeleteConfirm);

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-600 bg-slate-800 shadow-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-700 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-400" />
          <h2 className="text-sm font-semibold text-white">Delete conversation?</h2>
        </div>

        <div className="px-4 py-4 space-y-4">
          <p className="text-sm text-slate-300 leading-relaxed">
            Delete <span className="font-medium text-white">{title}</span>? This removes the conversation and its session history.
          </p>

          <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={dontAskAgain}
              onChange={(e) => setDontAskAgain(e.target.checked)}
              className="rounded border-slate-600 bg-slate-700 text-amber-500 focus:ring-amber-500"
            />
            Always delete without asking again this session
          </label>
        </div>

        <div className="px-4 py-3 border-t border-slate-700 flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-2 rounded-lg border border-slate-600 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onSkipDeleteConfirmChange(dontAskAgain);
              onConfirm();
            }}
            className="px-3 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
