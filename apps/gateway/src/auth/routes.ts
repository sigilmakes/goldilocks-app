import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb } from '@goldilocks/data';
import { hashPassword, verifyPassword } from './hash.js';
import {
  clearSessionCookie,
  generateToken,
  revokeToken,
  setSessionCookie,
  verifyToken,
  AuthRequest,
} from './middleware.js';

const router = Router();

interface RegisterBody {
  email: string;
  password: string;
  displayName?: string;
}

interface LoginBody {
  email: string;
  password: string;
}

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string | null;
  settings: string;
  created_at?: number;
}

interface FailedAuthAttemptRow {
  email: string;
  attempts: number;
  locked_until: number | null;
  last_attempt: number;
}

const AUTH_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const AUTH_FAILURE_THRESHOLD = 5;
const BASE_LOCKOUT_MS = 15 * 60 * 1000;

function formatUser(row: Pick<UserRow, 'id' | 'email' | 'display_name' | 'settings'> & { created_at?: number }) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    settings: JSON.parse(row.settings),
    createdAt: row.created_at,
  };
}

function getFailedAuthAttempt(email: string): FailedAuthAttemptRow | undefined {
  return getDb().prepare(`
    SELECT email, attempts, locked_until, last_attempt
    FROM failed_auth_attempts
    WHERE email = ?
  `).get(email) as FailedAuthAttemptRow | undefined;
}

function clearFailedAuthAttempts(email: string): void {
  getDb().prepare('DELETE FROM failed_auth_attempts WHERE email = ?').run(email);
}

function getLockoutDurationMs(attempts: number): number {
  const cycle = Math.max(1, Math.floor(attempts / AUTH_FAILURE_THRESHOLD));
  return BASE_LOCKOUT_MS * (2 ** (cycle - 1));
}

function getLockoutMessage(lockedUntil: number): string {
  const remainingMinutes = Math.max(1, Math.ceil((lockedUntil - Date.now()) / 60_000));
  return `Account temporarily locked. Try again in ${remainingMinutes} minute${remainingMinutes === 1 ? '' : 's'}.`;
}

function recordFailedLogin(email: string): { lockedUntil: number | null } {
  const db = getDb();
  const now = Date.now();
  const existing = getFailedAuthAttempt(email);

  const shouldContinueFailureCycle = Boolean(
    existing && (
      existing.attempts >= AUTH_FAILURE_THRESHOLD
      || now - existing.last_attempt <= AUTH_FAILURE_WINDOW_MS
    )
  );

  const attempts = shouldContinueFailureCycle
    ? (existing?.attempts ?? 0) + 1
    : 1;

  const lockedUntil = attempts % AUTH_FAILURE_THRESHOLD === 0
    ? now + getLockoutDurationMs(attempts)
    : null;

  db.prepare(`
    INSERT INTO failed_auth_attempts (email, attempts, locked_until, last_attempt)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET
      attempts = excluded.attempts,
      locked_until = excluded.locked_until,
      last_attempt = excluded.last_attempt
  `).run(email, attempts, lockedUntil, now);

  return { lockedUntil };
}

function getActiveLockout(email: string): FailedAuthAttemptRow | null {
  const attempt = getFailedAuthAttempt(email);
  if (!attempt?.locked_until) {
    return null;
  }

  if (attempt.locked_until <= Date.now()) {
    return null;
  }

  return attempt;
}

// POST /api/auth/register
router.post('/register', async (req: Request<{}, {}, RegisterBody>, res: Response) => {
  const { email, password, displayName } = req.body;

  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required' });
    return;
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    res.status(400).json({ error: 'Invalid email format' });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters' });
    return;
  }

  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    res.status(409).json({ error: 'Email already registered' });
    return;
  }

  const id = uuid();
  const passwordHash = await hashPassword(password);

  db.prepare(`
    INSERT INTO users (id, email, password_hash, display_name)
    VALUES (?, ?, ?, ?)
  `).run(id, email, passwordHash, displayName ?? null);

  const token = generateToken({ id, email });
  setSessionCookie(res, token);

  res.status(201).json({
    user: {
      id,
      email,
      displayName: displayName ?? null,
      settings: {},
    },
  });
});

// POST /api/auth/login
router.post('/login', async (req: Request<{}, {}, LoginBody>, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required' });
    return;
  }

  const activeLockout = getActiveLockout(email);
  if (activeLockout?.locked_until) {
    res.status(429).json({ error: getLockoutMessage(activeLockout.locked_until) });
    return;
  }

  const db = getDb();
  const row = db.prepare(`
    SELECT id, email, password_hash, display_name, settings
    FROM users WHERE email = ?
  `).get(email) as UserRow | undefined;

  if (!row) {
    const failure = recordFailedLogin(email);
    if (failure.lockedUntil) {
      res.status(429).json({ error: getLockoutMessage(failure.lockedUntil) });
      return;
    }

    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  const valid = await verifyPassword(password, row.password_hash);
  if (!valid) {
    const failure = recordFailedLogin(email);
    if (failure.lockedUntil) {
      res.status(429).json({ error: getLockoutMessage(failure.lockedUntil) });
      return;
    }

    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  clearFailedAuthAttempts(email);

  const token = generateToken({ id: row.id, email: row.email });
  setSessionCookie(res, token);

  res.json({
    user: formatUser(row),
  });
});

// POST /api/auth/refresh
router.post('/refresh', verifyToken, (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const token = generateToken(req.user);
  setSessionCookie(res, token);
  res.json({ ok: true });
});

// POST /api/auth/logout
router.post('/logout', verifyToken, (req: AuthRequest, res: Response) => {
  if (!req.authClaims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  revokeToken({ jti: req.authClaims.jti, exp: req.authClaims.exp! });
  clearSessionCookie(res);
  res.json({ ok: true });
});

// GET /api/auth/me
router.get('/me', verifyToken, (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const db = getDb();
  const row = db.prepare(`
    SELECT id, email, display_name, settings, created_at
    FROM users WHERE id = ?
  `).get(req.user.id) as UserRow | undefined;

  if (!row) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  res.json({ user: formatUser(row) });
});

export default router;
