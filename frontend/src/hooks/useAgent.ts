import { useEffect, useRef, useCallback, useState } from 'react';
import { useAuthStore } from '../store/auth';
import { useChatStore } from '../store/chat';

type ServerMessage =
  | { type: 'auth_ok'; userId: string }
  | { type: 'auth_fail'; error: string }
  | { type: 'ready'; conversationId: string }
  | { type: 'text_delta'; delta: string }
  | { type: 'thinking_delta'; delta: string }
  | { type: 'tool_start'; toolName: string; toolCallId: string; args: unknown }
  | { type: 'tool_update'; toolCallId: string; content: string }
  | { type: 'tool_end'; toolName: string; toolCallId: string; result: unknown; isError: boolean }
  | { type: 'message_end' }
  | { type: 'agent_end' }
  | { type: 'error'; error: string };

export function useAgent(conversationId: string | null) {
  const ws = useRef<WebSocket | null>(null);
  const token = useAuthStore((s) => s.token);
  const [isConnected, setIsConnected] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Generation counter to detect stale connections after rapid switches (§4.1)
  const generationRef = useRef(0);

  useEffect(() => {
    const generation = ++generationRef.current;
    if (!conversationId || !token) {
      setIsConnected(false);
      setIsReady(false);
      return;
    }

    // Don't clear messages — Sidebar.loadConversation() handles that
    setIsReady(false);
    setError(null);

    // Close existing connection
    if (ws.current) {
      ws.current.close();
      ws.current = null;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);

    socket.onopen = () => {
      setIsConnected(true);
      setError(null);
      // Authenticate
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

      // Discard messages from stale connections (§4.1)
      if (generation !== generationRef.current) return;

      const store = useChatStore.getState();

      switch (msg.type) {
        case 'auth_ok':
          // Use the conversationId captured at effect creation, not a ref
          socket.send(JSON.stringify({ type: 'open', conversationId }));
          break;

        case 'auth_fail':
          setError(msg.error);
          setIsConnected(false);
          break;

        case 'ready':
          setIsReady(true);
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
      setIsConnected(false);
      setIsReady(false);
    };

    socket.onerror = () => {
      setError('WebSocket connection error');
      setIsConnected(false);
    };

    ws.current = socket;

    return () => {
      socket.close();
      ws.current = null;
    };
  }, [conversationId, token]); // Only re-run when these change

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
    // Immediately update UI so the user sees the stop take effect
    const store = useChatStore.getState();
    store.endAgent();
  }, []);

  return {
    send,
    abort,
    isConnected,
    isReady,
    error,
  };
}
