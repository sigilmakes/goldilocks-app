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

describe('P7: Admin role and metrics protection', () => {
  it('new users get role=user by default', async () => {
    const { server, user } = await createSessionFixture();
    try {
      const res = await fetch(`${server.baseUrl}/api/auth/me`, {
        headers: { cookie: server.cookieHeader(user) },
      });
      const json = await res.json() as { user: { role: string } };
      expect(json.user.role).toBe('user');
    } finally {
      await server.stop();
    }
  });

  it('JWT payload includes the role claim', async () => {
    const { server, user } = await createSessionFixture();
    try {
      const claims = jwt.verify(user.token, CONFIG.jwtSecret, {
        issuer: CONFIG.jwtIssuer,
        audience: CONFIG.jwtAudience,
      }) as jwt.JwtPayload & { role: string };

      expect(claims.role).toBe('user');
    } finally {
      await server.stop();
    }
  });

  it('ADMIN_EMAILS env var promotes matching users to admin on register', async () => {
    const server = await createTestServer({
      env: { ADMIN_EMAILS: 'admin-test@example.com' },
    });
    try {
      const user = await server.registerUser({
        email: 'admin-test@example.com',
        password: 'AdminPassword123!',
        displayName: 'Admin User',
      });

      const claims = jwt.verify(user.token, CONFIG.jwtSecret, {
        issuer: CONFIG.jwtIssuer,
        audience: CONFIG.jwtAudience,
      }) as jwt.JwtPayload & { role: string };

      expect(claims.role).toBe('admin');

      const res = await fetch(`${server.baseUrl}/api/auth/me`, {
        headers: { cookie: server.cookieHeader(user) },
      });
      const json = await res.json() as { user: { role: string } };
      expect(json.user.role).toBe('admin');
    } finally {
      await server.stop();
    }
  });

  it('ADMIN_EMAILS auto-promotion on login for existing user', async () => {
    // Register without ADMIN_EMAILS set
    const server = await createTestServer();
    const user = await server.registerUser({
      email: 'promote-me@example.com',
      password: 'PromotePassword123!',
    });

    try {
      // Verify they start as 'user'
      const meBefore = await fetch(`${server.baseUrl}/api/auth/me`, {
        headers: { cookie: server.cookieHeader(user) },
      });
      const jsonBefore = await meBefore.json() as { user: { role: string } };
      expect(jsonBefore.user.role).toBe('user');

      // Set ADMIN_EMAILS and log in again
      process.env.ADMIN_EMAILS = 'promote-me@example.com';
      try {
        const loginRes = await fetch(`${server.baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'promote-me@example.com', password: 'PromotePassword123!' }),
        });

        expect(loginRes.status).toBe(200);
        const loginCookie = (loginRes.headers.get('set-cookie') ?? '').split(';')[0];

        const meAfter = await fetch(`${server.baseUrl}/api/auth/me`, {
          headers: { cookie: loginCookie },
        });
        const jsonAfter = await meAfter.json() as { user: { role: string } };
        expect(jsonAfter.user.role).toBe('admin');
      } finally {
        delete process.env.ADMIN_EMAILS;
      }
    } finally {
      await server.stop();
    }
  });

  it('/api/metrics returns 401 for unauthenticated requests', async () => {
    const { server } = await createSessionFixture();
    try {
      const res = await fetch(`${server.baseUrl}/api/metrics`);
      expect(res.status).toBe(401);
    } finally {
      await server.stop();
    }
  });

  it('/api/metrics returns 403 for regular users', async () => {
    const { server, user } = await createSessionFixture();
    try {
      const res = await fetch(`${server.baseUrl}/api/metrics`, {
        headers: { cookie: server.cookieHeader(user) },
      });
      expect(res.status).toBe(403);
    } finally {
      await server.stop();
    }
  });

  it('/api/metrics returns 200 for admin users', async () => {
    const server = await createTestServer({
      env: { ADMIN_EMAILS: 'metrics-admin@example.com' },
    });
    try {
      const user = await server.registerUser({
        email: 'metrics-admin@example.com',
        password: 'MetricsAdmin123!',
        displayName: 'Metrics Admin',
      });

      const res = await fetch(`${server.baseUrl}/api/metrics`, {
        headers: { cookie: server.cookieHeader(user) },
      });
      expect(res.status).toBe(200);
      const json = await res.json() as { relay: object };
      expect(json).toHaveProperty('relay');
    } finally {
      await server.stop();
    }
  });

  it('login response includes role in user object', async () => {
    const { server, user } = await createSessionFixture();
    try {
      const res = await fetch(`${server.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email, password: 'TestPassword123!' }),
      });
      const json = await res.json() as { user: { role: string } };
      expect(json.user.role).toBe('user');
    } finally {
      await server.stop();
    }
  });
});

