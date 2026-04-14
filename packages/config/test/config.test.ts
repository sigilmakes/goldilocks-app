import { afterEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };

async function loadConfig() {
  vi.resetModules();
  return import('../src/index');
}

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

describe('CONFIG required secrets', () => {
  it('throws when JWT_SECRET is unset', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.JWT_SECRET;
    process.env.ENCRYPTION_KEY = 'test-encryption-key-32bytes!!';
    process.env.AGENT_SERVICE_SHARED_SECRET = 'test-agent-shared-secret';

    const { CONFIG } = await loadConfig();
    expect(() => CONFIG.jwtSecret).toThrow('FATAL: JWT_SECRET environment variable is required. Set it before starting the server.');
  });

  it('throws when ENCRYPTION_KEY is unset', async () => {
    process.env.NODE_ENV = 'development';
    process.env.JWT_SECRET = 'test-jwt-not-for-prod';
    delete process.env.ENCRYPTION_KEY;
    process.env.AGENT_SERVICE_SHARED_SECRET = 'test-agent-shared-secret';

    const { CONFIG } = await loadConfig();
    expect(() => CONFIG.encryptionKey).toThrow('FATAL: ENCRYPTION_KEY environment variable is required. Set it before starting the server.');
  });

  it('throws when AGENT_SERVICE_SHARED_SECRET is unset', async () => {
    process.env.NODE_ENV = 'development';
    process.env.JWT_SECRET = 'test-jwt-not-for-prod';
    process.env.ENCRYPTION_KEY = 'test-encryption-key-32bytes!!';
    delete process.env.AGENT_SERVICE_SHARED_SECRET;

    const { CONFIG } = await loadConfig();
    expect(() => CONFIG.agentServiceSharedSecret).toThrow('FATAL: AGENT_SERVICE_SHARED_SECRET environment variable is required. Set it before starting the server.');
  });

  it('validates all required secrets together', async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-jwt-not-for-prod';
    process.env.ENCRYPTION_KEY = 'test-encryption-key-32bytes!!';
    process.env.AGENT_SERVICE_SHARED_SECRET = 'test-agent-shared-secret';

    const { CONFIG } = await loadConfig();
    expect(() => CONFIG.validateRequiredSecrets()).not.toThrow();
  });
});
