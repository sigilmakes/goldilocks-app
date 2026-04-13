import { FolderTree, MessageSquareText } from 'lucide-react';

export default function WelcomeView() {
  return (
    <div className="h-full flex items-center justify-center p-6">
      <div className="max-w-2xl text-center">
        <div className="flex items-center justify-center gap-3 mb-5">
          <div className="w-12 h-12 bg-amber-500 rounded-full flex items-center justify-center">
            <div className="w-8 h-8 bg-amber-400 rounded-full flex items-center justify-center">
              <div className="w-4 h-4 bg-amber-300 rounded-full" />
            </div>
          </div>
        </div>
        <h2 className="text-2xl font-semibold text-white mb-3">Goldilocks workspace</h2>
        <p className="text-slate-400 mb-8 leading-relaxed">
          Open a conversation from the sidebar, or switch to Workspace mode to inspect structures,
          inputs, outputs, and notes as first-class tabs.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 text-left">
          <div className="rounded-xl border border-slate-700 bg-slate-800/70 p-4">
            <MessageSquareText className="w-5 h-5 text-amber-400 mb-3" />
            <h3 className="text-sm font-medium text-white mb-1">Conversations</h3>
            <p className="text-sm text-slate-400">
              Open chat sessions as tabs and keep multiple threads handy without losing your place.
            </p>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-800/70 p-4">
            <FolderTree className="w-5 h-5 text-emerald-400 mb-3" />
            <h3 className="text-sm font-medium text-white mb-1">Workspace</h3>
            <p className="text-sm text-slate-400">
              Browse structures and generated files from one place, then open what matters in the center.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
