import { useState, useEffect, useRef, useCallback } from 'react';

interface ConnectionStatus {
  isConnected: boolean;
  isReconnecting: boolean;
  reconnect: () => void;
}

/**
 * Tracks WebSocket connection state with auto-reconnect and exponential backoff.
 * Pings the /api/health endpoint as a lightweight connectivity check.
 */
export function useConnectionStatus(): ConnectionStatus {
  const [isConnected, setIsConnected] = useState(true);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const retryCount = useRef(0);
  const timerId = useRef<ReturnType<typeof setTimeout>>();
  const maxDelay = 30000; // 30s max

  const checkConnection = useCallback(async () => {
    try {
      const res = await fetch('/api/health', { method: 'GET', cache: 'no-store' });
      if (res.ok) {
        setIsConnected(true);
        setIsReconnecting(false);
        retryCount.current = 0;
        return true;
      }
    } catch {
      // network error
    }
    setIsConnected(false);
    return false;
  }, []);

  const scheduleRetry = useCallback(() => {
    setIsReconnecting(true);
    const delay = Math.min(1000 * Math.pow(2, retryCount.current), maxDelay);
    retryCount.current += 1;

    timerId.current = setTimeout(async () => {
      const ok = await checkConnection();
      if (!ok) {
        // If we've retried too many times, stop auto-retrying
        if (retryCount.current < 10) {
          scheduleRetry();
        } else {
          setIsReconnecting(false);
        }
      }
    }, delay);
  }, [checkConnection]);

  const reconnect = useCallback(() => {
    retryCount.current = 0;
    setIsReconnecting(true);
    checkConnection().then((ok) => {
      if (!ok) scheduleRetry();
    });
  }, [checkConnection, scheduleRetry]);

  // Periodic heartbeat check
  useEffect(() => {
    const interval = setInterval(async () => {
      const ok = await checkConnection();
      if (!ok && !isReconnecting) {
        scheduleRetry();
      }
    }, 30000); // check every 30s

    return () => {
      clearInterval(interval);
      if (timerId.current) clearTimeout(timerId.current);
    };
  }, [checkConnection, isReconnecting, scheduleRetry]);

  // Listen for online/offline events
  useEffect(() => {
    const handleOnline = () => {
      reconnect();
    };
    const handleOffline = () => {
      setIsConnected(false);
      setIsReconnecting(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [reconnect]);

  return { isConnected, isReconnecting, reconnect };
}
