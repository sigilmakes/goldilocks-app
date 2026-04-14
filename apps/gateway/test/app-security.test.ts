import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildReadinessFailureResponse, getRateLimitKey } from '../src/app.js';
import { createTestServer, type TestUser } from './api/helpers/test-server.js';

describe('Gateway security middleware', () => {
  let server: Awaited<ReturnType<typeof createTestServer>>;
  let user: TestUser;

  beforeAll(async () => {
    server = await createTestServer();
    user = await server.registerUser();
  });

  afterAll(async () => {
    await server.stop();
  });

  it('keys rate limits by authenticated user id when a valid token is present', () => {
    expect(getRateLimitKey({
      ip: '127.0.0.1',
      headers: { authorization: server.authHeader(user) },
    } as never)).toBe(user.userId);

    expect(getRateLimitKey({
      ip: '127.0.0.1',
      headers: { cookie: server.cookieHeader(user) },
      cookies: { 'goldilocks-session': user.token },
    } as never)).toBe(user.userId);
  });

  it('falls back to IP bucketing when the token is invalid', () => {
    const unauthenticatedKey = getRateLimitKey({
      ip: '127.0.0.1',
      headers: {},
    } as never);

    const invalidTokenKey = getRateLimitKey({
      ip: '127.0.0.1',
      headers: { authorization: 'Bearer definitely-not-valid' },
    } as never);

    expect(invalidTokenKey).toBe(unauthenticatedKey);
    expect(invalidTokenKey).not.toBe(user.userId);
  });

  it('sanitizes readiness failures', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const response = buildReadinessFailureResponse(new Error('sqlite exploded in a dramatic fashion'));
      expect(response).toEqual({
        status: 'degraded',
        error: 'Service unavailable',
      });
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('sets helmet security headers on API responses', async () => {
    const res = await fetch(`${server.baseUrl}/api/health`);

    expect(res.status).toBe(200);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(res.headers.get('referrer-policy')).toBeTruthy();
  });
});
