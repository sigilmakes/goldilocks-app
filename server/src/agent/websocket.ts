/**
 * WebSocket handler — connects the React frontend to the Bridge.
 *
 * Protocol (shared/types.ts):
 *   Client → Server: auth, open, prompt, abort
 *   Server → Client: auth_ok, auth_fail, ready, text_delta, thinking_delta,
 *                     tool_start, tool_update, tool_end, message_end, agent_end, error
 *
 * Each WebSocket connection maps to one user. Multiple tabs share the same Bridge.
 * Events from the Bridge are fanned out to all connected WebSocket clients for that user.
 */

import { WebSocket, WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import jwt from 'jsonwebtoken';
import { CONFIG } from '../config.js';
import { sessionManager } from './sessions.js';
import { getDb } from '../db.js';
import type { BridgeEvent } from './bridge.js';
import type { ClientMessage, ServerMessage, HistoryMessage } from '../shared/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuthUser {
  id: string;
  email: string;
}

interface ClientState {
  user: AuthUser | null;
  conversationId: string | null;
  unsubscribe: (() => void) | null;
  isProcessing: boolean;
  /** Track whether text deltas were received for the current message. */
  receivedTextDelta: boolean;
  /** Track the current streaming tool call ID (from toolcall_start). */
  currentToolCallId: string | null;
  /** Map pi's execution toolCallId → our streaming toolCallId. */
  toolCallIdMap: Map<string, string>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(msg));
    } catch (err) {
      console.error('Failed to send WebSocket message:', err);
    }
  }
}

/**
 * Map a raw Bridge event to WebSocket messages for the frontend.
 *
 * Handles:
 *   - message_update (text_delta, thinking_delta)
 *   - message_end fallback (extracts text if no deltas were streamed)
 *   - tool_execution_start/update/end
 *   - message_end, agent_end
 */
function mapBridgeEvent(event: BridgeEvent, ws: WebSocket, state: ClientState): void {
  try {
    switch (event.type) {
      case 'message_update': {
        const delta = event.assistantMessageEvent as {
          type?: string;
          delta?: string;
          contentIndex?: number;
          toolCall?: { id?: string; name?: string; arguments?: string };
          partial?: { id?: string; name?: string; arguments?: string };
        } | undefined;
        if (!delta) break;

        if (delta.type === 'text_delta' && delta.delta) {
          state.receivedTextDelta = true;
          send(ws, { type: 'text_delta', delta: delta.delta });
        } else if (delta.type === 'thinking_delta' && delta.delta) {
          send(ws, { type: 'thinking_delta', delta: delta.delta });
        } else if (delta.type === 'toolcall_start') {
          const tc = delta.partial ?? delta.toolCall;
          const toolCallId = tc?.id ?? `tc_${Date.now()}`;
          state.currentToolCallId = toolCallId;
          send(ws, {
            type: 'tool_start',
            toolName: tc?.name ?? 'unknown',
            toolCallId,
            args: {},
          });
        } else if (delta.type === 'toolcall_delta' && delta.delta && state.currentToolCallId) {
          send(ws, {
            type: 'tool_update',
            toolCallId: state.currentToolCallId,
            content: delta.delta,
          });
        } else if (delta.type === 'toolcall_end') {
          // Don't send another tool_start — the card already exists.
          // Keep currentToolCallId alive for tool_execution_start to map it.
        }
        break;
      }

      case 'message_end': {
        // Fallback: extract text from message_end ONLY if no deltas were streamed
        if (!state.receivedTextDelta) {
          const msg = event.message as {
            role?: string;
            content?: Array<{ type: string; text?: string }>;
          } | undefined;
          if (msg?.role === 'assistant' && Array.isArray(msg.content)) {
            const textBlocks = msg.content.filter((b) => b.type === 'text');
            const fullText = textBlocks.map((b) => b.text ?? '').join('');
            if (fullText) {
              send(ws, { type: 'text_delta', delta: fullText });
            }
          }
        }
        state.receivedTextDelta = false;
        send(ws, { type: 'message_end' });
        break;
      }

      case 'tool_execution_start': {
        const execId = event.toolCallId as string;
        if (state.currentToolCallId && execId) {
          state.toolCallIdMap.set(execId, state.currentToolCallId);
          state.currentToolCallId = null;
        }
        break;
      }

      case 'tool_execution_update':
        // Skip — we already stream content via toolcall_delta during arg generation.
        // tool_execution_update is the execution output, not the streamed args.
        break;

      case 'tool_execution_end': {
        const execTcId = event.toolCallId as string;
        const mappedId = state.toolCallIdMap.get(execTcId) ?? execTcId;
        state.toolCallIdMap.delete(execTcId);

        // Extract text from result (pi wraps it in {content: [{type: "text", text: "..."}]})
        let result = event.result;
        if (result && typeof result === 'object' && Array.isArray((result as any).content)) {
          const textParts = (result as any).content
            .filter((b: any) => b.type === 'text')
            .map((b: any) => b.text ?? '');
          result = textParts.join('');
        }

        send(ws, {
          type: 'tool_end',
          toolName: event.toolName as string,
          toolCallId: mappedId,
          result,
          isError: event.isError as boolean ?? false,
        });
        break;
      }

      case 'agent_end':
        send(ws, { type: 'agent_end' });
        break;

      // Ignore: agent_start, turn_start, turn_end, message_start — not needed by frontend
    }
  } catch (err) {
    console.error('Error mapping bridge event:', err);
  }
}

