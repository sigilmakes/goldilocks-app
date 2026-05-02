import { config } from 'dotenv';
import { resolve } from 'path';

config();

const defaultStateDir = resolve(process.cwd(), '.dev');
const dataDir = process.env.DATA_DIR ?? (process.env.GOLDILOCKS_STATE_DIR ? resolve(process.env.GOLDILOCKS_STATE_DIR) : defaultStateDir);

function requireEnv(name: 'JWT_SECRET' | 'ENCRYPTION_KEY' | 'AGENT_SERVICE_SHARED_SECRET'): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`FATAL: ${name} environment variable is required. Set it before starting the server.`);
  }
  return value;
}

export const CONFIG = {
  port: parseInt(process.env.PORT ?? '3000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',

  // Paths
  dataDir,
  workspaceRoot: process.env.WORKSPACE_ROOT ?? resolve(dataDir, 'workspaces'),

  // Auth
  get jwtSecret(): string {
    return requireEnv('JWT_SECRET');
  },
  jwtExpiresIn: '7d',
  get encryptionKey(): string {
    return requireEnv('ENCRYPTION_KEY');
  },

  // k8s
  k8sNamespace: process.env.K8S_NAMESPACE ?? 'goldilocks',
  agentImage: process.env.AGENT_IMAGE ?? 'goldilocks-agent:latest',
  agentIdleTimeoutMs: parseInt(process.env.AGENT_IDLE_TIMEOUT_MS ?? '1800000', 10), // 30min
  agentServiceUrl: process.env.AGENT_SERVICE_URL ?? 'http://agent-service:3001',
  agentServiceWsUrl: process.env.AGENT_SERVICE_WS_URL ?? 'ws://agent-service:3001/ws',
  get agentServiceSharedSecret(): string {
    return requireEnv('AGENT_SERVICE_SHARED_SECRET');
  },

  validateRequiredSecrets(): void {
    void this.jwtSecret;
    void this.encryptionKey;
    void this.agentServiceSharedSecret;
  },

  get isDev() {
    return this.nodeEnv === 'development';
  },

  get isProd() {
    return this.nodeEnv === 'production';
  },

  get dbPath() {
    return resolve(this.dataDir, 'goldilocks.db');
  }
} as const;
