/**
 * Session management module.
 *
 * Kubernetes is the ONLY way to run agent sessions.
 * Every session runs in its own k8s pod — no exceptions, no fallbacks.
 * Local dev uses `kind`, production uses a real cluster. Same code path.
 */

import type { AgentSession } from '@mariozechner/pi-coding-agent';
import { ContainerSessionBackend } from './container-backend.js';
import type { SessionBackend } from './session-backend.js';

console.log('Using ContainerSessionBackend (k8s agent pods)');
const backend: SessionBackend = new ContainerSessionBackend();

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
