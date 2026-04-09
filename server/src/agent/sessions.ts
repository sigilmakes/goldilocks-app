import {
  AuthStorage,
  createAgentSession,
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
  getAgentDir,
  ModelRegistry,
  SessionManager as PiSessionManager,
  type AgentSession,
} from '@mariozechner/pi-coding-agent';
import { resolve } from 'path';
import { getDb } from '../db.js';
import { decrypt } from '../crypto.js';
import { CONFIG } from '../config.js';
import { PodManager } from './pod-manager.js';
import {
  createPodToolOperations,
  deleteSessionFile,
  ensureSessionDir,
  getRemoteWorkspaceCwd,
  isSessionPathInside,
} from './pod-tool-operations.js';

export interface SessionEvent {
  type: string;
  [key: string]: unknown;
}

export type SessionEventHandler = (event: SessionEvent) => void;

interface UserSessionContext {
  session: AgentSession;
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  sessionManager: PiSessionManager;
  sessionPath: string | null;
  authFingerprint: string;
  subscribers: Set<SessionEventHandler>;
  unsubscribeFns: Map<SessionEventHandler, () => void>;
}

interface ApiKeyRow {
  provider: string;
  encrypted_key: string;
}

class SessionManager {
  private sessions = new Map<string, UserSessionContext>();
  private podManager = new PodManager();
  private connecting = new Map<string, Promise<UserSessionContext>>();

  async subscribe(userId: string, handler: SessionEventHandler): Promise<() => void> {
    const context = await this.getOrCreateContext(userId, null);
    context.subscribers.add(handler);
    this.bindSubscriber(context, handler);

    return () => {
      const current = this.sessions.get(userId);
      current?.subscribers.delete(handler);
      const unsubscribe = current?.unsubscribeFns.get(handler);
      unsubscribe?.();
      current?.unsubscribeFns.delete(handler);
    };
  }

  async prompt(userId: string, text: string): Promise<void> {
    const context = await this.getOrCreateContext(userId, null);
    this.podManager.touch(userId);
    await context.session.prompt(text);
  }

  async abort(userId: string): Promise<void> {
    const context = this.sessions.get(userId);
    if (context) {
      await context.session.abort();
    }
  }

  async switchSession(userId: string, sessionPath: string | null): Promise<string> {
    const apiKeys = this.getUserApiKeys(userId);
    const authFingerprint = apiKeys
      .map((row) => `${row.provider}:${row.encrypted_key}`)
      .sort()
      .join('|');

    const context = sessionPath === null
      ? await this.connect(userId, null, apiKeys, authFingerprint)
      : await this.getOrCreateContext(userId, sessionPath);

    context.sessionPath = context.session.sessionFile ?? sessionPath;
    return context.session.sessionFile ?? '';
  }

  async getMessages(userId: string): Promise<unknown[]> {
    const context = await this.getOrCreateContext(userId, null);
    return context.session.messages as unknown[];
  }

  async getState(userId: string): Promise<unknown> {
    const context = await this.getOrCreateContext(userId, null);
    return {
      sessionFile: context.session.sessionFile,
      model: context.session.model
        ? {
            provider: context.session.model.provider,
            id: context.session.model.id,
            name: context.session.model.name,
          }
        : null,
      thinkingLevel: context.session.thinkingLevel,
    };
  }

  async getAvailableModels(userId: string): Promise<unknown> {
    const context = await this.getOrCreateContext(userId, null);
    const models = await context.modelRegistry.getAvailable();
    return {
      models: models.map((model) => ({
        id: model.id,
        provider: model.provider,
        name: model.name,
        contextWindow: model.contextWindow,
        supportsThinking: model.reasoning,
      })),
    };
  }

  async setModel(userId: string, modelId: string): Promise<void> {
    const context = await this.getOrCreateContext(userId, null);
    const models = await context.modelRegistry.getAvailable();
    const model = models.find((candidate) => candidate.id === modelId);
    if (!model) {
      throw new Error(`Model not available: ${modelId}`);
    }
    await context.session.setModel(model);
  }

  async deleteConversation(userId: string, piSessionId: string): Promise<void> {
    const sessionDir = this.getSessionDir(userId);
    const sessionPath = resolve(piSessionId);
    if (!isSessionPathInside(sessionDir, sessionPath)) {
      throw new Error(`Refusing to delete session outside ${sessionDir}`);
    }

    await deleteSessionFile(sessionPath);

    const current = this.sessions.get(userId);
    if (current?.session.sessionFile === sessionPath) {
      await this.disposeContext(userId);
    }
  }

  touch(userId: string): void {
    this.podManager.touch(userId);
  }

  async disconnect(userId: string): Promise<void> {
    await this.disposeContext(userId);
    await this.podManager.deletePod(userId);
  }

  async shutdown(): Promise<void> {
    for (const userId of this.sessions.keys()) {
      await this.disposeContext(userId);
    }
    await this.podManager.shutdown();
  }

  getPodManager(): PodManager {
    return this.podManager;
  }

