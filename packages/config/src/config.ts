import { config } from 'dotenv';
import { resolve } from 'path';

config();

const defaultStateDir = resolve(process.cwd(), '.dev');
const dataDir = process.env.DATA_DIR ?? (process.env.GOLDILOCKS_STATE_DIR ? resolve(process.env.GOLDILOCKS_STATE_DIR) : defaultStateDir);
const sessionCookieMaxAgeMs = parseInt(process.env.SESSION_COOKIE_MAX_AGE_MS ?? '28800000', 10);
const defaultFileUploadMaxBytes = 50 * 1024 * 1024;

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
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '8h',
  jwtIssuer: 'goldilocks-gateway',
  jwtAudience: 'goldilocks-api',
  sessionCookieName: process.env.SESSION_COOKIE_NAME ?? 'goldilocks-session',
  sessionCookieMaxAgeMs,
  get encryptionKey(): string {
    return requireEnv('ENCRYPTION_KEY');
  },

  get frontendUrl(): string {
    return process.env.FRONTEND_URL ?? (this.isProd ? `http://localhost:${this.port}` : 'http://localhost:5173');
  },

  get fileUploadMaxBytes(): number {
    const parsed = parseInt(process.env.FILE_UPLOAD_MAX_BYTES ?? `${defaultFileUploadMaxBytes}`, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultFileUploadMaxBytes;
  },

  get fileUploadBodyLimit(): string {
    return `${this.fileUploadMaxBytes}b`;
  },

  get allowedWebSocketOrigins(): string[] {
    const origins = new Set<string>([this.frontendUrl]);

    if (!this.isProd) {
      origins.add('http://localhost:5173');
      origins.add('http://127.0.0.1:5173');
    }

    return [...origins];
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
