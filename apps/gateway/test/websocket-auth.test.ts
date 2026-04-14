import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { IncomingMessage } from 'http';
import { closeDb, runMigrations } from '@goldilocks/data';
import { CONFIG } from '@goldilocks/config';
import {
  authenticateWebSocketUpgrade,
} from '../src/agent/websocket.js';
import {
  generateToken,
  revokeToken,
  verifySignedToken,
} from '../src/auth/middleware.js';

function makeUpgradeRequest(overrides: Partial<IncomingMessage['headers']> = {}): IncomingMessage {
  return {
    headers: {
      host: 'localhost:3000',
      origin: 'http://localhost:5173',
      ...overrides,
    },
  } as IncomingMessage;
}

describe('gateway websocket upgrade auth', () => {
  beforeAll(() => {
    runMigrations();
  });

  afterAll(() => {
    closeDb();
  });

  it('accepts upgrade requests from the allowed origin with a valid session cookie', () => {
    const token = generateToken({ id: 'user-1', email: 'user@example.com' });
    const req = makeUpgradeRequest({
      cookie: `${CONFIG.sessionCookieName}=${encodeURIComponent(token)}`,
    });

    const result = authenticateWebSocketUpgrade(req);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.user.id).toBe('user-1');
    expect(result.token).toBe(token);
  });

  it('rejects websocket upgrades from disallowed origins', () => {
    const token = generateToken({ id: 'user-1', email: 'user@example.com' });
    const req = makeUpgradeRequest({
      origin: 'https://evil.example',
      cookie: `${CONFIG.sessionCookieName}=${encodeURIComponent(token)}`,
    });

    const result = authenticateWebSocketUpgrade(req);
    expect(result).toEqual({
      ok: false,
      status: 403,
      error: 'WebSocket origin not allowed',
    });
  });

  it('rejects websocket upgrades without a session cookie', () => {
    const result = authenticateWebSocketUpgrade(makeUpgradeRequest());
    expect(result).toEqual({
      ok: false,
      status: 401,
      error: 'Missing session cookie',
    });
  });

  it('rejects revoked websocket tokens', () => {
    const token = generateToken({ id: 'user-2', email: 'revoked@example.com' });
    const claims = verifySignedToken(token);
    revokeToken(claims);

    const req = makeUpgradeRequest({
      cookie: `${CONFIG.sessionCookieName}=${encodeURIComponent(token)}`,
    });

    const result = authenticateWebSocketUpgrade(req);
    expect(result).toEqual({
      ok: false,
      status: 401,
      error: 'Invalid, expired, or revoked token',
    });
  });
});
