/**
 * ContainerSessionBackend — creates per-user agent pods in Kubernetes.
 *
 * This is the ONLY session backend. Every agent session runs in its own k8s pod.
 * Local dev uses `kind` (Kubernetes IN Docker). Production uses a real cluster.
 * Same code, same manifests, same behaviour.
 *
 * Uses @kubernetes/client-node (CoreV1Api) to create/delete/watch pods.
 * Kubeconfig is loaded automatically:
 *   - In-cluster: service account token (production)
 *   - Out-of-cluster: ~/.kube/config (local dev with kind)
 *
 * Each pod gets:
 *   - PVC mount for workspace persistence at /work/{userId}/{conversationId}
 *   - Read-only root filesystem, non-root user, all caps dropped
 *   - Network policy restricting egress to MCP server only
 *   - Resource limits (CPU/memory)
 *
 * WebSocket proxying:
 *   - In-cluster: direct pod IP connection
 *   - Out-of-cluster: k8s PortForward API
 */

import { WebSocket } from 'ws';
import * as k8s from '@kubernetes/client-node';
import net from 'net';
import { Writable, Readable } from 'stream';
import type { SessionBackend, SessionHandle } from './session-backend.js';
import type { AgentSession } from '@mariozechner/pi-coding-agent';
import { getCoreApi, getKubeConfig, isInCluster } from './k8s-client.js';
import { CONFIG } from '../config.js';

interface PodInfo {
  podName: string;
  userId: string;
  conversationId: string;
  podIp: string | null;
  ws: WebSocket | null;
  lastActive: number;
  status: 'starting' | 'running' | 'stopping' | 'stopped';
}

/**
 * Build a pod name from user and conversation IDs.
 * Format: agent-{userId first 8}-{conversationId first 8}
 */
