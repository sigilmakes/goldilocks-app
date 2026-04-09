import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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

  it('registers a new user and returns a JWT', async () => {
    const email = `new-${Date.now()}@example.com`;
    const res = await fetch(`${server.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Password123!', displayName: 'New User' }),
    });

    expect(res.status).toBe(201);
    const json = await res.json() as { token: string; user: { id: string; email: string } };
    expect(json.token).toBeTruthy();
    expect(json.user.email).toBe(email);
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

  it('logs in with valid credentials and returns a JWT', async () => {
    const res = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: 'TestPassword123!' }),
    });

    expect(res.status).toBe(200);
    const json = await res.json() as { token: string; user: { id: string; email: string } };
    expect(json.token).toBeTruthy();
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

  it('returns the current user profile', async () => {
    const res = await fetch(`${server.baseUrl}/api/auth/me`, {
      headers: { authorization: server.authHeader(user) },
    });

    expect(res.status).toBe(200);
    const json = await res.json() as { user: { id: string; email: string; displayName: string } };
    expect(json.user.id).toBe(user.userId);
    expect(json.user.email).toBe(user.email);
    expect(json.user.displayName).toBe('Test User');
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
});
