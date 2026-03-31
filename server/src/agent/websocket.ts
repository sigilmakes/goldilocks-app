import { WebSocket, WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import jwt from 'jsonwebtoken';
import { CONFIG } from '../config.js';
import { sessionCache } from './sessions.js';
import type { AgentSession, AgentSessionEvent } from '@mariozechner/pi-coding-agent';

interface AuthUser {
  id: string;
  email: string;
}

interface ClientState {
  user: AuthUser | null;
  conversationId: string | null;
  session: AgentSession | null;
  unsubscribe: (() => void) | null;
}

// Message types from client
type ClientMessage =
  | { type: 'auth'; token: string }
  | { type: 'open'; conversationId: string }
  | { type: 'prompt'; text: string; files?: string[] }
  | { type: 'abort' };

// Message types to client
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

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function mapAgentEvent(event: AgentSessionEvent, ws: WebSocket): void {
  switch (event.type) {
    case 'message_update':
      if (event.assistantMessageEvent.type === 'text_delta') {
        send(ws, { type: 'text_delta', delta: event.assistantMessageEvent.delta });
      } else if (event.assistantMessageEvent.type === 'thinking_delta') {
        send(ws, { type: 'thinking_delta', delta: event.assistantMessageEvent.delta });
      }
      break;

    case 'tool_execution_start':
      send(ws, {
        type: 'tool_start',
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        args: event.args,
      });
      break;

    case 'tool_execution_update':
      if (event.partialResult) {
        const content = typeof event.partialResult === 'string' 
          ? event.partialResult 
          : JSON.stringify(event.partialResult);
        send(ws, { type: 'tool_update', toolCallId: event.toolCallId, content });
      }
      break;

    case 'tool_execution_end':
      send(ws, {
        type: 'tool_end',
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        result: event.result,
        isError: event.isError,
      });
      break;

    case 'message_end':
      send(ws, { type: 'message_end' });
      break;

    case 'agent_end':
      send(ws, { type: 'agent_end' });
      break;
  }
}

export function setupWebSocket(wss: WebSocketServer): void {
  wss.on('connection', (ws: WebSocket, _req: IncomingMessage) => {
    console.log('WebSocket client connected');

    const state: ClientState = {
      user: null,
      conversationId: null,
      session: null,
      unsubscribe: null,
    };

    ws.on('message', async (data) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        send(ws, { type: 'error', error: 'Invalid JSON' });
        return;
      }

      switch (msg.type) {
        case 'auth': {
          try {
            const payload = jwt.verify(msg.token, CONFIG.jwtSecret) as AuthUser;
            state.user = payload;
            send(ws, { type: 'auth_ok', userId: payload.id });
          } catch {
            send(ws, { type: 'auth_fail', error: 'Invalid or expired token' });
          }
          break;
        }

        case 'open': {
          if (!state.user) {
            send(ws, { type: 'error', error: 'Not authenticated' });
            return;
          }

          // Clean up previous session subscription
          if (state.unsubscribe) {
            state.unsubscribe();
            state.unsubscribe = null;
          }

          try {
            state.conversationId = msg.conversationId;
            state.session = await sessionCache.getOrCreate(state.user.id, msg.conversationId);

            // Subscribe to session events
            state.unsubscribe = state.session.subscribe((event) => {
              mapAgentEvent(event, ws);
            });

            send(ws, { type: 'ready', conversationId: msg.conversationId });
          } catch (err) {
            console.error('Failed to open session:', err);
            send(ws, { type: 'error', error: 'Failed to open session' });
          }
          break;
        }

        case 'prompt': {
          if (!state.user || !state.session || !state.conversationId) {
            send(ws, { type: 'error', error: 'No active session' });
            return;
          }

          try {
            sessionCache.touch(state.user.id, state.conversationId);
            
            // Handle file attachments if present
            // TODO: Implement file attachment handling
            
            await state.session.prompt(msg.text);
          } catch (err) {
            console.error('Prompt error:', err);
            send(ws, { type: 'error', error: 'Failed to process prompt' });
          }
          break;
        }

        case 'abort': {
          if (state.session) {
            try {
              await state.session.abort();
            } catch (err) {
              console.error('Abort error:', err);
            }
          }
          break;
        }
      }
    });

    ws.on('close', () => {
      console.log('WebSocket client disconnected');
      if (state.unsubscribe) {
        state.unsubscribe();
      }
    });

    ws.on('error', (err) => {
      console.error('WebSocket error:', err);
    });
  });
}
