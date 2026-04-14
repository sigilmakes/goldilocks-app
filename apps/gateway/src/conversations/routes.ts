/**
 * Conversations route — CRUD for conversation metadata.
 *
 * Conversation content (messages) lives in pi's session files on the PVC.
 * This route only manages the metadata the frontend sidebar needs.
 */

import { Router, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb } from '@goldilocks/data';
import { verifyToken, AuthRequest } from '../auth/middleware.js';
import { agentServiceFetch } from '../agent/agent-service-client.js';

const router = Router();

router.use(verifyToken);

interface ConversationRow {
  id: string;
  user_id: string;
  title: string;
  model: string | null;
  provider: string | null;
  pi_session_id: string | null;
  last_message_preview: string | null;
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
  const rows = db.prepare(`
    SELECT id, title, model, provider, pi_session_id, last_message_preview, created_at, updated_at
    FROM conversations
    WHERE user_id = ?
    ORDER BY updated_at DESC
  `).all(req.user.id) as ConversationRow[];

  res.json({
    conversations: rows.map((r) => ({
      id: r.id,
      title: r.title,
      model: r.model,
      provider: r.provider,
      piSessionId: r.pi_session_id,
      lastMessagePreview: r.last_message_preview,
      created_at: r.created_at,
      updated_at: r.updated_at,
    })),
  });
});

// POST /api/conversations - Create conversation
router.post('/', (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { title } = req.body;
  const id = uuid();
  const now = Date.now();

  const db = getDb();
  db.prepare(`
    INSERT INTO conversations (id, user_id, title, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, req.user.id, title ?? 'New conversation', now, now);

  res.status(201).json({
    conversation: {
      id,
      title: title ?? 'New conversation',
      model: null,
      provider: null,
      piSessionId: null,
      lastMessagePreview: null,
      createdAt: now,
      updatedAt: now,
    },
  });
});

// GET /api/conversations/:id - Get conversation
router.get('/:id', (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const db = getDb();
  const row = db.prepare(`
    SELECT id, title, model, provider, pi_session_id, last_message_preview, created_at, updated_at
    FROM conversations
    WHERE id = ? AND user_id = ?
  `).get(req.params.id, req.user.id) as ConversationRow | undefined;

  if (!row) {
    res.status(404).json({ error: 'Conversation not found' });
    return;
  }

  res.json({
    conversation: {
      id: row.id,
      title: row.title,
      model: row.model,
      provider: row.provider,
      piSessionId: row.pi_session_id,
      lastMessagePreview: row.last_message_preview,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
  });
});

// PATCH /api/conversations/:id - Update conversation
router.patch('/:id', (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { title } = req.body;
  const now = Date.now();

  const db = getDb();

  const existing = db.prepare(`
    SELECT id FROM conversations WHERE id = ? AND user_id = ?
  `).get(req.params.id, req.user.id);

  if (!existing) {
    res.status(404).json({ error: 'Conversation not found' });
    return;
  }

  if (title !== undefined) {
    db.prepare(`
      UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?
    `).run(title, now, req.params.id);
  } else {
    db.prepare(`
      UPDATE conversations SET updated_at = ? WHERE id = ?
    `).run(now, req.params.id);
  }

  const row = db.prepare(`
    SELECT id, title, model, provider, pi_session_id, last_message_preview, created_at, updated_at
    FROM conversations WHERE id = ?
  `).get(req.params.id) as ConversationRow;

  res.json({
    conversation: {
      id: row.id,
      title: row.title,
      model: row.model,
      provider: row.provider,
      piSessionId: row.pi_session_id,
      lastMessagePreview: row.last_message_preview,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
  });
});

// DELETE /api/conversations/:id - Delete conversation
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const db = getDb();

  // Get pi_session_id before deleting
  const row = db.prepare(`
    SELECT pi_session_id FROM conversations WHERE id = ? AND user_id = ?
  `).get(req.params.id, req.user.id) as { pi_session_id: string | null } | undefined;

  if (!row) {
    res.status(404).json({ error: 'Conversation not found' });
    return;
  }

  // Clean up session files via the agent service before deleting metadata.
  if (row.pi_session_id) {
    try {
      const response = await agentServiceFetch('/internal/sessions/delete', {
        method: 'POST',
        userId: req.user.id,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionPath: row.pi_session_id }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        res.status(502).json({ error: (payload as { error?: string }).error ?? 'Failed to delete agent session' });
        return;
      }
    } catch (err) {
      console.error('Failed to clean up pi session:', err);
      res.status(502).json({ error: 'Failed to delete agent session' });
      return;
    }
  }

  db.prepare(`DELETE FROM conversations WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

export default router;
