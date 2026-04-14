import jwt from 'jsonwebtoken';
import { describe, it, expect } from 'vitest';
import { getDb } from '@goldilocks/data';
import { CONFIG } from '@goldilocks/config';
import { createTestServer } from './helpers/test-server.js';

async function createSessionFixture(overrides?: Partial<{ email: string; password: string; displayName: string }>) {
  const server = await createTestServer();
  const user = await server.registerUser(overrides);
  return { server, user };
}

describe('Auth registration', () => {
  it('registers a new user and sets a session cookie', async () => {
    const server = await createTestServer();

    try {
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
    } finally {
      await server.stop();
    }
  }, 15000);

  it('rejects duplicate email', async () => {
    const server = await createTestServer();

    try {
      const user = await server.registerUser();
      const res = await fetch(`${server.baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email, password: 'Password123!', displayName: 'Duplicate' }),
      });

      expect(res.status).toBe(409);
    } finally {
      await server.stop();
    }
  });

  it('rejects registration with missing fields', async () => {
    const server = await createTestServer();

    try {
      const res = await fetch(`${server.baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'no-password@example.com' }),
      });

      expect(res.status).toBe(400);
    } finally {
      await server.stop();
    }
  });

  it('rate limits registrations to three per hour per IP', async () => {
    const server = await createTestServer();

    try {
      for (let i = 0; i < 3; i++) {
        const res = await fetch(`${server.baseUrl}/api/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: `rate-limit-${i}-${Date.now()}@example.com`,
            password: 'Password123!',
            displayName: 'Rate Limited',
          }),
        });

        expect(res.status).toBe(201);
      }

      const blocked = await fetch(`${server.baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: `rate-limit-blocked-${Date.now()}@example.com`,
          password: 'Password123!',
          displayName: 'Blocked',
        }),
      });

      expect(blocked.status).toBe(429);
      const json = await blocked.json() as { error: string };
      expect(json.error).toMatch(/registration/i);
    } finally {
      await server.stop();
    }
  });
});

