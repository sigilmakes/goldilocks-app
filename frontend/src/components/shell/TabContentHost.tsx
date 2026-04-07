import type { AppTab } from '../../store/tabs';
import ConversationView from '../views/ConversationView';
import FileView from '../views/FileView';
import StructureView from '../views/StructureView';
import WelcomeView from '../views/WelcomeView';

export default function TabContentHost({ tab }: { tab: AppTab | null }) {
  return (
    <div className="h-full min-h-0 min-w-0 flex flex-col overflow-hidden">
      {!tab ? (
        <WelcomeView />
      ) : tab.type === 'conversation' ? (
        <ConversationView conversationId={tab.conversationId} />
      ) : tab.type === 'structure' ? (
        <StructureView path={tab.path} />
      ) : (
        <FileView path={tab.path} />
      )}
    </div>
  );
}
