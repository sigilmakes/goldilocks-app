import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, runMigrations } from '@goldilocks/data';
import { CONFIG } from '@goldilocks/config';
import { generateToken, revokeToken, verifySignedToken } from '../../gateway/src/auth/middleware.js';
import {
  authenticateInternalHttpRequest,
  authenticateInternalWebSocketMessage,
} from '../src/internal-auth.js';

describe('agent-service internal auth', () => {
  beforeAll(() => {
    runMigrations();
  });

  afterAll(() => {
    closeDb();
  });

  it('accepts internal HTTP requests with the shared secret and a verified JWT', () => {
    const token = generateToken({ id: 'user-1', email: 'user@example.com' });
    const req = {
      header(name: string) {
        if (name === 'x-goldilocks-shared-secret') {
          return CONFIG.agentServiceSharedSecret;
        }
        if (name === 'authorization') {
          return `Bearer ${token}`;
        }
        return undefined;
      },
    };

    const auth = authenticateInternalHttpRequest(req as any);
    expect(auth.userId).toBe('user-1');
    expect(auth.claims.email).toBe('user@example.com');
  });

  it('rejects internal HTTP requests without a bearer token', () => {
    const req = {
      header(name: string) {
        if (name === 'x-goldilocks-shared-secret') {
          return CONFIG.agentServiceSharedSecret;
        }
        return undefined;
      },
    };

    expect(() => authenticateInternalHttpRequest(req as any)).toThrow('Missing bearer token');
  });

  it('authenticates gateway websocket messages using the shared secret and JWT', () => {
    const token = generateToken({ id: 'user-2', email: 'ws@example.com' });
    const auth = authenticateInternalWebSocketMessage({
      gatewayToken: CONFIG.agentServiceSharedSecret,
      userToken: token,
    });

    expect(auth.userId).toBe('user-2');
    expect(auth.claims.email).toBe('ws@example.com');
  });

  it('rejects revoked JWTs on internal websocket auth', () => {
    const token = generateToken({ id: 'user-3', email: 'revoked@example.com' });
    revokeToken(verifySignedToken(token));

    expect(() => authenticateInternalWebSocketMessage({
      gatewayToken: CONFIG.agentServiceSharedSecret,
      userToken: token,
    })).toThrow('Token revoked');
  });
});
