import { homedir } from 'os';
import { config } from 'dotenv';
import { resolve } from 'path';

config();

const defaultStateDir = resolve(process.env.GOLDILOCKS_STATE_DIR ?? homedir(), '.local', 'share', 'goldilocks');
const dataDir = process.env.DATA_DIR ?? defaultStateDir;

export const CONFIG = {
  port: parseInt(process.env.PORT ?? '3000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  
  // Paths
  dataDir,
  workspaceRoot: process.env.WORKSPACE_ROOT ?? resolve(dataDir, 'workspaces'),
  
  // Auth
  get jwtSecret(): string {
    const secret = process.env.JWT_SECRET;
    if (!secret && process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET must be set in production');
    }
    return secret ?? 'dev-secret-change-in-production';
  },
  jwtExpiresIn: '7d',
  get encryptionKey(): string {
    const key = process.env.ENCRYPTION_KEY;
    if (!key && process.env.NODE_ENV === 'production') {
      throw new Error('ENCRYPTION_KEY must be set in production');
    }
    return key ?? 'dev-encryption-key-32-bytes!!!';
  },
  
  // k8s
  k8sNamespace: process.env.K8S_NAMESPACE ?? 'goldilocks',
  agentImage: process.env.AGENT_IMAGE ?? 'goldilocks-agent:latest',
  agentIdleTimeoutMs: parseInt(process.env.AGENT_IDLE_TIMEOUT_MS ?? '1800000', 10), // 30min
  agentServiceUrl: process.env.AGENT_SERVICE_URL ?? 'http://agent-service:3001',
  agentServiceWsUrl: process.env.AGENT_SERVICE_WS_URL ?? 'ws://agent-service:3001/ws',
  get agentServiceSharedSecret(): string {
    const secret = process.env.AGENT_SERVICE_SHARED_SECRET;
    if (!secret && process.env.NODE_ENV === 'production') {
      throw new Error('AGENT_SERVICE_SHARED_SECRET must be set in production');
    }
    return secret ?? 'dev-agent-service-secret';
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