// ---------------------------------------------------------------------------
// WebSocket setup
// ---------------------------------------------------------------------------

export function setupWebSocket(wss: WebSocketServer): void {
  wss.on('connection', (ws: WebSocket, _req: IncomingMessage) => {
    console.log('WebSocket client connected');

    const state: ClientState = {
      user: null,
      conversationId: null,
      unsubscribe: null,
      isProcessing: false,
      receivedTextDelta: false,
      currentToolCallId: null,
      toolCallIdMap: new Map(),
    };

    const cleanup = () => {
      if (state.unsubscribe) {
        try { state.unsubscribe(); } catch (err) {
          console.error('Error unsubscribing:', err);
        }
        state.unsubscribe = null;
      }
      state.conversationId = null;
    };

    ws.on('message', async (data) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        send(ws, { type: 'error', error: 'Invalid JSON' });
        return;
      }

      try {
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

            cleanup();

            try {
              state.conversationId = msg.conversationId;

              // Look up pi_session_id from DB
              const db = getDb();
              const row = db.prepare(
                'SELECT pi_session_id FROM conversations WHERE id = ? AND user_id = ?'
              ).get(msg.conversationId, state.user.id) as { pi_session_id: string | null } | undefined;

              if (!row) {
                send(ws, { type: 'error', error: 'Conversation not found' });
                return;
              }

              // Subscribe to bridge events BEFORE switching session
              const unsubscribe = await sessionManager.subscribe(state.user.id, (event: BridgeEvent) => {
                mapBridgeEvent(event, ws, state);
              });
              state.unsubscribe = unsubscribe;

              // Switch to the pi session (or create if no pi_session_id yet)
              const sessionPath = await sessionManager.switchSession(
                state.user.id,
                row.pi_session_id, // null on first open → creates new session
              );

              // Store the session path if this is a new conversation
              if (!row.pi_session_id && sessionPath) {
                db.prepare(
                  'UPDATE conversations SET pi_session_id = ? WHERE id = ?'
                ).run(sessionPath, msg.conversationId);
              }

              // Fetch message history from pi
              let messages: HistoryMessage[] = [];
              try {
                const history = await sessionManager.getMessages(state.user.id);
                // Pi may return { messages: [...] } or bare array
                const msgList = Array.isArray(history) ? history
                  : (history as Record<string, unknown>)?.messages;
                if (Array.isArray(msgList)) {
                  for (const m of msgList as any[]) {
                    if (m.role === 'user') {
                      const text = typeof m.content === 'string'
                        ? m.content
                        : Array.isArray(m.content)
                          ? m.content.filter((b: any) => b.type === 'text').map((b: any) => b.text ?? '').join('')
                          : '';
                      if (text) messages.push({ role: 'user', text });
                    } else if (m.role === 'assistant' && Array.isArray(m.content)) {
                      // Extract text blocks
                      const textParts = m.content.filter((b: any) => b.type === 'text').map((b: any) => b.text ?? '');
                      const text = textParts.join('');
                      // Extract tool calls
                      const toolCalls = m.content
                        .filter((b: any) => b.type === 'toolCall')
                        .map((b: any) => ({
                          toolCallId: b.id ?? '',
                          toolName: b.name ?? 'tool',
                          args: b.arguments ? (typeof b.arguments === 'string' ? (() => { try { return JSON.parse(b.arguments); } catch { return { raw: b.arguments }; } })() : b.arguments) : {},
                        }));
                      if (text || toolCalls.length > 0) {
                        messages.push({ role: 'assistant', text, toolCalls });
                      }
                    } else if (m.role === 'toolResult') {
                      // Attach tool results to the previous assistant message's tool call
                      const prev = messages[messages.length - 1];
                      if (prev?.role === 'assistant' && prev.toolCalls) {
                        const tc = prev.toolCalls.find((t: any) => t.toolCallId === m.toolCallId);
                        if (tc) {
                          tc.result = Array.isArray(m.content)
                            ? m.content.filter((b: any) => b.type === 'text').map((b: any) => b.text ?? '').join('')
                            : typeof m.content === 'string' ? m.content : '';
                          tc.isError = m.isError ?? false;
                        }
                      }
                    }
                  }
                }
              } catch (err) {
                console.error('Failed to fetch messages:', err);
              }

              send(ws, { type: 'ready', conversationId: msg.conversationId, messages });
            } catch (err) {
              console.error('Failed to open session:', err);
              const errorMsg = err instanceof Error ? err.message : 'Failed to open session';
              send(ws, { type: 'error', error: errorMsg });
              cleanup();
            }
            break;
          }

          case 'prompt': {
            if (!state.user || !state.conversationId) {
              send(ws, { type: 'error', error: 'No active session' });
              return;
            }

            if (state.isProcessing) {
              send(ws, { type: 'error', error: 'Already processing a prompt' });
              return;
            }

            try {
              state.isProcessing = true;
              sessionManager.touch(state.user.id);

              // Update conversation title from first message
              const db = getDb();
              const conv = db.prepare(
                'SELECT title FROM conversations WHERE id = ?'
              ).get(state.conversationId) as { title: string } | undefined;
              if (conv?.title === 'New conversation' && msg.text.trim()) {
                const title = msg.text.trim().slice(0, 50).replace(/\s+/g, ' ');
                db.prepare(
                  'UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?'
                ).run(title, Date.now(), state.conversationId);
              } else {
                db.prepare(
                  'UPDATE conversations SET updated_at = ? WHERE id = ?'
                ).run(Date.now(), state.conversationId);
              }

              await sessionManager.prompt(state.user.id, msg.text);
            } catch (err) {
              console.error('Prompt error:', err);
              const errorMsg = err instanceof Error ? err.message : 'Failed to process prompt';
              send(ws, { type: 'error', error: errorMsg });
            } finally {
              state.isProcessing = false;
            }
            break;
          }

          case 'abort': {
            if (state.user && state.isProcessing) {
              try {
                await sessionManager.abort(state.user.id);
              } catch (err) {
                console.error('Abort error:', err);
              }
              state.isProcessing = false;
            }
            break;
          }
        }
      } catch (err) {
        console.error('WebSocket message handler error:', err);
        send(ws, { type: 'error', error: 'Internal server error' });
      }
    });

    ws.on('close', () => {
      console.log('WebSocket client disconnected');
      cleanup();
    });

    ws.on('error', (err) => {
      console.error('WebSocket error:', err);
      cleanup();
    });
  });
}
