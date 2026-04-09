import { afterEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

describe('CONFIG.agentServiceSharedSecret', () => {
  it('uses the dev default outside production', async () => {
    delete process.env.AGENT_SERVICE_SHARED_SECRET;
    process.env.NODE_ENV = 'development';

    const { CONFIG } = await import('../../server/src/config');
    expect(CONFIG.agentServiceSharedSecret).toBe('dev-agent-service-secret');
  });

  it('throws in production when unset', async () => {
    delete process.env.AGENT_SERVICE_SHARED_SECRET;
    process.env.NODE_ENV = 'production';

    const { CONFIG } = await import('../../server/src/config');
    expect(() => CONFIG.agentServiceSharedSecret).toThrow('AGENT_SERVICE_SHARED_SECRET must be set in production');
  });
});
