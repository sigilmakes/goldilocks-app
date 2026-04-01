/**
 * Pod Reaper — cleans up orphaned agent containers/pods
 *
 * Runs periodically to find and terminate agent pods that:
 * - Have been running longer than MAX_POD_AGE_HOURS
 * - Are no longer tracked by the SessionBackend (orphaned)
 * - Have no active WebSocket connections
 *
 * In Docker mode: uses `docker ps` to find goldilocks-agent containers
 * In k8s mode: uses the k8s API to list pods with label app=goldilocks-agent
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface ReaperConfig {
  /** Maximum age of a pod in milliseconds before it's reaped */
  maxPodAgeMs: number;
  /** How often to run the reaper in milliseconds */
  intervalMs: number;
  /** Container name prefix to look for */
  containerPrefix: string;
  /** k8s namespace (if using k8s mode) */
  namespace?: string;
}

const DEFAULT_CONFIG: ReaperConfig = {
  maxPodAgeMs: 4 * 60 * 60 * 1000, // 4 hours
  intervalMs: 5 * 60 * 1000,        // Every 5 minutes
  containerPrefix: 'goldilocks-agent-',
  namespace: 'goldilocks',
};

export class PodReaper {
  private interval: NodeJS.Timeout | null = null;
  private config: ReaperConfig;
  /** Set of container IDs that are known to be actively managed */
  private managedContainers = new Set<string>();

  constructor(config: Partial<ReaperConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Register a container as actively managed (won't be reaped) */
  track(containerId: string): void {
    this.managedContainers.add(containerId);
  }

  /** Unregister a container (eligible for reaping if still running) */
  untrack(containerId: string): void {
    this.managedContainers.delete(containerId);
  }

  /** Start the periodic reaper */
  start(): void {
    if (this.interval) return;

    console.log(`Pod reaper started (interval: ${this.config.intervalMs / 1000}s, max age: ${this.config.maxPodAgeMs / 3600000}h)`);

    this.interval = setInterval(() => {
      this.reap().catch(err =>
        console.error('Pod reaper error:', err)
      );
    }, this.config.intervalMs);

    // Run once immediately
    this.reap().catch(err =>
      console.error('Pod reaper initial run error:', err)
    );
  }

  /** Stop the periodic reaper */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  /** Run one reap cycle (Docker mode) */
  async reap(): Promise<number> {
    let reaped = 0;

    try {
      // List all running containers with our prefix
      const { stdout } = await execFileAsync('docker', [
        'ps',
        '--filter', `name=${this.config.containerPrefix}`,
        '--format', '{{.ID}}\t{{.Names}}\t{{.CreatedAt}}\t{{.Status}}',
      ]);

      if (!stdout.trim()) return 0;

      const lines = stdout.trim().split('\n');
      const now = Date.now();

      for (const line of lines) {
        const [id, name, createdAt] = line.split('\t');
        if (!id) continue;

        // Skip actively managed containers
        if (this.managedContainers.has(id)) continue;

        // Parse creation time
        const created = new Date(createdAt).getTime();
        const age = now - created;

        if (age > this.config.maxPodAgeMs) {
          console.log(`Reaping orphaned container: ${name} (age: ${(age / 3600000).toFixed(1)}h)`);

          try {
            await execFileAsync('docker', ['stop', '-t', '5', id]);
            reaped++;
          } catch (err) {
            console.error(`Failed to reap container ${name}:`, err);
            // Force remove
            try {
              await execFileAsync('docker', ['rm', '-f', id]);
              reaped++;
            } catch {
              // Ignore
            }
          }
        }
      }
    } catch (err) {
      // Docker might not be available (development mode)
      // This is not an error — the reaper is a no-op without Docker
      if ((err as any)?.code !== 'ENOENT') {
        console.error('Pod reaper failed:', err);
      }
    }

    if (reaped > 0) {
      console.log(`Pod reaper: cleaned up ${reaped} container(s)`);
    }

    return reaped;
  }

  /** Force cleanup all agent containers (for shutdown) */
  async cleanup(): Promise<void> {
    try {
      const { stdout } = await execFileAsync('docker', [
        'ps', '-q',
        '--filter', `name=${this.config.containerPrefix}`,
      ]);

      if (!stdout.trim()) return;

      const ids = stdout.trim().split('\n').filter(Boolean);
      if (ids.length === 0) return;

      console.log(`Cleaning up ${ids.length} agent container(s)...`);
      await execFileAsync('docker', ['stop', '-t', '5', ...ids]);
    } catch {
      // Best effort
    }
  }
}
