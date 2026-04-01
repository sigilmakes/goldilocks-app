import {
  createAgentSession,
  AuthStorage,
  ModelRegistry,
  SessionManager,
  DefaultResourceLoader,
  createCodingTools,
  type AgentSession,
} from '@mariozechner/pi-coding-agent';
import { mkdirSync, existsSync, writeFileSync, symlinkSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import { CONFIG } from '../config.js';
import type { SessionBackend, SessionHandle } from './session-backend.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN_DIR = resolve(__dirname, '../../..', 'bin');

interface CachedSession {
  handle: SessionHandle;
  userId: string;
  conversationId: string;
  lastActive: number;
}

/**
 * WARNING: LocalSessionBackend runs all sessions in the Express server process.
 * No sandboxing. See architecture-decisions.md §5.
 *
 * This backend creates Pi SDK AgentSessions in-process, with LRU eviction
 * and idle timeout to manage memory.
 */
export class LocalSessionBackend implements SessionBackend {
  private sessions = new Map<string, CachedSession>();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Periodic cleanup of idle sessions
    this.cleanupInterval = setInterval(() => this.evictIdle(), 60000);
  }

  private getKey(userId: string, conversationId: string): string {
    return `${userId}:${conversationId}`;
  }

  private getWorkspacePath(userId: string, conversationId: string): string {
    return resolve(CONFIG.workspaceRoot, userId, conversationId, 'workspace');
  }

  private getSessionPath(userId: string, conversationId: string): string {
    return resolve(CONFIG.workspaceRoot, userId, conversationId, 'pi-session');
  }

  async getOrCreate(userId: string, conversationId: string): Promise<SessionHandle> {
    const key = this.getKey(userId, conversationId);

    const existing = this.sessions.get(key);
    if (existing) {
      existing.lastActive = Date.now();
      return existing.handle;
    }

    // Check if we need to evict (at capacity)
    if (this.sessions.size >= CONFIG.maxSessions) {
      this.evictLRU();
    }

    // Create workspace directories
    const workspacePath = this.getWorkspacePath(userId, conversationId);
    const sessionPath = this.getSessionPath(userId, conversationId);

    if (!existsSync(workspacePath)) {
      mkdirSync(workspacePath, { recursive: true });
    }
    if (!existsSync(sessionPath)) {
      mkdirSync(sessionPath, { recursive: true });
    }

    // Create AGENTS.md in workspace with goldilocks CLI instructions
    const agentsMdPath = resolve(workspacePath, 'AGENTS.md');
    if (!existsSync(agentsMdPath)) {
      writeFileSync(agentsMdPath, AGENTS_MD_CONTENT);
    }

    // Symlink goldilocks CLI into workspace for easy access
    const goldilocksLink = resolve(workspacePath, 'goldilocks');
    const goldilocksSource = resolve(BIN_DIR, 'goldilocks');
    if (!existsSync(goldilocksLink) && existsSync(goldilocksSource)) {
      try {
        symlinkSync(goldilocksSource, goldilocksLink);
      } catch {
        // Ignore if symlink fails
      }
    }

    // Set up auth storage with server API keys
    const authStorage = AuthStorage.create();
    if (CONFIG.anthropicApiKey) {
      authStorage.setRuntimeApiKey('anthropic', CONFIG.anthropicApiKey);
    }
    if (CONFIG.openaiApiKey) {
      authStorage.setRuntimeApiKey('openai', CONFIG.openaiApiKey);
    }
    if (CONFIG.googleApiKey) {
      authStorage.setRuntimeApiKey('google', CONFIG.googleApiKey);
    }

    const modelRegistry = ModelRegistry.create(authStorage);

    // Create resource loader
    const loader = new DefaultResourceLoader({
      cwd: workspacePath,
    });
    await loader.reload();

    // Create or continue session
    let sessionManager: SessionManager;
    try {
      sessionManager = SessionManager.continueRecent(workspacePath, sessionPath);
    } catch {
      sessionManager = SessionManager.create(workspacePath, sessionPath);
    }

    let session: AgentSession;
    try {
      const result = await createAgentSession({
        cwd: workspacePath,
        sessionManager,
        authStorage,
        modelRegistry,
        tools: createCodingTools(workspacePath),
        resourceLoader: loader,
      });
      session = result.session;
    } catch (err) {
      console.error('Failed to create agent session:', err);
      throw new Error(
        `Failed to create agent session: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
    }

    const handle: SessionHandle = { session, workspacePath, sessionPath };

    this.sessions.set(key, {
      handle,
      userId,
      conversationId,
      lastActive: Date.now(),
    });

    return handle;
  }

  touch(userId: string, conversationId: string): void {
    const key = this.getKey(userId, conversationId);
    const cached = this.sessions.get(key);
    if (cached) {
      cached.lastActive = Date.now();
    }
  }

  dispose(userId: string, conversationId: string): void {
    const key = this.getKey(userId, conversationId);
    const cached = this.sessions.get(key);
    if (cached) {
      cached.handle.session.dispose();
      this.sessions.delete(key);
    }
  }

  private evictIdle(): void {
    const now = Date.now();
    for (const [key, cached] of this.sessions) {
      if (now - cached.lastActive > CONFIG.sessionIdleTimeoutMs) {
        console.log(`Evicting idle session: ${key}`);
        cached.handle.session.dispose();
        this.sessions.delete(key);
      }
    }
  }

  private evictLRU(): void {
    let oldest: { key: string; time: number } | null = null;
    for (const [key, cached] of this.sessions) {
      if (!oldest || cached.lastActive < oldest.time) {
        oldest = { key, time: cached.lastActive };
      }
    }
    if (oldest) {
      const cached = this.sessions.get(oldest.key);
      if (cached) {
        console.log(`Evicting LRU session: ${oldest.key}`);
        cached.handle.session.dispose();
        this.sessions.delete(oldest.key);
      }
    }
  }

  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    for (const [, cached] of this.sessions) {
      cached.handle.session.dispose();
    }
    this.sessions.clear();
  }
}

const AGENTS_MD_CONTENT = `# Goldilocks Workspace

You are an agent inside the Goldilocks web application helping users generate
Quantum ESPRESSO input files for DFT calculations.

## Goldilocks CLI Commands

Use these bash commands to work with crystal structures and generate inputs:

### K-Point Prediction
\`\`\`bash
# Predict optimal k-point spacing using ML
./goldilocks predict kpoints <structure.cif> --model ALIGNN --confidence 0.95 --json

# Models: ALIGNN (more accurate), RF (faster)
# Confidence: 0.95, 0.90, 0.85
\`\`\`

### QE Input Generation
\`\`\`bash
# Generate complete SCF input file
./goldilocks generate scf <structure.cif> --functional PBEsol --pseudo efficiency --json

# Functionals: PBEsol, PBE
# Pseudo modes: efficiency, precision
\`\`\`

### Structure Search
\`\`\`bash
# Search crystal structure databases
./goldilocks search "<formula>" --database jarvis --limit 5 --json

# Databases: jarvis, mp (Materials Project), mc3d, oqmd
\`\`\`

### Structure Info
\`\`\`bash
# Analyze a structure file
./goldilocks info <structure.cif> --json
\`\`\`

## Guidelines

- When a user uploads a structure, acknowledge it and offer to predict k-points or generate an input file
- Always report confidence intervals for k-point predictions, not just the median
- If the confidence interval is wide (> 0.1 Å⁻¹), suggest running a convergence test
- For metallic systems, recommend cold smearing; for insulators, Gaussian smearing
- Explain key parameters in generated input files

## Workspace

This directory is your workspace. Users upload structure files here.
Generated input files are saved here. Files persist across messages.
`;