function buildPodName(userId: string, conversationId: string): string {
  const u = userId.replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase();
  const c = conversationId.replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase();
  return `agent-${u}-${c}`;
}

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
          podIp: existingPod.status.podIP ?? null,
          ws: null,
          lastActive: Date.now(),
          status: 'running',
        };
        this.pods.set(key, info);
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
      podIp: null,
      ws: null,
      lastActive: Date.now(),
      status: 'starting',
    };

    this.pods.set(key, info);

    try {
      const podSpec = this.buildPodSpec(name, userId, conversationId);
      await coreApi.createNamespacedPod({ namespace: this.namespace, body: podSpec });

      // Wait for pod to be ready
      const podIp = await this.waitForPodReady(name, 60_000);
      info.podIp = podIp;
      info.status = 'running';

      console.log(`Agent pod created: ${name} (IP: ${podIp})`);
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
            securityContext: {
              allowPrivilegeEscalation: false,
              capabilities: { drop: ['ALL'] },
              readOnlyRootFilesystem: true,
            },
            env: [
              { name: 'USER_ID', value: userId },
              { name: 'SESSION_ID', value: conversationId },
              {
                name: 'WEB_APP_URL',
                value: isInCluster()
                  ? `http://web-app.${this.namespace}.svc.cluster.local:${CONFIG.port}`
                  : `http://host.docker.internal:${CONFIG.port}`,
              },
              {
                name: 'MCP_SERVER_URL',
                value: process.env.MCP_SERVER_URL
                  ?? `http://mcp-server.${this.namespace}.svc.cluster.local:3100`,
              },
            ],
            ports: [{ containerPort: 8080, name: 'agent' }],
            volumeMounts: [
              { name: 'scratch', mountPath: '/tmp' },
              { name: 'workspace', mountPath: '/work' },
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
            // In dev, use emptyDir — workspace files are transient per-pod.
            // The web app's /data/workspaces has the persistent copy.
            // In production, swap to a PVC per user.
            emptyDir: {},
          },
        ],
      },
    };
  }

  /**
   * Poll the k8s API until the pod is Running with a ready container, or timeout.
   */
  private async waitForPodReady(name: string, timeoutMs: number): Promise<string> {
    const coreApi = getCoreApi();
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      const pod = await coreApi.readNamespacedPod({ name, namespace: this.namespace });
      const phase = pod.status?.phase;
      const podIp = pod.status?.podIP;

      if (phase === 'Failed' || phase === 'Unknown') {
        throw new Error(`Pod ${name} entered ${phase} phase`);
      }

      if (phase === 'Running' && podIp) {
        const containerStatuses = pod.status?.containerStatuses ?? [];
        const agentContainer = containerStatuses.find(
          (cs: k8s.V1ContainerStatus) => cs.name === 'agent',
        );
        if (agentContainer?.ready) {
          return podIp;
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
   * Create a proxy AgentSession that forwards over WebSocket to the agent pod.
   *
   * In-cluster: direct WebSocket to pod IP
   * Out-of-cluster: uses k8s PortForward API to tunnel
   */
  private createProxySession(info: PodInfo): AgentSession {
    const subscribers = new Set<(event: unknown) => void>();
    let containerWs: WebSocket | null = null;
    let portForwardCleanup: (() => void) | null = null;

    const connect = async (): Promise<WebSocket> => {
      if (containerWs && containerWs.readyState === WebSocket.OPEN) {
        return containerWs;
      }

      let wsUrl: string;

      if (isInCluster() && info.podIp) {
        wsUrl = `ws://${info.podIp}:8080`;
      } else {
        const pf = await this.setupPortForward(info.podName);
        portForwardCleanup = pf.close;
        wsUrl = `ws://127.0.0.1:${pf.localPort}`;
      }

      return new Promise<WebSocket>((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error('WebSocket connection to agent pod timed out'));
        }, 10_000);

        ws.on('open', () => {
          clearTimeout(timeout);
          containerWs = ws;
          info.ws = ws;
          resolve(ws);
        });

        ws.on('message', (data) => {
          try {
            const event = JSON.parse(data.toString());
            for (const sub of subscribers) {
              sub(event);
            }
          } catch (err) {
            console.error('Failed to parse agent event:', err);
          }
        });

        ws.on('error', (err) => {
          clearTimeout(timeout);
          console.error(`Agent pod WebSocket error (${info.podName}):`, err.message);
          reject(err);
        });

        ws.on('close', () => {
          containerWs = null;
          info.ws = null;
        });
      });
    };

    return {
      subscribe(callback: (event: unknown) => void) {
        subscribers.add(callback);
        connect().catch(err => console.error('Agent pod connect error:', err));
        return () => {
          subscribers.delete(callback);
        };
      },
      async prompt(text: string) {
        const ws = await connect();
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'prompt', text }));
        } else {
          throw new Error('Agent pod not connected');
        }
      },
      async abort() {
        if (containerWs && containerWs.readyState === WebSocket.OPEN) {
          containerWs.send(JSON.stringify({ type: 'abort' }));
        }
      },
      dispose() {
        if (containerWs) {
          containerWs.close();
          containerWs = null;
        }
        if (portForwardCleanup) {
          portForwardCleanup();
          portForwardCleanup = null;
        }
        subscribers.clear();
      },
    } as AgentSession;
  }

  /**
   * Set up a k8s port-forward tunnel to the agent pod.
   * Returns a local port that can be used to connect via WebSocket.
   */
  private async setupPortForward(
    name: string,
  ): Promise<{ localPort: number; close: () => void }> {
    const kc = getKubeConfig();
    const forward = new k8s.PortForward(kc);

    // Allocate a free port
    const localPort = await new Promise<number>((resolve, reject) => {
      const srv = net.createServer();
      srv.listen(0, '127.0.0.1', () => {
        const addr = srv.address();
        if (addr && typeof addr === 'object') {
          const port = addr.port;
          srv.close(() => resolve(port));
        } else {
          reject(new Error('Failed to allocate port'));
        }
      });
    });

    // Create a local TCP server that tunnels to the pod via k8s API
    const server = net.createServer((socket) => {
      forward.portForward(
        this.namespace,
        name,
        [8080],
        socket as unknown as Writable,
        null,
        socket as unknown as Readable,
      ).catch((err) => {
        console.error('Port forward error:', err);
        socket.destroy();
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(localPort, '127.0.0.1', () => resolve());
    });

    return {
      localPort,
      close: () => { server.close(); },
    };
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
        console.error(`Failed to delete pod ${info.podName}: ${err}`),
      );
      this.pods.delete(key);
    }
  }

  private async deletePod(info: PodInfo): Promise<void> {
    if (info.status === 'stopped' || info.status === 'stopping') return;

    info.status = 'stopping';

    if (info.ws) {
      info.ws.close();
      info.ws = null;
    }

    try {
      const coreApi = getCoreApi();
      await coreApi.deleteNamespacedPod({
        name: info.podName,
        namespace: this.namespace,
        gracePeriodSeconds: 5,
      });
      console.log(`Agent pod deleted: ${info.podName}`);
    } catch (err: unknown) {
      if (!isK8sNotFound(err)) {
        console.error(`Failed to delete pod ${info.podName}:`, err);
      }
    }

    info.status = 'stopped';
  }

  private evictIdle(): void {
    const now = Date.now();
    for (const [key, info] of this.pods) {
      if (now - info.lastActive > this.idleTimeoutMs) {
        console.log(`Evicting idle agent pod: ${info.podName} (idle ${Math.round((now - info.lastActive) / 60_000)}min)`);
        this.deletePod(info).catch(err =>
          console.error(`Failed to evict pod ${info.podName}: ${err}`),
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

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isK8sNotFound(err: unknown): boolean {
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    // @kubernetes/client-node throws errors with different shapes depending on version:
    //   { statusCode: 404 }     — older versions
    //   { code: 404 }           — newer versions (v1.x+)
    //   { response: { statusCode: 404 } }
    if (e.statusCode === 404 || e.code === 404) return true;
    if (e.response && typeof e.response === 'object') {
      const resp = e.response as Record<string, unknown>;
      if (resp.statusCode === 404) return true;
    }
  }
  return false;
}
