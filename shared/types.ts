/**
 * Shared WebSocket message types used by both the frontend client and backend server.
 *
 * Client → Server: auth, open, prompt, abort
 * Server → Client: auth_ok, auth_fail, ready, text_delta, thinking_delta,
 *                   tool_start, tool_update, tool_end, message_end, agent_end, error
 */

// ---------------------------------------------------------------------------
// Client → Server
// ---------------------------------------------------------------------------

export type ClientMessage =
  | { type: 'auth'; token: string }
  | { type: 'open'; conversationId: string }
  | { type: 'prompt'; text: string; files?: string[] }
  | { type: 'abort' };

// ---------------------------------------------------------------------------
// Server → Client
// ---------------------------------------------------------------------------

export type ServerMessage =
  | { type: 'auth_ok'; userId: string }
  | { type: 'auth_fail'; error: string }
  | { type: 'ready'; conversationId: string; messages?: HistoryMessage[] }
  | { type: 'text_delta'; delta: string }
  | { type: 'thinking_delta'; delta: string }
  | { type: 'tool_start'; toolName: string; toolCallId: string; args: unknown }
  | { type: 'tool_update'; toolCallId: string; content: string }
  | { type: 'tool_end'; toolName: string; toolCallId: string; result: unknown; isError: boolean }
  | { type: 'message_end' }
  | { type: 'agent_end' }
  | { type: 'error'; error: string };

/** A message from pi's session history. */
export interface HistoryMessage {
  role: 'user' | 'assistant';
  text: string;
}
