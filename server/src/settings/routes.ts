import { Router, Response } from 'express';
import { getDb } from '../db.js';
import { verifyToken, AuthRequest } from '../auth/middleware.js';
import { CONFIG } from '../config.js';
import { encrypt, decrypt } from '../crypto.js';

const router = Router();

// All routes require authentication
router.use(verifyToken);

const SUPPORTED_PROVIDERS = ['anthropic', 'openai', 'google'] as const;
type Provider = (typeof SUPPORTED_PROVIDERS)[number];

/** Map provider name to the server-configured API key (if any). */
function getServerKey(provider: Provider): string | undefined {
  switch (provider) {
    case 'anthropic':
      return CONFIG.anthropicApiKey;
    case 'openai':
      return CONFIG.openaiApiKey;
    case 'google':
      return CONFIG.googleApiKey;
  }
}

// GET /api/settings - Returns user settings (from users.settings JSON column)
router.get('/', (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const db = getDb();
  const row = db.prepare('SELECT settings FROM users WHERE id = ?').get(req.user.id) as
    | { settings: string }
    | undefined;

  if (!row) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  res.json({ settings: JSON.parse(row.settings) });
});

// PATCH /api/settings - Update user settings (merge with existing)
router.patch('/', (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const updates = req.body;
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    res.status(400).json({ error: 'Request body must be a JSON object' });
    return;
  }

  const db = getDb();
  const row = db.prepare('SELECT settings FROM users WHERE id = ?').get(req.user.id) as
    | { settings: string }
    | undefined;

  if (!row) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const current = JSON.parse(row.settings);
  const merged = { ...current, ...updates };

  db.prepare('UPDATE users SET settings = ? WHERE id = ?').run(
    JSON.stringify(merged),
    req.user.id,
  );

  res.json({ settings: merged });
});

// GET /api/settings/api-keys - List API key metadata (NOT the actual keys)
router.get('/api-keys', (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const db = getDb();
  const userKeys = db
    .prepare('SELECT provider, created_at FROM api_keys WHERE user_id = ?')
    .all(req.user.id) as { provider: string; created_at: number }[];

  const userKeyMap = new Map(userKeys.map((k) => [k.provider, k.created_at]));

  const apiKeys = SUPPORTED_PROVIDERS.map((provider) => ({
    provider,
    hasKey: userKeyMap.has(provider),
    isServerKey: !!getServerKey(provider),
    createdAt: userKeyMap.get(provider) ?? null,
  }));

  res.json({ apiKeys });
});

// PUT /api/settings/api-key - Store encrypted API key
router.put('/api-key', (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { provider, key } = req.body as { provider?: string; key?: string };

  if (!provider || !key) {
    res.status(400).json({ error: 'provider and key are required' });
    return;
  }

  if (!SUPPORTED_PROVIDERS.includes(provider as Provider)) {
    res.status(400).json({
      error: `Invalid provider. Supported: ${SUPPORTED_PROVIDERS.join(', ')}`,
    });
    return;
  }

  const encryptedKey = encrypt(key);
  const now = Date.now();

  const db = getDb();
  db.prepare(
    `INSERT INTO api_keys (user_id, provider, encrypted_key, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, provider) DO UPDATE SET encrypted_key = excluded.encrypted_key, created_at = excluded.created_at`,
  ).run(req.user.id, provider, encryptedKey, now);

  res.json({ ok: true, provider, createdAt: now });
});

// DELETE /api/settings/api-key/:provider - Remove a user's API key
router.delete('/api-key/:provider', (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const provider = req.params.provider as string;

  if (!SUPPORTED_PROVIDERS.includes(provider as Provider)) {
    res.status(400).json({
      error: `Invalid provider. Supported: ${SUPPORTED_PROVIDERS.join(', ')}`,
    });
    return;
  }

  const db = getDb();
  const result = db
    .prepare('DELETE FROM api_keys WHERE user_id = ? AND provider = ?')
    .run(req.user.id, provider);

  if (result.changes === 0) {
    res.status(404).json({ error: 'API key not found for this provider' });
    return;
  }

  res.json({ ok: true });
});

export default router;
