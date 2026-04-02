import { Router, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb } from '../db.js';
import { verifyToken, AuthRequest } from '../auth/middleware.js';
import { sessionManager } from '../agent/sessions.js';

const router = Router();

// All routes require authentication
router.use(verifyToken);

interface Conversation {
  id: string;
  user_id: string;
  title: string;
  model: string | null;
  provider: string | null;
  created_at: number;
  updated_at: number;
}

// GET /api/conversations - List conversations
router.get('/', (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const db = getDb();
  const conversations = db.prepare(`
    SELECT id, title, model, provider, created_at, updated_at
    FROM conversations
    WHERE user_id = ?
    ORDER BY updated_at DESC
  `).all(req.user.id) as Conversation[];

  res.json({ conversations });
});

// POST /api/conversations - Create conversation
router.post('/', (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { title, model, provider } = req.body;
  const id = uuid();
  const now = Date.now();

  const db = getDb();
  db.prepare(`
    INSERT INTO conversations (id, user_id, title, model, provider, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.user.id, title ?? 'New conversation', model ?? null, provider ?? null, now, now);

  res.status(201).json({
    conversation: {
      id,
      title: title ?? 'New conversation',
      model: model ?? null,
      provider: provider ?? null,
      createdAt: now,
      updatedAt: now,
    }
  });
});

// GET /api/conversations/:id - Get conversation
router.get('/:id', (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const db = getDb();
  const conversation = db.prepare(`
    SELECT id, title, model, provider, created_at, updated_at
    FROM conversations
    WHERE id = ? AND user_id = ?
  `).get(req.params.id, req.user.id) as Conversation | undefined;

  if (!conversation) {
    res.status(404).json({ error: 'Conversation not found' });
    return;
  }

  res.json({ conversation });
});

// PATCH /api/conversations/:id - Update conversation
router.patch('/:id', (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { title, model, provider } = req.body;
  const now = Date.now();

  const db = getDb();
  
  // Check ownership
  const existing = db.prepare(`
    SELECT id FROM conversations WHERE id = ? AND user_id = ?
  `).get(req.params.id, req.user.id);
  
  if (!existing) {
    res.status(404).json({ error: 'Conversation not found' });
    return;
  }

  // Build update query dynamically
  const updates: string[] = ['updated_at = ?'];
  const values: (string | number | null)[] = [now];
  
  if (title !== undefined) {
    updates.push('title = ?');
    values.push(title);
  }
  if (model !== undefined) {
    updates.push('model = ?');
    values.push(model);
  }
  if (provider !== undefined) {
    updates.push('provider = ?');
    values.push(provider);
  }

  values.push(req.params.id as string);
  
  db.prepare(`
    UPDATE conversations SET ${updates.join(', ')} WHERE id = ?
  `).run(...values);

  const conversation = db.prepare(`
    SELECT id, title, model, provider, created_at, updated_at
    FROM conversations WHERE id = ?
  `).get(req.params.id) as Conversation;

  res.json({ conversation });
});

// DELETE /api/conversations/:id - Delete conversation
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const db = getDb();
  
  const result = db.prepare(`
    DELETE FROM conversations WHERE id = ? AND user_id = ?
  `).run(req.params.id, req.user.id);

  if (result.changes === 0) {
    res.status(404).json({ error: 'Conversation not found' });
    return;
  }

  // Clean up pi session files on the PVC via the session manager
  try {
    await sessionManager.deleteConversation(req.user.id, req.params.id as string);
  } catch (err) {
    console.error('Failed to clean up pi session:', err);
  }

  res.json({ ok: true });
});

export default router;
