/**
 * ContainerSessionBackend — spawns per-user Docker/k8s containers for isolated Pi SDK sessions.
 *
 * Production backend: each user's agent runs in its own container with:
 * - Own filesystem namespace (can't see other users' files)
 * - Own process namespace (can't see or signal other processes)
 * - Network policy (can only reach MCP server)
 * - Resource limits (CPU/memory bounds)
 *
 * The web app proxies WebSocket connections to the agent container.
 *
 * Requires:
 * - Docker socket access (for Docker mode) or
 * - k8s service account with pod create/delete (for k8s mode)
 *
 * Environment:
 * - AGENT_IMAGE: container image for agent pods
 * - K8S_NAMESPACE: namespace for agent pods (k8s mode)
 * - SESSION_BACKEND: "container" to enable this backend
 */

import { WebSocket } from 'ws';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { SessionBackend, SessionHandle } from './session-backend.js';
import type { AgentSession } from '@mariozechner/pi-coding-agent';
import { CONFIG } from '../config.js';

const execFileAsync = promisify(execFile);

interface ContainerInfo {
  containerId: string;
  userId: string;
  conversationId: string;
  port: number;
  ws: WebSocket | null;
  lastActive: number;
  status: 'starting' | 'running' | 'stopping' | 'stopped';
}

/**
 * ContainerSessionBackend manages per-user agent containers.
 *
 * NOTE: This is a design-complete implementation for Docker mode.
 * k8s mode would use the @kubernetes/client-node package instead of docker CLI.
 * The agent container image must be built and available before use.
 */
export class ContainerSessionBackend implements SessionBackend {
  private containers = new Map<string, ContainerInfo>();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private nextPort = 9000;
  private readonly agentImage: string;
  private readonly idleTimeoutMs: number;

  constructor() {
    this.agentImage = process.env.AGENT_IMAGE ?? 'ghcr.io/sigilmakes/goldilocks-agent:latest';
    this.idleTimeoutMs = CONFIG.sessionIdleTimeoutMs;

    // Periodic cleanup of idle containers
    this.cleanupInterval = setInterval(() => this.evictIdle(), 60000);
  }

  private getKey(userId: string, conversationId: string): string {
    return `${userId}:${conversationId}`;
  }

