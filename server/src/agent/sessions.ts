/**
 * Session management module.
 *
 * WARNING: LocalSessionBackend runs all sessions in the Express server process.
 * No sandboxing. See architecture-decisions.md §5.
 */

import type { AgentSession } from '@mariozechner/pi-coding-agent';
import { LocalSessionBackend } from './local-backend.js';
import type { SessionBackend, SessionHandle } from './session-backend.js';

const backend: SessionBackend = new LocalSessionBackend();

/**
 * Thin compatibility wrapper around SessionBackend.
 *
 * getOrCreate() returns the AgentSession directly (the websocket layer
 * only needs the session object). For code that also needs workspace paths,
 * use `backend.getOrCreate()` instead.
 */
export const sessionCache = {
  /** Returns the underlying SessionBackend for full SessionHandle access. */
  get backend(): SessionBackend {
    return backend;
  },

  async getOrCreate(userId: string, conversationId: string): Promise<AgentSession> {
    const handle = await backend.getOrCreate(userId, conversationId);
    return handle.session;
  },

  touch(userId: string, conversationId: string): void {
    backend.touch(userId, conversationId);
  },

  dispose(userId: string, conversationId: string): void {
    backend.dispose(userId, conversationId);
  },

  shutdown(): void {
    backend.shutdown();
  },
};