describe('P8: Per-user key derivation and encryption versioning', () => {
  it('stores API keys with per-user key_salt', async () => {
    const { server, user } = await createSessionFixture();
    try {
      // Store a key
      const storeRes = await fetch(`${server.baseUrl}/api/settings/api-key`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          cookie: server.cookieHeader(user),
        },
        body: JSON.stringify({ provider: 'openai', key: 'sk-test-key-123' }),
      });
      expect(storeRes.status).toBe(200);

      // Verify key_salt was created for this user
      const db = getDb();
      const row = db.prepare('SELECT key_salt FROM users WHERE id = ?').get(user.userId) as { key_salt: string | null };
      expect(row.key_salt).toBeTruthy();
      expect(row.key_salt!.length).toBe(64); // 32 bytes hex

      // Verify key_version is 2
      const keyRow = db.prepare('SELECT key_version FROM api_keys WHERE user_id = ? AND provider = ?').get(user.userId, 'openai') as { key_version: number };
      expect(keyRow.key_version).toBe(2);
    } finally {
      await server.stop();
    }
  });

  it('different users get different key_salts', async () => {
    const server = await createTestServer();
    try {
      const user1 = await server.registerUser({ email: `salt1-${Date.now()}@example.com` });
      const user2 = await server.registerUser({ email: `salt2-${Date.now()}@example.com` });

      // Store keys to trigger salt generation
      await fetch(`${server.baseUrl}/api/settings/api-key`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', cookie: server.cookieHeader(user1) },
        body: JSON.stringify({ provider: 'openai', key: 'sk-key-1' }),
      });
      await fetch(`${server.baseUrl}/api/settings/api-key`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', cookie: server.cookieHeader(user2) },
        body: JSON.stringify({ provider: 'openai', key: 'sk-key-2' }),
      });

      const db = getDb();
      const salt1 = (db.prepare('SELECT key_salt FROM users WHERE id = ?').get(user1.userId) as { key_salt: string }).key_salt;
      const salt2 = (db.prepare('SELECT key_salt FROM users WHERE id = ?').get(user2.userId) as { key_salt: string }).key_salt;

      expect(salt1).not.toBe(salt2);
    } finally {
      await server.stop();
    }
  });
});

