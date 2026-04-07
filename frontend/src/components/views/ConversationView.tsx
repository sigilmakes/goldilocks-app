import { useEffect } from 'react';
import ChatPanel from '../layout/ChatPanel';
import { useConversationsStore } from '../../store/conversations';
import { useChatStore } from '../../store/chat';

export default function ConversationView({ conversationId }: { conversationId: string }) {
  const activeConversationId = useConversationsStore((s) => s.activeConversationId);
  const setActiveConversation = useConversationsStore((s) => s.setActive);
  const loadConversation = useChatStore((s) => s.loadConversation);

  useEffect(() => {
    if (activeConversationId !== conversationId) {
      loadConversation(conversationId);
      setActiveConversation(conversationId);
    }
  }, [activeConversationId, conversationId, loadConversation, setActiveConversation]);

  return <ChatPanel conversationId={conversationId} />;
}
