/**
 * ContainerSessionBackend — creates per-user agent pods in Kubernetes,
 * communicates via JSON-RPC over stdin/stdout using `pi --mode rpc`.
 *
 * This is the ONLY session backend. Every agent session runs in its own k8s pod.
 * Local dev uses `kind` (Kubernetes IN Docker). Production uses a real cluster.
 * Same code, same manifests, same behaviour.
 *
 * Architecture:
 *   1. Pod is created with CMD ["sleep", "infinity"] to stay alive.
 *   2. On first prompt, k8s Exec runs `pi --mode rpc` inside the pod.
 *   3. JSON-RPC commands are sent as JSON lines to stdin.
 *   4. Events and responses stream back as JSON lines on stdout.
 *
 * No WebSocket proxy, no port-forward, no custom entrypoint.
 */

import { PassThrough } from 'stream';
import { StringDecoder } from 'string_decoder';
import * as k8s from '@kubernetes/client-node';
import type { SessionBackend, SessionHandle } from './session-backend.js';
import type { AgentSession, AgentSessionEvent } from '@mariozechner/pi-coding-agent';
import { getCoreApi, getKubeConfig } from './k8s-client.js';
import { CONFIG } from '../config.js';
import { getDb } from '../db.js';
import { decrypt } from '../crypto.js';
import { mkdirSync, appendFileSync } from 'fs';
import { resolve } from 'path';