describe('P9: Audit trail', () => {
  it('emits structured auth event on successful login', async () => {
    const { server, user } = await createSessionFixture();
    try {
      // Clear any previous logs
      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => {
        const msg = args.map(String).join(' ');
        if (msg.includes('"event"')) logs.push(msg);
        origLog(...args);
      };

      try {
        await fetch(`${server.baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: user.email, password: 'TestPassword123!' }),
        });

        const loginLog = logs.find(l => l.includes('auth.login.success'));
        expect(loginLog).toBeTruthy();
        const parsed = JSON.parse(loginLog!);
        expect(parsed.event).toBe('auth.login.success');
        expect(parsed.userId).toBe(user.userId);
        expect(parsed.ts).toBeTruthy();
      } finally {
        console.log = origLog;
      }
    } finally {
      await server.stop();
    }
  });

  it('emits structured auth event on failed login', async () => {
    const server = await createTestServer();
    try {
      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => {
        const msg = args.map(String).join(' ');
        if (msg.includes('"event"')) logs.push(msg);
        origLog(...args);
      };

      try {
        await fetch(`${server.baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'nonexistent@example.com', password: 'wrong' }),
        });

        const failLog = logs.find(l => l.includes('auth.login.failure'));
        expect(failLog).toBeTruthy();
        const parsed = JSON.parse(failLog!);
        expect(parsed.event).toBe('auth.login.failure');
        expect(parsed.attemptedEmail).toBe('nonexistent@example.com');
      } finally {
        console.log = origLog;
      }
    } finally {
      await server.stop();
    }
  });

  it('emits structured event on logout', async () => {
    const { server, user } = await createSessionFixture();
    try {
      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => {
        const msg = args.map(String).join(' ');
        if (msg.includes('"event"')) logs.push(msg);
        origLog(...args);
      };

      try {
        await fetch(`${server.baseUrl}/api/auth/logout`, {
          method: 'POST',
          headers: { cookie: server.cookieHeader(user) },
        });

        const logoutLog = logs.find(l => l.includes('auth.logout'));
        expect(logoutLog).toBeTruthy();
        const parsed = JSON.parse(logoutLog!);
        expect(parsed.event).toBe('auth.logout');
      } finally {
        console.log = origLog;
      }
    } finally {
      await server.stop();
    }
  });

  it('emits structured event on API key store', async () => {
    const { server, user } = await createSessionFixture();
    try {
      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => {
        const msg = args.map(String).join(' ');
        if (msg.includes('"event"')) logs.push(msg);
        origLog(...args);
      };

      try {
        await fetch(`${server.baseUrl}/api/settings/api-key`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            cookie: server.cookieHeader(user),
          },
          body: JSON.stringify({ provider: 'anthropic', key: 'sk-ant-test-key' }),
        });

        const storeLog = logs.find(l => l.includes('settings.api-key.store'));
        expect(storeLog).toBeTruthy();
        const parsed = JSON.parse(storeLog!);
        expect(parsed.event).toBe('settings.api-key.store');
        expect(parsed.details?.provider).toBe('anthropic');
        // Never log key values
        expect(storeLog).not.toContain('sk-ant-test-key');
      } finally {
        console.log = origLog;
      }
    } finally {
      await server.stop();
    }
  });

  it('emits structured event on API key delete', async () => {
    const { server, user } = await createSessionFixture();
    try {
      // Store a key first
      await fetch(`${server.baseUrl}/api/settings/api-key`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          cookie: server.cookieHeader(user),
        },
        body: JSON.stringify({ provider: 'openai', key: 'sk-test-delete' }),
      });

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => {
        const msg = args.map(String).join(' ');
        if (msg.includes('"event"')) logs.push(msg);
        origLog(...args);
      };

      try {
        await fetch(`${server.baseUrl}/api/settings/api-key/openai`, {
          method: 'DELETE',
          headers: { cookie: server.cookieHeader(user) },
        });

        const deleteLog = logs.find(l => l.includes('settings.api-key.delete'));
        expect(deleteLog).toBeTruthy();
        const parsed = JSON.parse(deleteLog!);
        expect(parsed.event).toBe('settings.api-key.delete');
        expect(parsed.details?.provider).toBe('openai');
      } finally {
        console.log = origLog;
      }
    } finally {
      await server.stop();
    }
  });

  it('emits admin.action event on metrics access', async () => {
    const server = await createTestServer({
      env: { ADMIN_EMAILS: 'audit-admin@example.com' },
    });
    try {
      const user = await server.registerUser({
        email: 'audit-admin@example.com',
        password: 'AuditAdmin123!',
      });

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => {
        const msg = args.map(String).join(' ');
        if (msg.includes('"event"')) logs.push(msg);
        origLog(...args);
      };

      try {
        await fetch(`${server.baseUrl}/api/metrics`, {
          headers: { cookie: server.cookieHeader(user) },
        });

        const adminLog = logs.find(l => l.includes('admin.action'));
        expect(adminLog).toBeTruthy();
        const parsed = JSON.parse(adminLog!);
        expect(parsed.event).toBe('admin.action');
        expect(parsed.details?.action).toBe('metrics');
      } finally {
        console.log = origLog;
      }
    } finally {
      await server.stop();
    }
  });
});