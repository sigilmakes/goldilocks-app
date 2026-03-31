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

  const {
    addUserMessage,
    startAssistantMessage,
    appendTextDelta,
    appendThinkingDelta,
    startToolCall,
    updateToolCall,
    endToolCall,
    endMessage,
    endAgent,
    clearMessages,
  } = useChatStore();

  useEffect(() => {
    if (!conversationId || !token) {
      setIsConnected(false);
      setIsReady(false);
      return;
    }

    // Clear messages when switching conversations
    clearMessages();

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

      switch (msg.type) {
        case 'auth_ok':
          // Open the conversation
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
          appendTextDelta(msg.delta);
          break;

        case 'thinking_delta':
          appendThinkingDelta(msg.delta);
          break;

        case 'tool_start':
          startToolCall(msg.toolCallId, msg.toolName, msg.args);
          break;

        case 'tool_update':
          updateToolCall(msg.toolCallId, msg.content);
          break;

        case 'tool_end':
          endToolCall(msg.toolCallId, msg.result, msg.isError);
          break;

        case 'message_end':
          endMessage();
          break;

        case 'agent_end':
          endAgent();
          break;

        case 'error':
          setError(msg.error);
          endAgent();
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
  }, [conversationId, token]);

  const send = useCallback((text: string, files?: string[]) => {
    if (!ws.current || ws.current.readyState !== WebSocket.OPEN || !isReady) {
      return;
    }
    addUserMessage(text, files);
    startAssistantMessage();
    ws.current.send(JSON.stringify({ type: 'prompt', text, files }));
  }, [isReady, addUserMessage, startAssistantMessage]);

  const abort = useCallback(() => {
    if (!ws.current || ws.current.readyState !== WebSocket.OPEN) {
      return;
    }
    ws.current.send(JSON.stringify({ type: 'abort' }));
  }, []);

  return {
    send,
    abort,
    isConnected,
    isReady,
    error,
  };
}
