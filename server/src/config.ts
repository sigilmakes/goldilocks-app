import { config } from 'dotenv';
import { resolve } from 'path';

config();

export const CONFIG = {
  port: parseInt(process.env.PORT ?? '3000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  
  // Paths
  dataDir: process.env.DATA_DIR ?? './data',
  workspaceRoot: process.env.WORKSPACE_ROOT ?? './data/workspaces',
  
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
  
  // Session management
  maxSessions: parseInt(process.env.MAX_SESSIONS ?? '20', 10),
  sessionIdleTimeoutMs: parseInt(process.env.SESSION_IDLE_TIMEOUT_MS ?? '300000', 10),
  
  // API Keys
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  openaiApiKey: process.env.OPENAI_API_KEY,
  googleApiKey: process.env.GOOGLE_API_KEY,
  
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