  private async getOrCreateContext(userId: string, requestedSessionPath: string | null): Promise<UserSessionContext> {
    const apiKeys = this.getUserApiKeys(userId);
    const authFingerprint = apiKeys
      .map((row) => `${row.provider}:${row.encrypted_key}`)
      .sort()
      .join('|');

    const existing = this.sessions.get(userId);
    if (existing) {
      const normalizedRequested = requestedSessionPath ? resolve(requestedSessionPath) : existing.sessionPath;
      const normalizedExisting = existing.sessionPath ? resolve(existing.sessionPath) : null;

      if (normalizedExisting === normalizedRequested && existing.authFingerprint === authFingerprint) {
        this.podManager.touch(userId);
        return existing;
      }
    }

    const inflight = this.connecting.get(userId);
    if (inflight) {
      return inflight;
    }

    const promise = this.connect(userId, requestedSessionPath, apiKeys, authFingerprint);
    this.connecting.set(userId, promise);
    try {
      return await promise;
    } finally {
      this.connecting.delete(userId);
    }
  }

  private async connect(
    userId: string,
    requestedSessionPath: string | null,
    apiKeys: ApiKeyRow[],
    authFingerprint: string,
  ): Promise<UserSessionContext> {
    const priorSubscribers = new Set(this.sessions.get(userId)?.subscribers ?? []);
    await this.disposeContext(userId);

    const sessionDir = this.getSessionDir(userId);
    await ensureSessionDir(sessionDir);

    const authStorage = AuthStorage.inMemory();
    this.syncAuthStorage(authStorage, apiKeys, userId);
    const modelRegistry = ModelRegistry.inMemory(authStorage);
    const operations = createPodToolOperations({ podManager: this.podManager, userId });

    const sessionManager = requestedSessionPath
      ? PiSessionManager.open(resolve(requestedSessionPath), sessionDir)
      : PiSessionManager.create(process.cwd(), sessionDir);

    const { session } = await createAgentSession({
      cwd: process.cwd(),
      agentDir: getAgentDir(),
      authStorage,
      modelRegistry,
      sessionManager,
      tools: [
        createReadTool(getRemoteWorkspaceCwd(), { operations: operations.read }),
        createBashTool(getRemoteWorkspaceCwd(), { operations: operations.bash }),
        createEditTool(getRemoteWorkspaceCwd(), { operations: operations.edit }),
        createWriteTool(getRemoteWorkspaceCwd(), { operations: operations.write }),
        createGrepTool(getRemoteWorkspaceCwd(), { operations: operations.grep }),
        createFindTool(getRemoteWorkspaceCwd(), { operations: operations.find }),
        createLsTool(getRemoteWorkspaceCwd(), { operations: operations.ls }),
      ],
    });

    const context: UserSessionContext = {
      session,
      authStorage,
      modelRegistry,
      sessionManager,
      sessionPath: session.sessionFile ?? requestedSessionPath,
      authFingerprint,
      subscribers: priorSubscribers,
      unsubscribeFns: new Map(),
    };

    this.sessions.set(userId, context);

    for (const subscriber of context.subscribers) {
      this.bindSubscriber(context, subscriber);
    }

    return context;
  }

  private bindSubscriber(context: UserSessionContext, handler: SessionEventHandler): void {
    context.unsubscribeFns.get(handler)?.();
    const unsubscribe = context.session.subscribe((event) => handler(event as SessionEvent));
    context.unsubscribeFns.set(handler, unsubscribe);
  }

  private async disposeContext(userId: string): Promise<void> {
    const existing = this.sessions.get(userId);
    if (!existing) return;

    for (const unsubscribe of existing.unsubscribeFns.values()) {
      try {
        unsubscribe();
      } catch (err) {
        console.error('Failed to unsubscribe session listener:', err);
      }
    }
    existing.unsubscribeFns.clear();
    existing.session.dispose();
    this.sessions.delete(userId);
  }

  private getSessionDir(userId: string): string {
    return resolve(CONFIG.dataDir, 'agent-sessions', userId);
  }

  private getUserApiKeys(userId: string): ApiKeyRow[] {
    const db = getDb();
    return db.prepare(
      'SELECT provider, encrypted_key FROM api_keys WHERE user_id = ? ORDER BY provider ASC'
    ).all(userId) as ApiKeyRow[];
  }

  private syncAuthStorage(authStorage: AuthStorage, rows: ApiKeyRow[], userId: string): void {
    const providers = new Set<string>();

    for (const row of rows) {
      try {
        authStorage.setRuntimeApiKey(row.provider, decrypt(row.encrypted_key));
        providers.add(row.provider);
      } catch (err) {
        console.error(`Failed to decrypt ${row.provider} key for user ${userId}:`, err);
      }
    }

    for (const provider of ['anthropic', 'openai', 'google']) {
      if (!providers.has(provider)) {
        authStorage.removeRuntimeApiKey(provider);
      }
    }
  }
}

export const sessionManager = new SessionManager();
