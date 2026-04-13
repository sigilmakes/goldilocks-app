import { Router, Response } from 'express';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { v4 as uuid } from 'uuid';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync } from 'fs';
import { writeFile } from 'fs/promises';
import { getDb } from '@goldilocks/data';
import { verifyToken, AuthRequest } from '../auth/middleware.js';
import { CONFIG } from '@goldilocks/config';
import { validateWorkspacePath } from '@goldilocks/runtime';

const __dirname = dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);

const router = Router();

// All routes require authentication
router.use(verifyToken);

const binPath = resolve(__dirname, '../../../../scripts/goldilocks');

function getWorkspacePath(userId: string, conversationId: string): string {
  return resolve(CONFIG.workspaceRoot, userId, conversationId, 'workspace');
}

function ensureWorkspace(userId: string, conversationId: string): string {
  const path = getWorkspacePath(userId, conversationId);
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
  return path;
}

// POST /api/structures/search - Search structure databases
router.post('/search', async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { formula, database, limit } = req.body as {
    formula?: string;
    database?: string;
    limit?: number;
  };

  if (!formula) {
    res.status(400).json({ error: 'formula is required' });
    return;
  }

  const db = database ?? 'jarvis';
  const lim = limit ?? 10;

  try {
    const { stdout } = await execFileAsync(binPath, [
      'search',
      formula,
      '--database',
      db,
      '--limit',
      String(lim),
      '--json',
    ], { timeout: 30000 });

    const results = JSON.parse(stdout);
    res.json({ results });
  } catch (err: any) {
    console.error('Structure search error:', err);
    const message = err.stderr || err.message || 'Search failed';
    res.status(500).json({ error: message });
  }
});

// POST /api/structures/fetch - Fetch a structure from database and save to workspace
router.post('/fetch', async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { database, id, conversationId } = req.body as {
    database?: string;
    id?: string;
    conversationId?: string;
  };

  if (!database || !id || !conversationId) {
    res.status(400).json({ error: 'database, id, and conversationId are required' });
    return;
  }

  const workspacePath = ensureWorkspace(req.user.id, conversationId);

  try {
    const { stdout } = await execFileAsync(binPath, [
      'fetch',
      id,
      '--database',
      database,
      '--output',
      workspacePath,
      '--json',
    ], { timeout: 30000 });

    const result = JSON.parse(stdout);
    res.json({ path: result.path ?? result.filename, structure: result });
  } catch (err: any) {
    console.error('Structure fetch error:', err);
    const message = err.stderr || err.message || 'Fetch failed';
    res.status(500).json({ error: message });
  }
});

export default router;

// --- Library routes (separate router for /api/library) ---

export const libraryRouter = Router();
libraryRouter.use(verifyToken);

// GET /api/library - List user's saved structures
libraryRouter.get('/', (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const db = getDb();
  const structures = db
    .prepare(
      `SELECT id, name, formula, source, source_id, file_path, metadata, created_at
       FROM structure_library
       WHERE user_id = ?
       ORDER BY created_at DESC`,
    )
    .all(req.user.id) as {
    id: string;
    name: string;
    formula: string;
    source: string | null;
    source_id: string | null;
    file_path: string;
    metadata: string;
    created_at: number;
  }[];

  res.json({
    structures: structures.map((s) => ({
      id: s.id,
      name: s.name,
      formula: s.formula,
      source: s.source,
      sourceId: s.source_id,
      filePath: s.file_path,
      metadata: JSON.parse(s.metadata),
      createdAt: s.created_at,
    })),
  });
});

// POST /api/library - Save structure to library
libraryRouter.post('/', (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { name, formula, conversationId, filePath, source, sourceId, metadata } = req.body as {
    name?: string;
    formula?: string;
    conversationId?: string;
    filePath?: string;
    source?: string;
    sourceId?: string;
    metadata?: Record<string, unknown>;
  };

  if (!name || !formula || !filePath) {
    res.status(400).json({ error: 'name, formula, and filePath are required' });
    return;
  }

  // Resolve absolute path relative to workspace if conversationId is provided
  let resolvedPath = filePath;
  if (conversationId) {
    const workspacePath = getWorkspacePath(req.user.id, conversationId);
    try {
      resolvedPath = validateWorkspacePath(workspacePath, filePath);
    } catch {
      res.status(403).json({ error: 'Path traversal detected' });
      return;
    }
  }

  const id = uuid();
  const now = Date.now();

  const db = getDb();
  db.prepare(
    `INSERT INTO structure_library (id, user_id, name, formula, source, source_id, file_path, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, req.user.id, name, formula, source ?? null, sourceId ?? null, resolvedPath, JSON.stringify(metadata ?? {}), now);

  res.status(201).json({
    structure: {
      id,
      name,
      formula,
      source: source ?? null,
      sourceId: sourceId ?? null,
      filePath: resolvedPath,
      metadata: metadata ?? {},
      createdAt: now,
    },
  });
});

// DELETE /api/library/:id - Remove from library
libraryRouter.delete('/:id', (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const db = getDb();
  const result = db
    .prepare('DELETE FROM structure_library WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.user.id);

  if (result.changes === 0) {
    res.status(404).json({ error: 'Structure not found' });
    return;
  }

  res.json({ ok: true });
});
