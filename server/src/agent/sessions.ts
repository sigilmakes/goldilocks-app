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
import { getDb } from '../db.js';
import { decrypt } from '../crypto.js';

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
   * Switch to a pi session (conversation). Creates a new one if sessionPath is null.
   * Returns the pi session file path (used to switch back later).
   */
  async switchSession(userId: string, sessionPath: string | null): Promise<string> {
    const bridge = await this.getOrCreateBridge(userId);
    const session = this.sessions.get(userId)!;

    if (sessionPath) {
      // Resume existing session by path
      await bridge.rpc('switch_session', { sessionPath });
    } else {
      // Create a new session
      await bridge.rpc('new_session', {});
    }

    // Get the session file path from pi's state
    const state = await bridge.rpc('get_state', {}) as Record<string, unknown> | undefined;
    const newPath = (state?.sessionFile as string) ?? '';
    session.activeConversationPiSessionId = newPath;
    return newPath;
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

  private static readonly PROVIDER_ENV_MAP: Record<string, string> = {
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    google: 'GEMINI_API_KEY',
  };

  /**
   * Read the user's API keys from the DB and return as KEY=value args for `env`.
   */
  private getUserApiKeyArgs(userId: string): string[] {
    const args: string[] = [];
    try {
      const db = getDb();
      const rows = db.prepare(
        'SELECT provider, encrypted_key FROM api_keys WHERE user_id = ?'
      ).all(userId) as Array<{ provider: string; encrypted_key: string }>;

      for (const row of rows) {
        const envName = SessionManager.PROVIDER_ENV_MAP[row.provider];
        if (envName) {
          try {
            const key = decrypt(row.encrypted_key);
            if (key) args.push(`${envName}=${key}`);
          } catch {
            console.error(`Failed to decrypt ${row.provider} key for user ${userId}`);
          }
        }
      }
    } catch (err) {
      console.error('Failed to query user API keys:', err);
    }
    return args;
  }

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

    // Build exec command with user's API keys injected via `env`.
    // Keys are read fresh from the DB each time a bridge is created,
    // so key updates take effect without restarting the pod.
    const apiKeyEnv = this.getUserApiKeyArgs(userId);
    const command = apiKeyEnv.length > 0
      ? ['env', ...apiKeyEnv, 'pi', '--mode', 'rpc', '--continue']
      : ['pi', '--mode', 'rpc', '--continue'];
    const exec = await this.podManager.execInPod(userId, command);

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
