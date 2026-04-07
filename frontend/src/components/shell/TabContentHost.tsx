import type { AppTab } from '../../store/tabs';
import ConversationView from '../views/ConversationView';
import FileView from '../views/FileView';
import StructureView from '../views/StructureView';
import WelcomeView from '../views/WelcomeView';

export default function TabContentHost({ tab }: { tab: AppTab | null }) {
  if (!tab) {
    return <WelcomeView />;
  }

  if (tab.type === 'conversation') {
    return <ConversationView conversationId={tab.conversationId} />;
  }

  if (tab.type === 'structure') {
    return <StructureView path={tab.path} />;
  }

  return <FileView path={tab.path} />;
}