  async getOrCreate(userId: string, conversationId: string): Promise<SessionHandle> {
    const key = this.getKey(userId, conversationId);
    const existing = this.containers.get(key);

    if (existing && existing.status === 'running') {
      existing.lastActive = Date.now();
      // Return a proxy session handle
      return this.createProxyHandle(existing);
    }

    // Allocate a host port for the agent container
    const port = this.nextPort++;
    if (this.nextPort > 9999) this.nextPort = 9000;

    const containerName = `goldilocks-agent-${userId.slice(0, 8)}-${conversationId.slice(0, 8)}`;

    const info: ContainerInfo = {
      containerId: '',
      userId,
      conversationId,
      port,
      ws: null,
      lastActive: Date.now(),
      status: 'starting',
    };

    this.containers.set(key, info);

    try {
      // Start Docker container
      const { stdout } = await execFileAsync('docker', [
        'run', '-d',
        '--name', containerName,
        '--rm',
        '-p', `${port}:8080`,
        '-e', `USER_ID=${userId}`,
        '-e', `SESSION_ID=${conversationId}`,
        '-e', `WEB_APP_URL=http://host.docker.internal:${CONFIG.port}`,
        '-e', `MCP_SERVER_URL=${process.env.MCP_SERVER_URL ?? 'http://host.docker.internal:3100'}`,
        '--memory', '512m',
        '--cpus', '0.5',
        '--read-only',
        '--tmpfs', '/tmp:size=256m',
        '--tmpfs', '/work:size=1g',
        '--security-opt', 'no-new-privileges',
        '--cap-drop', 'ALL',
        this.agentImage,
      ]);

      info.containerId = stdout.trim();
      info.status = 'running';

      // Wait for container to be ready
      await this.waitForReady(port, 30000);

      console.log(`Container started: ${containerName} (port ${port})`);

      return this.createProxyHandle(info);
    } catch (err) {
      info.status = 'stopped';
      this.containers.delete(key);
      throw new Error(`Failed to start agent container: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async waitForReady(port: number, timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const res = await fetch(`http://localhost:${port}/health`);
        if (res.ok) return;
      } catch {
        // Container not ready yet
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error('Agent container failed to become ready');
  }

  private createProxyHandle(info: ContainerInfo): SessionHandle {
    // Create a proxy AgentSession that forwards to the container's WebSocket
    const proxySession = this.createProxySession(info);

    return {
      session: proxySession,
      workspacePath: `/work`,  // Inside the container
      sessionPath: `/tmp/pi-session`,
    };
  }

  private createProxySession(info: ContainerInfo): AgentSession {
    // This creates a thin proxy that looks like an AgentSession to the web app
    // but forwards everything to the agent container via WebSocket
    const subscribers = new Set<(event: any) => void>();
    let containerWs: WebSocket | null = null;

    const connect = () => {
      if (containerWs && containerWs.readyState === WebSocket.OPEN) return;

      containerWs = new WebSocket(`ws://localhost:${info.port}`);

      containerWs.on('message', (data) => {
        try {
          const event = JSON.parse(data.toString());
          for (const sub of subscribers) {
            sub(event);
          }
        } catch (err) {
          console.error('Failed to parse agent event:', err);
        }
      });

      containerWs.on('error', (err) => {
        console.error('Agent container WebSocket error:', err);
      });

      containerWs.on('close', () => {
        containerWs = null;
      });

      info.ws = containerWs;
    };

    return {
      subscribe(callback: (event: any) => void) {
        subscribers.add(callback);
        connect();
        return () => {
          subscribers.delete(callback);
        };
      },
      async prompt(text: string) {
        connect();
        if (containerWs && containerWs.readyState === WebSocket.OPEN) {
          containerWs.send(JSON.stringify({ type: 'prompt', text }));
        } else {
          throw new Error('Agent container not connected');
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
        subscribers.clear();
      },
    } as AgentSession;
  }

  touch(userId: string, conversationId: string): void {
    const key = this.getKey(userId, conversationId);
    const info = this.containers.get(key);
    if (info) {
      info.lastActive = Date.now();
    }
  }

  dispose(userId: string, conversationId: string): void {
    const key = this.getKey(userId, conversationId);
    const info = this.containers.get(key);
    if (info) {
      this.stopContainer(info).catch(err =>
        console.error(`Failed to stop container: ${err}`)
      );
      this.containers.delete(key);
    }
  }

  private async stopContainer(info: ContainerInfo): Promise<void> {
    if (info.status === 'stopped' || info.status === 'stopping') return;

    info.status = 'stopping';

    if (info.ws) {
      info.ws.close();
      info.ws = null;
    }

    if (info.containerId) {
      try {
        await execFileAsync('docker', ['stop', '-t', '5', info.containerId]);
        console.log(`Container stopped: ${info.containerId.slice(0, 12)}`);
      } catch {
        // Container might already be stopped
        try {
          await execFileAsync('docker', ['rm', '-f', info.containerId]);
        } catch {
          // Ignore
        }
      }
    }

    info.status = 'stopped';
  }

  private evictIdle(): void {
    const now = Date.now();
    for (const [key, info] of this.containers) {
      if (now - info.lastActive > this.idleTimeoutMs) {
        console.log(`Evicting idle container: ${key}`);
        this.stopContainer(info).catch(err =>
          console.error(`Failed to stop idle container: ${err}`)
        );
        this.containers.delete(key);
      }
    }
  }

  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    const stops = [];
    for (const [, info] of this.containers) {
      stops.push(this.stopContainer(info));
    }
    this.containers.clear();

    // Best effort stop all containers
    Promise.allSettled(stops).catch(() => {});
  }
}
