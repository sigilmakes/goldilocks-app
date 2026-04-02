import { useEffect, useRef, useCallback, useState } from 'react';
import { useAuthStore } from '../store/auth';
import { useChatStore } from '../store/chat';
import type { ServerMessage } from '../../../shared/types';

export type AgentStatus = 'disconnected' | 'connecting' | 'authenticating' | 'opening' | 'ready';

export function useAgent(conversationId: string | null) {
  const ws = useRef<WebSocket | null>(null);
  const token = useAuthStore((s) => s.token);
  const [status, setStatus] = useState<AgentStatus>('disconnected');
  const [error, setError] = useState<string | null>(null);

  // Generation counter to detect stale connections after rapid switches
  const generationRef = useRef(0);

  useEffect(() => {
    const generation = ++generationRef.current;
    if (!conversationId || !token) {
      setStatus('disconnected');
      return;
    }

    setStatus('connecting');
    setError(null);

    // Close existing connection
    if (ws.current) {
      ws.current.close();
      ws.current = null;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);

    socket.onopen = () => {
      setStatus('authenticating');
      setError(null);
      socket.send(JSON.stringify({ type: 'auth', token }));
    };

    socket.onmessage = (event) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data);
      } catch {
        console.error('Invalid server message');
        return;
      }

      // Discard messages from stale connections
      if (generation !== generationRef.current) return;

      const store = useChatStore.getState();

      switch (msg.type) {
        case 'auth_ok':
          setStatus('opening');
          socket.send(JSON.stringify({ type: 'open', conversationId }));
          break;

        case 'auth_fail':
          setError(msg.error);
          setStatus('disconnected');
          break;

        case 'ready':
          setStatus('ready');
          break;

        case 'text_delta':
          store.appendTextDelta(msg.delta);
          break;

        case 'thinking_delta':
          store.appendThinkingDelta(msg.delta);
          break;

        case 'tool_start':
          store.startToolCall(msg.toolCallId, msg.toolName, msg.args);
          break;

        case 'tool_update':
          store.updateToolCall(msg.toolCallId, msg.content);
          break;

        case 'tool_end':
          store.endToolCall(msg.toolCallId, msg.result, msg.isError);
          break;

        case 'message_end':
          store.endMessage();
          break;

        case 'agent_end':
          store.endAgent();
          break;

        case 'error':
          setError(msg.error);
          store.endAgent();
          break;
      }
    };

    socket.onclose = () => {
      setStatus('disconnected');
    };

    socket.onerror = () => {
      setError('WebSocket connection error');
      setStatus('disconnected');
    };

    ws.current = socket;

    return () => {
      socket.close();
      ws.current = null;
    };
  }, [conversationId, token]);

  const isReady = status === 'ready';

  const send = useCallback((text: string, files?: string[]) => {
    if (!ws.current || ws.current.readyState !== WebSocket.OPEN || !isReady) {
      return;
    }
    const store = useChatStore.getState();
    store.addUserMessage(text, files);
    store.startAssistantMessage();
    ws.current.send(JSON.stringify({ type: 'prompt', text, files }));
  }, [isReady]);

  const abort = useCallback(() => {
    if (!ws.current || ws.current.readyState !== WebSocket.OPEN) {
      return;
    }
    ws.current.send(JSON.stringify({ type: 'abort' }));
    const store = useChatStore.getState();
    store.endAgent();
  }, []);

  return {
    send,
    abort,
    status,
    isReady,
    isConnected: status !== 'disconnected',
    error,
  };
}
