/**
 * Session Manager — maps users to Bridge instances.
 *
 * One Bridge per user. One pod per user.
 * The Bridge lives for the lifetime of the user's pod.
 *
 * Responsibilities:
 *   - getOrCreateBridge(userId): ensure pod → exec pi → create Bridge
 *   - Conversation management via pi's RPC session commands
 *   - Cleanup on shutdown
 */

import { Bridge, type BridgeEvent, type BridgeEventHandler } from './bridge.js';
import { PodManager, type ExecStreams } from './pod-manager.js';
import { CONFIG } from '../config.js';
import { resolve } from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UserSession {
  bridge: Bridge;
  exec: ExecStreams;
  activeConversationPiSessionId: string | null;
}

// ---------------------------------------------------------------------------
// SessionManager
// ---------------------------------------------------------------------------

class SessionManager {
  private sessions = new Map<string, UserSession>();
  private podManager = new PodManager();
  private connecting = new Map<string, Promise<Bridge>>();

  /**
   * Get or create a Bridge for a user.
   * If the Bridge doesn't exist or is closed, creates a new one.
   */
  async getOrCreateBridge(userId: string): Promise<Bridge> {
    // Return existing bridge if alive
    const existing = this.sessions.get(userId);
    if (existing && !existing.bridge.isClosed) {
      this.podManager.touch(userId);
      return existing.bridge;
    }

    // If we're already connecting for this user, wait for that
    const inflight = this.connecting.get(userId);
    if (inflight) return inflight;

    // Create new connection
    const promise = this.connect(userId);
    this.connecting.set(userId, promise);
    try {
      const bridge = await promise;
      return bridge;
    } finally {
      this.connecting.delete(userId);
    }
  }

  /**
   * Subscribe to events from a user's Bridge.
   * Returns unsubscribe function.
   */
  async subscribe(userId: string, handler: BridgeEventHandler): Promise<() => void> {
    const bridge = await this.getOrCreateBridge(userId);
    return bridge.subscribe(handler);
  }

  /**
   * Send a prompt to the user's pi process.
   */
  async prompt(userId: string, text: string): Promise<string> {
    const bridge = await this.getOrCreateBridge(userId);
    this.podManager.touch(userId);
    return bridge.prompt(text);
  }

  /**
   * Abort the current prompt.
   */
  async abort(userId: string): Promise<void> {
    const session = this.sessions.get(userId);
    if (session && !session.bridge.isClosed) {
      await session.bridge.abort();
    }
  }

  /**
   * Switch to a pi session (conversation). Creates a new one if piSessionId is null.
   * Returns the pi session ID.
   */
  async switchSession(userId: string, piSessionId: string | null): Promise<string> {
    const bridge = await this.getOrCreateBridge(userId);
    const session = this.sessions.get(userId)!;

    if (piSessionId) {
      await bridge.rpc('switch_session', { sessionId: piSessionId });
      session.activeConversationPiSessionId = piSessionId;
      return piSessionId;
    } else {
      const result = await bridge.rpc('new_session', {}) as { sessionId?: string } | undefined;
      const newId = result?.sessionId ?? null;
      session.activeConversationPiSessionId = newId;
      return newId ?? '';
    }
  }

  /**
   * Get messages from the current pi session.
   */
  async getMessages(userId: string): Promise<unknown> {
    const bridge = await this.getOrCreateBridge(userId);
    return bridge.rpc('get_messages', {});
  }

  /**
   * Get current pi state (model, thinking level, etc.).
   */
  async getState(userId: string): Promise<unknown> {
    const bridge = await this.getOrCreateBridge(userId);
    return bridge.rpc('get_state', {});
  }

  /**
   * Get available models.
   */
  async getAvailableModels(userId: string): Promise<unknown> {
    const bridge = await this.getOrCreateBridge(userId);
    return bridge.rpc('get_available_models', {});
  }

  /**
   * Set the model.
   */
  async setModel(userId: string, modelId: string): Promise<void> {
    const bridge = await this.getOrCreateBridge(userId);
    await bridge.rpc('set_model', { modelId });
  }

  /**
   * Delete a conversation's pi session files.
   * Best-effort — pod might not be running.
   */
  async deleteConversation(userId: string, piSessionId: string): Promise<void> {
    try {
      const bridge = await this.getOrCreateBridge(userId);
      await bridge.rpc('delete_session', { sessionId: piSessionId });
    } catch (err) {
      console.error(`Failed to delete pi session ${piSessionId} for user ${userId}:`, err);
    }
  }

  /**
   * Touch a user's session (reset idle timeout).
   */
  touch(userId: string): void {
    this.podManager.touch(userId);
  }

  /**
   * Disconnect a user's Bridge and delete their pod.
   */
  async disconnect(userId: string): Promise<void> {
    const session = this.sessions.get(userId);
    if (session) {
      session.bridge.close();
      session.exec.close();
      this.sessions.delete(userId);
    }
    await this.podManager.deletePod(userId);
  }

  /**
   * Shut down all sessions and pods.
   */
  async shutdown(): Promise<void> {
    for (const [userId, session] of this.sessions) {
      session.bridge.close();
      session.exec.close();
    }
    this.sessions.clear();
    await this.podManager.shutdown();
  }

  /**
   * Get the PodManager (for file operations that need exec).
   */
  getPodManager(): PodManager {
    return this.podManager;
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private async connect(userId: string): Promise<Bridge> {
    // Clean up stale session
    const old = this.sessions.get(userId);
    if (old) {
      old.bridge.close();
      old.exec.close();
      this.sessions.delete(userId);
    }

    // Ensure pod is running
    await this.podManager.ensurePod(userId);

    // Give the pod a moment to stabilize
    await new Promise((r) => setTimeout(r, 500));

    // Exec pi --mode rpc --continue inside the pod
    const exec = await this.podManager.execInPod(userId, ['pi', '--mode', 'rpc', '--continue']);

    // Create Bridge with the exec streams
    const bridge = new Bridge({
      userId,
      logDir: resolve(CONFIG.dataDir, 'logs'),
      stdin: exec.stdin,
      stdout: exec.stdout,
      stderr: exec.stderr,
      onExit: (reason) => {
        console.log(`Bridge for user ${userId} exited: ${reason}`);
        this.sessions.delete(userId);
      },
    });

    const session: UserSession = {
      bridge,
      exec,
      activeConversationPiSessionId: null,
    };

    this.sessions.set(userId, session);
    return bridge;
  }
}

// Singleton
export const sessionManager = new SessionManager();
