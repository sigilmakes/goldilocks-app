import jwt from 'jsonwebtoken';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { CONFIG } from '@goldilocks/config';
import { createTestServer, type TestUser } from './helpers/test-server.js';

describe('Auth', () => {
  let server: Awaited<ReturnType<typeof createTestServer>>;
  let user: TestUser;

  beforeAll(async () => {
    server = await createTestServer();
    user = await server.registerUser();
  });

  afterAll(async () => {
    await server.stop();
  });

  // ── Register ───────────────────────────────────────────────────────────────

  it('registers a new user and sets a session cookie', async () => {
    const email = `new-${Date.now()}@example.com`;
    const res = await fetch(`${server.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Password123!', displayName: 'New User' }),
    });

    expect(res.status).toBe(201);
    const json = await res.json() as { user: { id: string; email: string } };
    const setCookie = res.headers.get('set-cookie') ?? '';

    expect(setCookie).toContain(`${CONFIG.sessionCookieName}=`);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
    expect(json.user.email).toBe(email);
  });

  it('issues JWT claims with iss, aud, and jti', async () => {
    const claims = jwt.verify(user.token, CONFIG.jwtSecret, {
      issuer: CONFIG.jwtIssuer,
      audience: CONFIG.jwtAudience,
    }) as jwt.JwtPayload & { id: string; email: string; jti: string };

    expect(claims.id).toBe(user.userId);
    expect(claims.email).toBe(user.email);
    expect(typeof claims.jti).toBe('string');
    expect(claims.jti.length).toBeGreaterThan(10);
  });

  it('rejects duplicate email', async () => {
    const res = await fetch(`${server.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: 'Password123!', displayName: 'Duplicate' }),
    });

    expect(res.status).toBe(409);
  });

  it('rejects registration with missing fields', async () => {
    const res = await fetch(`${server.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'no-password@example.com' }),
    });

    expect(res.status).toBe(400);
  });

  // ── Login ─────────────────────────────────────────────────────────────────

  it('logs in with valid credentials and sets a session cookie', async () => {
    const res = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: 'TestPassword123!' }),
    });

    expect(res.status).toBe(200);
    const json = await res.json() as { user: { id: string; email: string } };
    const setCookie = res.headers.get('set-cookie') ?? '';

    expect(setCookie).toContain(`${CONFIG.sessionCookieName}=`);
    expect(json.user.id).toBe(user.userId);
  });

  it('rejects invalid password', async () => {
    const res = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: 'WrongPassword!' }),
    });

    expect(res.status).toBe(401);
    const json = await res.json() as { error: string };
    expect(json.error.toLowerCase()).toMatch(/password|credential/i);
  });

  it('rejects unknown email', async () => {
    const res = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@example.com', password: 'Anything!' }),
    });

    expect(res.status).toBe(401);
  });

  // ── GET /me ───────────────────────────────────────────────────────────────

  it('returns the current user profile via the session cookie', async () => {
    const res = await fetch(`${server.baseUrl}/api/auth/me`, {
      headers: { cookie: server.cookieHeader(user) },
    });

    expect(res.status).toBe(200);
    const json = await res.json() as { user: { id: string; email: string; displayName: string } };
    expect(json.user.id).toBe(user.userId);
    expect(json.user.email).toBe(user.email);
    expect(json.user.displayName).toBe('Test User');
  });

  it('still accepts a bearer token during migration fallback', async () => {
    const res = await fetch(`${server.baseUrl}/api/auth/me`, {
      headers: { authorization: server.authHeader(user) },
    });

    expect(res.status).toBe(200);
    const json = await res.json() as { user: { id: string } };
    expect(json.user.id).toBe(user.userId);
  });

  it('rejects requests without a token', async () => {
    const res = await fetch(`${server.baseUrl}/api/auth/me`);
    expect(res.status).toBe(401);
  });

  it('rejects requests with an invalid token', async () => {
    const res = await fetch(`${server.baseUrl}/api/auth/me`, {
      headers: { authorization: 'Bearer not-a-real-token' },
    });
    expect(res.status).toBe(401);
  });

  it('rejects requests with a malformed Authorization header', async () => {
    const res = await fetch(`${server.baseUrl}/api/auth/me`, {
      headers: { authorization: 'NotBearer token' },
    });
    expect(res.status).toBe(401);
  });

  it('refreshes the cookie without returning the raw token', async () => {
    const res = await fetch(`${server.baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { cookie: server.cookieHeader(user) },
    });

    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; token?: string };
    expect(json.ok).toBe(true);
    expect(json).not.toHaveProperty('token');
    expect(res.headers.get('set-cookie')).toContain(`${CONFIG.sessionCookieName}=`);
  });

  it('logout revokes the current token and clears the cookie', async () => {
    const loginRes = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: 'TestPassword123!' }),
    });
    const loginCookie = (loginRes.headers.get('set-cookie') ?? '').split(';')[0];
    const loginToken = decodeURIComponent(loginCookie.split('=').slice(1).join('='));

    const logoutRes = await fetch(`${server.baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { cookie: loginCookie },
    });

    expect(logoutRes.status).toBe(200);
    const clearedCookie = logoutRes.headers.get('set-cookie') ?? '';
    expect(clearedCookie).toContain(`${CONFIG.sessionCookieName}=`);
    expect(clearedCookie.toLowerCase()).toContain('expires=thu, 01 jan 1970');

    const revokedCookieRes = await fetch(`${server.baseUrl}/api/auth/me`, {
      headers: { cookie: loginCookie },
    });
    expect(revokedCookieRes.status).toBe(401);

    const revokedHeaderRes = await fetch(`${server.baseUrl}/api/auth/me`, {
      headers: { authorization: `Bearer ${loginToken}` },
    });
    expect(revokedHeaderRes.status).toBe(401);
  });
});