describe('Auth session and lockout flow', () => {
  it('issues JWT claims with iss, aud, and jti', async () => {
    const { server, user } = await createSessionFixture();

    try {
      const claims = jwt.verify(user.token, CONFIG.jwtSecret, {
        issuer: CONFIG.jwtIssuer,
        audience: CONFIG.jwtAudience,
      }) as jwt.JwtPayload & { id: string; email: string; jti: string };

      expect(claims.id).toBe(user.userId);
      expect(claims.email).toBe(user.email);
      expect(typeof claims.jti).toBe('string');
      expect(claims.jti.length).toBeGreaterThan(10);
    } finally {
      await server.stop();
    }
  });

  it('logs in with valid credentials and sets a session cookie', async () => {
    const { server, user } = await createSessionFixture();

    try {
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
    } finally {
      await server.stop();
    }
  }, 10000);

  it('clears failed auth attempts after a successful login', async () => {
    const { server, user } = await createSessionFixture();

    try {
      await fetch(`${server.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email, password: 'WrongPassword!' }),
      });

      const beforeSuccess = getDb().prepare('SELECT attempts FROM failed_auth_attempts WHERE email = ?').get(user.email) as { attempts: number } | undefined;
      expect(beforeSuccess?.attempts).toBe(1);

      const success = await fetch(`${server.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email, password: 'TestPassword123!' }),
      });

      expect(success.status).toBe(200);

      const afterSuccess = getDb().prepare('SELECT attempts FROM failed_auth_attempts WHERE email = ?').get(user.email);
      expect(afterSuccess).toBeUndefined();
    } finally {
      await server.stop();
    }
  }, 10000);

  it('locks an account after five failed attempts and rejects further attempts immediately', async () => {
    const { server } = await createSessionFixture();
    const email = `lockout-${Date.now()}@example.com`;
    await server.registerUser({ email, password: 'Lockout123!' });

    try {
      for (let i = 1; i <= 4; i++) {
        const res = await fetch(`${server.baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password: 'wrong-password' }),
        });

        expect(res.status).toBe(401);
      }

      const locked = await fetch(`${server.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'wrong-password' }),
      });

      expect(locked.status).toBe(429);
      const lockedJson = await locked.json() as { error: string };
      expect(lockedJson.error).toMatch(/temporarily locked/i);

      const lockedAgain = await fetch(`${server.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'Lockout123!' }),
      });

      expect(lockedAgain.status).toBe(429);
    } finally {
      await server.stop();
    }
  }, 10000);

  it('doubles the lockout duration on the next failure cycle', async () => {
    const { server } = await createSessionFixture();
    const email = `backoff-${Date.now()}@example.com`;
    await server.registerUser({ email, password: 'Backoff123!' });

    try {
      for (let i = 0; i < 5; i++) {
        await fetch(`${server.baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password: 'wrong-password' }),
        });
      }

      const firstCycle = getDb().prepare(
        'SELECT attempts, locked_until FROM failed_auth_attempts WHERE email = ?'
      ).get(email) as { attempts: number; locked_until: number };

      getDb().prepare(
        'UPDATE failed_auth_attempts SET locked_until = ?, last_attempt = ? WHERE email = ?'
      ).run(Date.now() - 1, Date.now(), email);

      for (let i = 0; i < 5; i++) {
        await fetch(`${server.baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password: 'still-wrong' }),
        });
      }

      const secondCycle = getDb().prepare(
        'SELECT attempts, locked_until FROM failed_auth_attempts WHERE email = ?'
      ).get(email) as { attempts: number; locked_until: number };

      expect(firstCycle.attempts).toBe(5);
      expect(secondCycle.attempts).toBe(10);

      const firstDuration = firstCycle.locked_until - Date.now();
      const secondDuration = secondCycle.locked_until - Date.now();
      expect(secondDuration).toBeGreaterThan(firstDuration + (10 * 60 * 1000));
    } finally {
      await server.stop();
    }
  }, 15000);

  it('rejects unknown email until lockout triggers', async () => {
    const { server } = await createSessionFixture();

    try {
      for (let i = 0; i < 4; i++) {
        const res = await fetch(`${server.baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'nobody@example.com', password: 'Anything!' }),
        });

        expect(res.status).toBe(401);
      }

      const locked = await fetch(`${server.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'nobody@example.com', password: 'Anything!' }),
      });

      expect(locked.status).toBe(429);
    } finally {
      await server.stop();
    }
  });

  it('returns the current user profile via the session cookie', async () => {
    const { server, user } = await createSessionFixture();

    try {
      const res = await fetch(`${server.baseUrl}/api/auth/me`, {
        headers: { cookie: server.cookieHeader(user) },
      });

      expect(res.status).toBe(200);
      const json = await res.json() as { user: { id: string; email: string; displayName: string } };
      expect(json.user.id).toBe(user.userId);
      expect(json.user.email).toBe(user.email);
      expect(json.user.displayName).toBe('Test User');
    } finally {
      await server.stop();
    }
  });

  it('still accepts a bearer token during migration fallback', async () => {
    const { server, user } = await createSessionFixture();

    try {
      const res = await fetch(`${server.baseUrl}/api/auth/me`, {
        headers: { authorization: server.authHeader(user) },
      });

      expect(res.status).toBe(200);
      const json = await res.json() as { user: { id: string } };
      expect(json.user.id).toBe(user.userId);
    } finally {
      await server.stop();
    }
  });

  it('rejects requests without a token', async () => {
    const { server } = await createSessionFixture();

    try {
      const res = await fetch(`${server.baseUrl}/api/auth/me`);
      expect(res.status).toBe(401);
    } finally {
      await server.stop();
    }
  });

  it('rejects requests with an invalid token', async () => {
    const { server } = await createSessionFixture();

    try {
      const res = await fetch(`${server.baseUrl}/api/auth/me`, {
        headers: { authorization: 'Bearer not-a-real-token' },
      });
      expect(res.status).toBe(401);
    } finally {
      await server.stop();
    }
  });

  it('rejects requests with a malformed Authorization header', async () => {
    const { server } = await createSessionFixture();

    try {
      const res = await fetch(`${server.baseUrl}/api/auth/me`, {
        headers: { authorization: 'NotBearer token' },
      });
      expect(res.status).toBe(401);
    } finally {
      await server.stop();
    }
  });

  it('refreshes the cookie without returning the raw token', async () => {
    const { server, user } = await createSessionFixture();

    try {
      const res = await fetch(`${server.baseUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: { cookie: server.cookieHeader(user) },
      });

      expect(res.status).toBe(200);
      const json = await res.json() as { ok: boolean; token?: string };
      expect(json.ok).toBe(true);
      expect(json).not.toHaveProperty('token');
      expect(res.headers.get('set-cookie')).toContain(`${CONFIG.sessionCookieName}=`);
    } finally {
      await server.stop();
    }
  });

  it('logout revokes the current token and clears the cookie', async () => {
    const { server, user } = await createSessionFixture();

    try {
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
    } finally {
      await server.stop();
    }
  });
});
