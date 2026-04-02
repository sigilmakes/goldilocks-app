/**
 * Pod Manager — k8s API calls for per-user agent pods and PVCs.
 *
 * Responsibilities:
 *   - Create/delete pods (one per user, long-lived)
 *   - Create PVCs (one per user, 5GB, user's home directory)
 *   - Exec into pods (returns stdin/stdout/stderr streams)
 *   - Track pod status and idle timeouts
 *   - Structured logging of all lifecycle events
 *
 * Knows NOTHING about pi, RPC, conversations, or the frontend.
 * Just provisions and manages k8s infrastructure.
 */

import { PassThrough } from 'stream';
import * as k8s from '@kubernetes/client-node';
import { getCoreApi, getKubeConfig } from './k8s-client.js';
import { CONFIG } from '../config.js';
import { getDb } from '../db.js';
import { decrypt } from '../crypto.js';
import { appendFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExecStreams {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  /** Close the exec connection. */
  close: () => void;
}

export type PodStatus = 'none' | 'pending' | 'running' | 'failed';

interface PodRecord {
  podName: string;
  userId: string;
  status: PodStatus;
  lastActive: number;
  consecutiveFailures: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NAMESPACE = CONFIG.k8sNamespace;
const AGENT_IMAGE = CONFIG.agentImage;
const HOMES_HOST_PATH = '/data/goldilocks/homes';
const POD_READY_TIMEOUT_MS = 120_000;
const IDLE_TIMEOUT_MS = CONFIG.agentIdleTimeoutMs;

/** Env var name for each provider's API key. */
const PROVIDER_ENV_MAP: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GEMINI_API_KEY',
};

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

const logDir = resolve(CONFIG.dataDir, 'logs');
try { mkdirSync(logDir, { recursive: true }); } catch { /* exists */ }
const logFile = resolve(logDir, 'pod-manager.log');

function log(level: string, msg: string, data?: unknown): void {
  const ts = new Date().toISOString();
  const line = data
    ? `[${ts}] [${level}] [pod-manager] ${msg} ${JSON.stringify(data)}`
    : `[${ts}] [${level}] [pod-manager] ${msg}`;
  if (level === 'ERROR') console.error(line);
  else console.log(line);
  try { appendFileSync(logFile, line + '\n'); } catch { /* best effort */ }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function podName(userId: string): string {
  const sanitized = userId.replace(/[^a-z0-9]/gi, '').slice(0, 16).toLowerCase();
  return `agent-${sanitized}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isK8sNotFound(err: unknown): boolean {
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    if (e.statusCode === 404 || e.code === 404) return true;
    if (e.response && typeof e.response === 'object') {
      const resp = e.response as Record<string, unknown>;
      if (resp.statusCode === 404) return true;
    }
    if (e.body && typeof e.body === 'object') {
      const body = e.body as Record<string, unknown>;
      if (body.code === 404) return true;
    }
  }
  return false;
}

/**
 * Look up a user's encrypted API keys from the DB, decrypt them,
 * and return as env var entries for the pod spec.
 */
function getUserApiKeyEnvVars(userId: string): Array<{ name: string; value: string }> {
  const envVars: Array<{ name: string; value: string }> = [];
  const seen = new Set<string>();

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
          log('ERROR', `Failed to decrypt ${row.provider} key for user ${userId}`, err);
        }
      }
    }
  } catch (err) {
    log('ERROR', 'Failed to query user API keys', err);
  }

  return envVars;
}

// ---------------------------------------------------------------------------
// PodManager
// ---------------------------------------------------------------------------

export class PodManager {
  private pods = new Map<string, PodRecord>();
  private ensuring = new Map<string, Promise<string>>();
  private idleTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Check for idle pods every 60s
    this.idleTimer = setInterval(() => this.evictIdle(), 60_000);
  }

  /**
   * Ensure a pod exists and is running for this user.
   * Creates PVC and pod if they don't exist.
   * Returns the pod name.
   */
  async ensurePod(userId: string): Promise<string> {
    const name = podName(userId);
    const record = this.pods.get(userId);

    // If we have a running record, verify the pod still exists in k8s
    if (record?.status === 'running') {
      try {
        const coreApi = getCoreApi();
        const pod = await coreApi.readNamespacedPod({ name, namespace: NAMESPACE });
        if (pod.status?.phase === 'Running') {
          record.lastActive = Date.now();
          return name;
        }
        // Pod exists but not running — clear the record and recreate
        log('WARN', `Pod ${name} recorded as running but is ${pod.status?.phase}, recreating`);
        this.pods.delete(userId);
      } catch (err) {
        if (isK8sNotFound(err)) {
          log('WARN', `Pod ${name} recorded as running but not found in k8s, recreating`);
          this.pods.delete(userId);
        } else {
          throw err;
        }
      }
    }

    // Dedup concurrent calls for the same user
    const inflight = this.ensuring.get(userId);
    if (inflight) return inflight;

    const promise = this._ensurePod(userId);
    this.ensuring.set(userId, promise);
    try {
      return await promise;
    } finally {
      this.ensuring.delete(userId);
    }
  }

  private async _ensurePod(userId: string): Promise<string> {
    const name = podName(userId);
    const record = this.pods.get(userId);

    // Check backoff for repeated failures
    if (record?.consecutiveFailures && record.consecutiveFailures >= 3) {
      throw new Error(
        'Pod creation failed repeatedly. Please check your API keys and try again, or contact an administrator.'
      );
    }

    const coreApi = getCoreApi();

    // Check if pod already exists in k8s
    try {
      const existing = await coreApi.readNamespacedPod({ name, namespace: NAMESPACE });
      const phase = existing.status?.phase;

      if (phase === 'Running') {
        const containerReady = existing.status?.containerStatuses?.some(
          (cs: k8s.V1ContainerStatus) => cs.name === 'agent' && cs.ready
        );
        if (containerReady) {
          this.pods.set(userId, {
            podName: name, userId, status: 'running',
            lastActive: Date.now(), consecutiveFailures: 0,
          });
          log('INFO', `Found existing running pod: ${name}`);
          return name;
        }
      }

      if (phase === 'Failed' || phase === 'Unknown') {
        log('WARN', `Pod ${name} in ${phase} state, deleting and recreating`);
        await coreApi.deleteNamespacedPod({ name, namespace: NAMESPACE }).catch(() => {});
        await sleep(2000);
      } else if (phase === 'Pending') {
        // Wait for it to become ready
        log('INFO', `Pod ${name} pending, waiting...`);
        await this.waitForPodReady(name);
        this.pods.set(userId, {
          podName: name, userId, status: 'running',
          lastActive: Date.now(), consecutiveFailures: 0,
        });
        return name;
      }
    } catch (err) {
      if (!isK8sNotFound(err)) throw err;
    }



    // Create pod
    log('INFO', `Creating pod: ${name}`);
    const newRecord: PodRecord = {
      podName: name, userId, status: 'pending',
      lastActive: Date.now(),
      consecutiveFailures: record?.consecutiveFailures ?? 0,
    };
    this.pods.set(userId, newRecord);

    try {
      const spec = this.buildPodSpec(name, userId);
      await coreApi.createNamespacedPod({ namespace: NAMESPACE, body: spec });
      await this.waitForPodReady(name);
      newRecord.status = 'running';
      newRecord.consecutiveFailures = 0;
      log('INFO', `Pod ready: ${name}`);
      return name;
    } catch (err) {
      newRecord.status = 'failed';
      newRecord.consecutiveFailures++;
      // Apply backoff delay
      const backoffMs = newRecord.consecutiveFailures === 1 ? 0
        : newRecord.consecutiveFailures === 2 ? 5_000 : 30_000;
      if (backoffMs > 0) {
        log('WARN', `Pod ${name} failed (attempt ${newRecord.consecutiveFailures}), backoff ${backoffMs}ms`);
      }

      // Clean up the failed pod
      await coreApi.deleteNamespacedPod({ name, namespace: NAMESPACE }).catch(() => {});

      throw new Error(
        `Failed to create pod ${name}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }



  /**
   * Exec a command in a user's pod.
   * Returns stdin/stdout/stderr streams.
   */
  async execInPod(userId: string, command: string[]): Promise<ExecStreams> {
    const name = podName(userId);
    const kc = getKubeConfig();
    const exec = new k8s.Exec(kc);

    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();

    log('INFO', `Exec in pod ${name}: ${command.join(' ')}`);

    let execWs: import('ws').WebSocket | null = null;

    try {
      execWs = await exec.exec(
        NAMESPACE, name, 'agent',
        command,
        stdout, stderr, stdin,
        false, // tty = false
        (status) => {
          log('INFO', `Exec exited in pod ${name}`, status);
        },
      );
    } catch (err) {
      // k8s Exec errors are often ErrorEvent or plain objects — extract message robustly
      let msg: string;
      if (err instanceof Error) {
        msg = err.message;
      } else if (err && typeof err === 'object') {
        const e = err as Record<string, unknown>;
        msg = (e.message as string) ?? (e.error as string) ?? JSON.stringify(err);
      } else {
        msg = String(err);
      }
      log('ERROR', `Exec failed in pod ${name}: ${msg}`);
      stdin.destroy();
      stdout.destroy();
      stderr.destroy();
      throw new Error(`Exec failed in pod ${name}: ${msg}`);
    }

    return {
      stdin, stdout, stderr,
      close: () => {
        stdin.end();
        stdout.destroy();
        stderr.destroy();
        if (execWs) {
          try { execWs.close(); } catch { /* ignore */ }
        }
      },
    };
  }

  /**
   * Delete a user's pod (PVC is preserved).
   */
  async deletePod(userId: string): Promise<void> {
    const name = podName(userId);
    const coreApi = getCoreApi();

    log('INFO', `Deleting pod: ${name}`);

    try {
      await coreApi.deleteNamespacedPod({
        name, namespace: NAMESPACE,
        gracePeriodSeconds: 5,
      });
      log('INFO', `Pod deleted: ${name}`);
    } catch (err) {
      if (!isK8sNotFound(err)) {
        log('ERROR', `Failed to delete pod ${name}`, err);
      }
    }

    this.pods.delete(userId);
  }

  /**
   * Get the status of a user's pod.
   */
  async getPodStatus(userId: string): Promise<PodStatus> {
    const name = podName(userId);
    const coreApi = getCoreApi();

    try {
      const pod = await coreApi.readNamespacedPod({ name, namespace: NAMESPACE });
      const phase = pod.status?.phase;
      if (phase === 'Running') return 'running';
      if (phase === 'Pending') return 'pending';
      return 'failed';
    } catch (err) {
      if (isK8sNotFound(err)) return 'none';
      throw err;
    }
  }

  /**
   * Touch a user's pod (reset idle timeout).
   */
  touch(userId: string): void {
    const record = this.pods.get(userId);
    if (record) {
      record.lastActive = Date.now();
    }
  }

  /**
   * Reset the failure counter for a user (e.g., after they fix their API key).
   */
  resetFailures(userId: string): void {
    const record = this.pods.get(userId);
    if (record) {
      record.consecutiveFailures = 0;
    }
  }

  /**
   * Shut down all pods and stop the idle timer.
   */
  async shutdown(): Promise<void> {
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }

    const deletes = Array.from(this.pods.keys()).map((userId) =>
      this.deletePod(userId).catch((err) =>
        log('ERROR', `Shutdown delete failed for ${userId}`, err)
      )
    );
    await Promise.allSettled(deletes);
    this.pods.clear();
    log('INFO', 'PodManager shutdown complete');
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private buildPodSpec(name: string, userId: string): k8s.V1Pod {
    return {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: {
        name,
        namespace: NAMESPACE,
        labels: {
          app: 'goldilocks-agent',
          role: 'agent',
          'goldilocks/user': userId.slice(0, 63),
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
            image: AGENT_IMAGE,
            imagePullPolicy: 'Never',
            command: ['sleep', 'infinity'],
            securityContext: {
              allowPrivilegeEscalation: false,
              capabilities: { drop: ['ALL'] },
            },
            env: [
              { name: 'USER_ID', value: userId },
              { name: 'HOME', value: '/home/node' },
              ...getUserApiKeyEnvVars(userId),
            ],
            volumeMounts: [
              { name: 'home', mountPath: '/home/node' },
              { name: 'tmp', mountPath: '/tmp' },
            ],
            resources: {
              requests: { cpu: '250m', memory: '256Mi' },
              limits: { cpu: '1', memory: '512Mi' },
            },
          },
        ],
        volumes: [
          {
            name: 'home',
            hostPath: {
              path: `${HOMES_HOST_PATH}/${userId}`,
              type: 'DirectoryOrCreate',
            },
          },
          {
            name: 'tmp',
            emptyDir: { sizeLimit: '256Mi' },
          },
        ],
      },
    };
  }

  private async waitForPodReady(name: string): Promise<void> {
    const coreApi = getCoreApi();
    const start = Date.now();

    while (Date.now() - start < POD_READY_TIMEOUT_MS) {
      try {
        const pod = await coreApi.readNamespacedPod({ name, namespace: NAMESPACE });
        const phase = pod.status?.phase;

        if (phase === 'Failed' || phase === 'Unknown') {
          throw new Error(`Pod ${name} entered ${phase} phase`);
        }

        if (phase === 'Running') {
          const ready = pod.status?.containerStatuses?.some(
            (cs: k8s.V1ContainerStatus) => cs.name === 'agent' && cs.ready
          );
          if (ready) return;
        }
      } catch (err) {
        if (!isK8sNotFound(err)) throw err;
      }

      await sleep(1000);
    }

    throw new Error(`Pod ${name} not ready within ${POD_READY_TIMEOUT_MS / 1000}s`);
  }

  private evictIdle(): void {
    const now = Date.now();
    for (const [userId, record] of this.pods) {
      if (record.status === 'running' && now - record.lastActive > IDLE_TIMEOUT_MS) {
        log('INFO', `Evicting idle pod: ${record.podName} (idle ${Math.round((now - record.lastActive) / 60_000)}min)`);
        this.deletePod(userId).catch((err) =>
          log('ERROR', `Failed to evict ${record.podName}`, err)
        );
      }
    }
  }
}