// Simple file logger to data/logs/ (survives pod restarts via host bind-mount)
const logDir = resolve(CONFIG.dataDir, 'logs');
try { mkdirSync(logDir, { recursive: true }); } catch {}
function agentLog(podName: string, level: string, msg: string, data?: unknown) {
  const ts = new Date().toISOString();
  const line = data
    ? `[${ts}] [${level}] [${podName}] ${msg} ${JSON.stringify(data)}`
    : `[${ts}] [${level}] [${podName}] ${msg}`;
  console[level === 'ERROR' ? 'error' : 'log'](line);
  try {
    appendFileSync(resolve(logDir, 'agent.log'), line + '\n');
    appendFileSync(resolve(logDir, `${ts.slice(0, 10)}.log`), line + '\n');
  } catch {}
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PodInfo {
  podName: string;
  userId: string;
  conversationId: string;
  lastActive: number;
  status: 'starting' | 'running' | 'stopping' | 'stopped';
  /** The RPC connection to pi --mode rpc inside the pod. */
  rpc: RpcConnection | null;
}

interface RpcConnection {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  /** The underlying k8s exec WebSocket. */
  execWs: import('ws').WebSocket | null;
  /** Pending RPC request-response tracking. */
  pendingRequests: Map<string, { resolve: (resp: any) => void; reject: (err: Error) => void }>;
  /** Event subscribers. */
  subscribers: Set<(event: AgentSessionEvent) => void>;
  /** Stop reading JSONL from stdout. */
  stopReading: (() => void) | null;
  /** Incrementing request ID. */
  nextId: number;
  /** Whether the exec process is connected. */
  connected: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a pod name from user and conversation IDs.
 * Format: agent-{userId first 8}-{conversationId first 8}
 */
function buildPodName(userId: string, conversationId: string): string {
  const u = userId.replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase();
  const c = conversationId.replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase();
  return `agent-${u}-${c}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Env var name for each provider's API key. */
const PROVIDER_ENV_MAP: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GEMINI_API_KEY',
};

/**
 * Look up a user's encrypted API keys from the DB, decrypt them,
 * and return as env var entries for the pod spec.
 * Falls back to server-level keys from CONFIG.
 */
function getUserApiKeyEnvVars(userId: string): Array<{ name: string; value: string }> {
  const envVars: Array<{ name: string; value: string }> = [];
  const seen = new Set<string>();

  // User keys take priority
  try {
    const db = getDb();
    const rows = db.prepare(
      'SELECT provider, encrypted_key FROM api_keys WHERE user_id = ?'
    ).all(userId) as Array<{ provider: string; encrypted_key: string }>;

    for (const row of rows) {
      const envName = PROVIDER_ENV_MAP[row.provider];
      if (envName) {
        try {
          const key = decrypt(row.encrypted_key);
          if (key) {
            envVars.push({ name: envName, value: key });
            seen.add(envName);
          }
        } catch (err) {
          console.error(`Failed to decrypt ${row.provider} key for user ${userId}:`, err);
        }
      }
    }
  } catch (err) {
    console.error('Failed to query user API keys:', err);
  }

  // Fall back to server-level keys for any not set by user
  if (!seen.has('ANTHROPIC_API_KEY') && CONFIG.anthropicApiKey) {
    envVars.push({ name: 'ANTHROPIC_API_KEY', value: CONFIG.anthropicApiKey });
  }
  if (!seen.has('OPENAI_API_KEY') && CONFIG.openaiApiKey) {
    envVars.push({ name: 'OPENAI_API_KEY', value: CONFIG.openaiApiKey });
  }
  if (!seen.has('GEMINI_API_KEY') && CONFIG.googleApiKey) {
    envVars.push({ name: 'GEMINI_API_KEY', value: CONFIG.googleApiKey });
  }

  return envVars;
}

function isK8sNotFound(err: unknown): boolean {
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    if (e.statusCode === 404 || e.code === 404) return true;
    if (e.response && typeof e.response === 'object') {
      const resp = e.response as Record<string, unknown>;
      if (resp.statusCode === 404) return true;
    }
    // HttpError from @kubernetes/client-node wraps the response body
    if (e.body && typeof e.body === 'object') {
      const body = e.body as Record<string, unknown>;
      if (body.code === 404) return true;
    }
  }
  return false;
}

/**
 * Serialize a value as a single JSON line (same framing as Pi SDK's JSONL).
 */
function serializeJsonLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

/**
 * Attach a JSONL line reader to a stream.
 * Splits on LF only (strict JSONL framing, matches Pi SDK).
 */
function attachJsonlReader(
  stream: NodeJS.ReadableStream,
  onLine: (line: string) => void,
): () => void {
  const decoder = new StringDecoder('utf8');
  let buffer = '';

  const emitLine = (line: string) => {
    onLine(line.endsWith('\r') ? line.slice(0, -1) : line);
  };

  const onData = (chunk: Buffer | string) => {
    buffer += typeof chunk === 'string' ? chunk : decoder.write(chunk);
    while (true) {
      const idx = buffer.indexOf('\n');
      if (idx === -1) break;
      emitLine(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 1);
    }
  };

  const onEnd = () => {
    buffer += decoder.end();
    if (buffer.length > 0) {
      emitLine(buffer);
      buffer = '';
    }
  };

  stream.on('data', onData);
  stream.on('end', onEnd);

  return () => {
    stream.removeListener('data', onData);
    stream.removeListener('end', onEnd);
  };
}

// ---------------------------------------------------------------------------
// ContainerSessionBackend
// ---------------------------------------------------------------------------

export class ContainerSessionBackend implements SessionBackend {
  private pods = new Map<string, PodInfo>();
  private idleCheckInterval: NodeJS.Timeout | null = null;
  private readonly namespace: string;
  private readonly agentImage: string;
  private readonly idleTimeoutMs: number;

  constructor() {
    this.namespace = CONFIG.k8sNamespace;
    this.agentImage = CONFIG.agentImage;
    this.idleTimeoutMs = CONFIG.agentIdleTimeoutMs;

    // Periodic idle check every 60 seconds
    this.idleCheckInterval = setInterval(() => this.evictIdle(), 60_000);
  }

  private getKey(userId: string, conversationId: string): string {
    return `${userId}:${conversationId}`;
  }

  async getOrCreate(userId: string, conversationId: string): Promise<SessionHandle> {
    const key = this.getKey(userId, conversationId);
    const existing = this.pods.get(key);

    if (existing && existing.status === 'running') {
      existing.lastActive = Date.now();
      // Ensure RPC connection is established
      if (!existing.rpc || !existing.rpc.connected) {
        await this.connectRpc(existing);
      }
      return this.createProxyHandle(existing);
    }

    const name = buildPodName(userId, conversationId);
    const coreApi = getCoreApi();

    // Check if pod already exists in k8s (e.g. after server restart)
    try {
      const existingPod = await coreApi.readNamespacedPod({ name, namespace: this.namespace });

      if (existingPod.status?.phase === 'Running') {
        const info: PodInfo = {
          podName: name,
          userId,
          conversationId,
          lastActive: Date.now(),
          status: 'running',
          rpc: null,
        };
        this.pods.set(key, info);
        await this.connectRpc(info);
        return this.createProxyHandle(info);
      }

      // Pod exists but not running — delete and recreate
      if (existingPod.status?.phase !== 'Pending') {
        await coreApi.deleteNamespacedPod({ name, namespace: this.namespace }).catch(() => {});
      }
    } catch (err: unknown) {
      if (!isK8sNotFound(err)) {
        throw err;
      }
    }

    // Create new agent pod
    const info: PodInfo = {
      podName: name,
      userId,
      conversationId,
      lastActive: Date.now(),
      status: 'starting',
      rpc: null,
    };

    this.pods.set(key, info);

    try {
      const podSpec = this.buildPodSpec(name, userId, conversationId);
      await coreApi.createNamespacedPod({ namespace: this.namespace, body: podSpec });

      // Wait for pod to be ready
      await this.waitForPodReady(name, 60_000);
      info.status = 'running';

      agentLog(name, 'INFO', 'Pod created');

      // Establish RPC connection via k8s exec
      await this.connectRpc(info);

      return this.createProxyHandle(info);
    } catch (err) {
      info.status = 'stopped';
      this.pods.delete(key);
      await coreApi.deleteNamespacedPod({ name, namespace: this.namespace }).catch(() => {});
      throw new Error(
        `Failed to create agent pod ${name}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Establish an RPC connection to the agent pod via k8s exec.
   * Runs `pi --mode rpc` inside the pod and sets up stdin/stdout streams.
   */
  private async connectRpc(info: PodInfo): Promise<void> {
    // Clean up any existing connection
    if (info.rpc) {
      this.disconnectRpc(info);
    }

    const kc = getKubeConfig();
    const exec = new k8s.Exec(kc);

    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();

    const rpc: RpcConnection = {
      stdin,
      stdout,
      stderr,
      execWs: null,
      pendingRequests: new Map(),
      subscribers: new Set(),
      stopReading: null,
      nextId: 0,
      connected: false,
    };

    // Log stderr from agent pod line-by-line (useful for debugging)
    stderr.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n').filter(Boolean)) {
        agentLog(info.podName, 'INFO', 'stderr: ' + line);
      }
    });

    // Set up JSONL reader on stdout to dispatch events and responses
    rpc.stopReading = attachJsonlReader(stdout, (line: string) => {
      try {
        const data = JSON.parse(line);

        // Check if it's a response to a pending RPC request
        if (data.type === 'response' && data.id && rpc.pendingRequests.has(data.id)) {
          const pending = rpc.pendingRequests.get(data.id)!;
          rpc.pendingRequests.delete(data.id);
          pending.resolve(data);
          return;
        }

        // Otherwise it's an AgentSessionEvent — dispatch to subscribers
        for (const sub of rpc.subscribers) {
          try {
            sub(data as AgentSessionEvent);
          } catch (err) {
            agentLog(info.podName, 'ERROR', 'Subscriber error', err);
          }
        }
      } catch {
        // Ignore non-JSON lines (e.g. startup messages)
      }
    });

    try {
      // Execute `pi --mode rpc` inside the running pod
      const execWs = await exec.exec(
        this.namespace,
        info.podName,
        'agent',
        ['pi', '--mode', 'rpc'],
        stdout,  // stdout from the process
        stderr,  // stderr from the process
        stdin,   // stdin to the process
        false,   // tty = false (we want raw streams, not a terminal)
        (status) => {
          agentLog(info.podName, 'INFO', 'exec exited', status);
          rpc.connected = false;
          // Reject any pending requests
          for (const [id, pending] of rpc.pendingRequests) {
            pending.reject(new Error('Agent process exited'));
          }
          rpc.pendingRequests.clear();
        },
      );

      rpc.execWs = execWs;
      rpc.connected = true;
      info.rpc = rpc;

      // Give the agent process a moment to initialize
      await sleep(500);

      agentLog(info.podName, 'INFO', 'RPC connection established');
    } catch (err: unknown) {
      // k8s Exec errors are often ErrorEvent objects with the real error in Symbol(kError)
      const message = err instanceof Error
        ? err.message
        : (err as any)?.message ?? JSON.stringify(err);
      agentLog(info.podName, 'ERROR', 'exec failed: ' + message);
      rpc.stopReading?.();
      stdin.destroy();
      stdout.destroy();
      stderr.destroy();
      throw new Error(
        `Failed to exec into pod ${info.podName}: ${err instanceof Error ? err.message : JSON.stringify(err)}`,
      );
    }
  }

  /**
   * Disconnect the RPC connection to a pod.
   */
  private disconnectRpc(info: PodInfo): void {
    if (!info.rpc) return;

    const rpc = info.rpc;
    rpc.connected = false;
    rpc.stopReading?.();

    // Reject pending requests
    for (const [, pending] of rpc.pendingRequests) {
      pending.reject(new Error('RPC connection closed'));
    }
    rpc.pendingRequests.clear();
    rpc.subscribers.clear();

    // Close streams
    rpc.stdin.end();
    rpc.stdout.destroy();
    rpc.stderr.destroy();

    // Close exec WebSocket
    if (rpc.execWs) {
      try {
        rpc.execWs.close();
      } catch {
        // ignore
      }
    }

    info.rpc = null;
  }

  /**
   * Send an RPC command and wait for the response.
   */
  private sendRpcCommand(rpc: RpcConnection, command: Record<string, unknown>): Promise<any> {
    if (!rpc.connected) {
      return Promise.reject(new Error('RPC not connected'));
    }

    const id = `req_${++rpc.nextId}`;
    const fullCommand = { ...command, id };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        rpc.pendingRequests.delete(id);
        reject(new Error(`Timeout waiting for response to ${command.type}`));
      }, 30_000);

      rpc.pendingRequests.set(id, {
        resolve: (response: any) => {
          clearTimeout(timeout);
          resolve(response);
        },
        reject: (error: Error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });

      rpc.stdin.write(serializeJsonLine(fullCommand));
    });
  }

  private buildPodSpec(name: string, userId: string, conversationId: string): k8s.V1Pod {
    return {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: {
        name,
        namespace: this.namespace,
        labels: {
          app: 'goldilocks-agent',
          role: 'agent',
          'goldilocks/user': userId.slice(0, 63),
          'goldilocks/conversation': conversationId.slice(0, 63),
        },
      },
      spec: {
        restartPolicy: 'Never',
        automountServiceAccountToken: false,
        securityContext: {
          runAsNonRoot: true,
          runAsUser: 1000,
          runAsGroup: 1000,
          fsGroup: 1000,
        },
        containers: [
          {
            name: 'agent',
            image: this.agentImage,
            imagePullPolicy: 'Never',
            // Override CMD to keep the pod alive.
            // The actual `pi --mode rpc` process is started via k8s exec.
            command: ['sleep', 'infinity'],
            securityContext: {
              allowPrivilegeEscalation: false,
              capabilities: { drop: ['ALL'] },
              readOnlyRootFilesystem: true,
            },
            env: [
              { name: 'USER_ID', value: userId },
              { name: 'SESSION_ID', value: conversationId },
              // User API keys from DB (decrypted), with server-level fallback
              ...getUserApiKeyEnvVars(userId),
            ],
            volumeMounts: [
              { name: 'scratch', mountPath: '/tmp' },
              { name: 'workspace', mountPath: '/work' },
              { name: 'pi-config', mountPath: '/home/node/.pi' },
            ],
            resources: {
              requests: { cpu: '250m', memory: '256Mi' },
              limits: { cpu: '500m', memory: '512Mi' },
            },
          },
        ],
        volumes: [
          {
            name: 'scratch',
            emptyDir: { medium: 'Memory', sizeLimit: '256Mi' },
          },
          {
            name: 'workspace',
            emptyDir: {},
          },
          {
            name: 'pi-config',
            // Pi SDK writes config/sessions/settings to ~/.pi/agent/
            emptyDir: {},
          },
        ],
      },
    };
  }

  /**
   * Poll the k8s API until the pod is Running with a ready container, or timeout.
   */
  private async waitForPodReady(name: string, timeoutMs: number): Promise<void> {
    const coreApi = getCoreApi();
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      const pod = await coreApi.readNamespacedPod({ name, namespace: this.namespace });
      const phase = pod.status?.phase;

      if (phase === 'Failed' || phase === 'Unknown') {
        throw new Error(`Pod ${name} entered ${phase} phase`);
      }

      if (phase === 'Running') {
        const containerStatuses = pod.status?.containerStatuses ?? [];
        const agentContainer = containerStatuses.find(
          (cs: k8s.V1ContainerStatus) => cs.name === 'agent',
        );
        if (agentContainer?.ready) {
          return;
        }
      }

      await sleep(1000);
    }

    throw new Error(`Pod ${name} failed to become ready within ${timeoutMs / 1000}s`);
  }

  private createProxyHandle(info: PodInfo): SessionHandle {
    const proxySession = this.createProxySession(info);
    return {
      session: proxySession,
      workspacePath: '/work',
      sessionPath: '/tmp/pi-session',
    };
  }

  /**
   * Create a proxy AgentSession that translates .prompt()/.abort()/.subscribe()
   * into JSON-RPC commands over the k8s exec stdin/stdout connection.
   *
   * IMPORTANT: The RPC mode returns the prompt response immediately and streams
   * events asynchronously. The proxy's prompt() must wait for the agent_end event
   * to match the Pi SDK's AgentSession.prompt() contract (resolves when done).
   */
  private createProxySession(info: PodInfo): AgentSession {
    const self = this;

    return {
      subscribe(callback: (event: AgentSessionEvent) => void) {
        if (info.rpc) {
          info.rpc.subscribers.add(callback);
        }
        return () => {
          if (info.rpc) {
            info.rpc.subscribers.delete(callback);
          }
        };
      },

      async prompt(text: string) {
        if (!info.rpc || !info.rpc.connected) {
          throw new Error('Agent pod not connected');
        }

        const rpc = info.rpc;

        // Register agent_end listener BEFORE sending the command to avoid a
        // race where a fast-completing prompt fires agent_end before we listen.
        const agentDone = new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            cleanup();
            reject(new Error('Prompt timed out waiting for agent_end'));
          }, 5 * 60 * 1000); // 5 minute timeout

          const listener = (event: AgentSessionEvent) => {
            if (event.type === 'agent_end') {
              cleanup();
              resolve();
            }
          };

          const cleanup = () => {
            clearTimeout(timeout);
            rpc.subscribers.delete(listener);
          };

          rpc.subscribers.add(listener);
        });

        // Send the prompt command — RPC responds immediately
        const response = await self.sendRpcCommand(rpc, {
          type: 'prompt',
          message: text,
        });
        if (response && !response.success) {
          throw new Error(response.error || 'Prompt failed');
        }

        // Wait for agent_end event, which signals the prompt is fully complete.
        // Events are streamed to subscribers during this wait.
        await agentDone;
      },

      async abort() {
        if (!info.rpc || !info.rpc.connected) return;
        try {
          await self.sendRpcCommand(info.rpc, { type: 'abort' });
        } catch {
          // Best-effort abort
        }
      },

      dispose() {
        self.disconnectRpc(info);
      },
    } as AgentSession;
  }

  touch(userId: string, conversationId: string): void {
    const key = this.getKey(userId, conversationId);
    const info = this.pods.get(key);
    if (info) {
      info.lastActive = Date.now();
    }
  }

  dispose(userId: string, conversationId: string): void {
    const key = this.getKey(userId, conversationId);
    const info = this.pods.get(key);
    if (info) {
      this.deletePod(info).catch(err =>
        agentLog(info.podName, 'ERROR', 'Failed to delete', err),
      );
      this.pods.delete(key);
    }
  }

  private async deletePod(info: PodInfo): Promise<void> {
    if (info.status === 'stopped' || info.status === 'stopping') return;

    info.status = 'stopping';

    // Disconnect RPC first
    this.disconnectRpc(info);

    try {
      const coreApi = getCoreApi();
      await coreApi.deleteNamespacedPod({
        name: info.podName,
        namespace: this.namespace,
        gracePeriodSeconds: 5,
      });
      agentLog(info.podName, 'INFO', 'Pod deleted');
    } catch (err: unknown) {
      if (!isK8sNotFound(err)) {
        agentLog(info.podName, 'ERROR', 'Failed to delete pod', err);
      }
    }

    info.status = 'stopped';
  }

  private evictIdle(): void {
    const now = Date.now();
    for (const [key, info] of this.pods) {
      if (now - info.lastActive > this.idleTimeoutMs) {
        agentLog(info.podName, 'INFO', `Evicting idle pod (idle ${Math.round((now - info.lastActive) / 60_000)}min)`);
        this.deletePod(info).catch(err =>
          agentLog(info.podName, 'ERROR', 'Failed to evict', err),
        );
        this.pods.delete(key);
      }
    }
  }

  shutdown(): void {
    if (this.idleCheckInterval) {
      clearInterval(this.idleCheckInterval);
      this.idleCheckInterval = null;
    }

    const deletes: Promise<void>[] = [];
    for (const [, info] of this.pods) {
      deletes.push(this.deletePod(info));
    }
    this.pods.clear();

    Promise.allSettled(deletes).catch(() => {});
  }
}
