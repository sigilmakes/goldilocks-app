/**
 * Session management module.
 *
 * Selects the appropriate SessionBackend based on the SESSION_BACKEND env var:
 * - "local" (default): runs Pi SDK sessions in-process. No sandboxing.
 *   WARNING: All users share the same OS process. See architecture-decisions.md §5.
 * - "container": spawns per-user Docker containers for isolated sessions.
 *   Requires Docker socket access or k8s service account.
 */

import type { AgentSession } from '@mariozechner/pi-coding-agent';
import { LocalSessionBackend } from './local-backend.js';
import { ContainerSessionBackend } from './container-backend.js';
import type { SessionBackend, SessionHandle } from './session-backend.js';

function createBackend(): SessionBackend {
  const mode = process.env.SESSION_BACKEND ?? 'local';
  switch (mode) {
    case 'container':
      console.log('Using ContainerSessionBackend (per-user Docker containers)');
      return new ContainerSessionBackend();
    case 'local':
    default:
      console.log('Using LocalSessionBackend (in-process, no sandboxing)');
      return new LocalSessionBackend();
  }
}

const backend: SessionBackend = createBackend();

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
