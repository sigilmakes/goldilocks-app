import { Loader2, WifiOff, RefreshCw } from 'lucide-react';
import { useConnectionStatus } from '../../hooks/useConnectionStatus';

/**
 * Shows a banner at the top of the workspace when the server connection is lost.
 * - Amber "Reconnecting..." with spinner when actively retrying
 * - Red "Connection lost. Click to retry." when given up
 * - Auto-dismisses when reconnected
 */
export default function ConnectionBanner() {
  const { isConnected, isReconnecting, reconnect } = useConnectionStatus();

  if (isConnected) return null;

  if (isReconnecting) {
    return (
      <div className="bg-amber-500/20 border-b border-amber-500/30 px-4 py-2 flex items-center justify-center gap-2 text-sm text-amber-300">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span>Reconnecting to server...</span>
      </div>
    );
  }

  return (
    <button
      onClick={reconnect}
      className="w-full bg-red-500/20 border-b border-red-500/30 px-4 py-2 flex items-center justify-center gap-2 text-sm text-red-300 hover:bg-red-500/30 transition-colors cursor-pointer"
    >
      <WifiOff className="w-4 h-4" />
      <span>Connection lost. Click to retry.</span>
      <RefreshCw className="w-4 h-4" />
    </button>
  );
}
