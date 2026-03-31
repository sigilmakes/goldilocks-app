import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb } from '../db.js';
import { hashPassword, verifyPassword } from './hash.js';
import { generateToken, verifyToken, AuthRequest } from './middleware.js';

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

// POST /api/auth/register
router.post('/register', async (req: Request<{}, {}, RegisterBody>, res: Response) => {
  const { email, password, displayName } = req.body;
  
  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required' });
    return;
  }
  
  if (password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters' });
    return;
  }
  
  const db = getDb();
  
  // Check if user exists
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
  
  const user = { id, email, displayName: displayName ?? null };
  const token = generateToken({ id, email });
  
  res.status(201).json({ token, user });
});

// POST /api/auth/login
router.post('/login', async (req: Request<{}, {}, LoginBody>, res: Response) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required' });
    return;
  }
  
  const db = getDb();
  const row = db.prepare(`
    SELECT id, email, password_hash, display_name, settings
    FROM users WHERE email = ?
  `).get(email) as { id: string; email: string; password_hash: string; display_name: string | null; settings: string } | undefined;
  
  if (!row) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }
  
  const valid = await verifyPassword(password, row.password_hash);
  if (!valid) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }
  
  const token = generateToken({ id: row.id, email: row.email });
  const user = {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    settings: JSON.parse(row.settings)
  };
  
  res.json({ token, user });
});

// POST /api/auth/refresh
router.post('/refresh', verifyToken, (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  
  const token = generateToken(req.user);
  res.json({ token });
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
  `).get(req.user.id) as { id: string; email: string; display_name: string | null; settings: string; created_at: number } | undefined;
  
  if (!row) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  
  res.json({
    user: {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      settings: JSON.parse(row.settings),
      createdAt: row.created_at
    }
  });
});

export default router;
