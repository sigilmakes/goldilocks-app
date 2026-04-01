import type { AgentSession } from '@mariozechner/pi-coding-agent';

/**
 * A handle representing an active agent session with its associated paths.
 */
export interface SessionHandle {
  /** The Pi SDK AgentSession instance. */
  session: AgentSession;
  /** Absolute path to the user's workspace directory for this conversation. */
  workspacePath: string;
  /** Absolute path to the Pi session storage directory. */
  sessionPath: string;
}

/**
 * Abstract interface for how Pi SDK sessions are created, cached, and managed.
 *
 * Implementations can run sessions in-process (LocalSessionBackend) or
 * delegate to external sandboxed containers (future ContainerBackend, P6D).
 */
export interface SessionBackend {
  /**
   * Get an existing session or create a new one for the given user/conversation.
   */
  getOrCreate(userId: string, conversationId: string): Promise<SessionHandle>;

  /**
   * Mark a session as recently active (resets idle timeout).
   */
  touch(userId: string, conversationId: string): void;

  /**
   * Dispose of a specific session and free resources.
   */
  dispose(userId: string, conversationId: string): void;

  /**
   * Shut down all sessions and clean up (called on server shutdown).
   */
  shutdown(): void;
}
