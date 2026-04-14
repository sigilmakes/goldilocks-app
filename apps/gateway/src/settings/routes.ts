import { Router, Response } from 'express';
import { getDb } from '@goldilocks/data';
import { verifyToken, AuthRequest } from '../auth/middleware.js';
import { encrypt } from '@goldilocks/config';
import { getProviders, getModels } from '@mariozechner/pi-ai';

const router = Router();

// All routes require authentication
router.use(verifyToken);

// Derive the full built-in provider list from Pi SDK at startup
const BUILTIN_PROVIDERS: Set<string> = new Set(getProviders());

// Human-readable display names for providers
const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  'openai': 'OpenAI',
  'anthropic': 'Anthropic',
  'google': 'Google',
  'mistral': 'Mistral',
  'xai': 'xAI',
  'openrouter': 'OpenRouter',
  'vercel-ai-gateway': 'Vercel AI Gateway',
  'amazon-bedrock': 'Amazon Bedrock',
  'azure-openai-responses': 'Azure OpenAI',
  'google-vertex': 'Google Vertex AI',
  'google-antigravity': 'Google Antigravity',
  'google-gemini-cli': 'Google Gemini CLI',
  'groq': 'Groq',
  'cerebras': 'Cerebras',
  'huggingface': 'Hugging Face',
  'github-copilot': 'GitHub Copilot',
  'openai-codex': 'OpenAI Codex',
  'opencode': 'OpenCode',
  'opencode-go': 'OpenCode Go',
  'kimi-coding': 'Kimi Coding',
  'minimax': 'MiniMax',
  'minimax-cn': 'MiniMax (China)',
  'zai': 'ZAI',
};

// Provider grouping for UI organization
const PROVIDER_GROUPS: Record<string, string> = {
  'openai': 'popular',
  'anthropic': 'popular',
  'google': 'popular',
  'mistral': 'popular',
  'xai': 'popular',
  'openrouter': 'aggregators',
  'vercel-ai-gateway': 'aggregators',
  'opencode': 'aggregators',
  'opencode-go': 'aggregators',
  'amazon-bedrock': 'cloud',
  'azure-openai-responses': 'cloud',
  'google-vertex': 'cloud',
  'groq': 'specialist',
  'cerebras': 'specialist',
  'huggingface': 'specialist',
  'kimi-coding': 'specialist',
  'zai': 'specialist',
  'minimax': 'specialist',
  'github-copilot': 'subscription',
  'openai-codex': 'subscription',
  'google-antigravity': 'subscription',
  'google-gemini-cli': 'subscription',
  'minimax-cn': 'regional',
};

const GROUP_LABELS: Record<string, string> = {
  popular: 'Popular',
  aggregators: 'Aggregators',
  cloud: 'Cloud Platforms',
  specialist: 'Specialist',
  subscription: 'Subscription',
  regional: 'Regional',
};

const ALLOWED_SETTING_KEYS = new Set(['defaultModel', 'defaultFunctional', 'workspaceViewer']);
const ALLOWED_WORKSPACE_VIEWER_KEYS = new Set([
  'monacoExtensions',
  'imageViewerExtensions',
  'imageBackground',
  'imageFitMode',
  'pdfDefaultZoom',
  'monacoFontSize',
  'monacoTabSize',
  'monacoWordWrap',
  'monacoLineNumbers',
  'monacoMinimap',
]);

function normalizeExtension(value: string): string {
  return value.trim().toLowerCase().replace(/^\./, '');
}

function normalizeExtensions(values: unknown): string[] {
  if (!Array.isArray(values) || values.some((value) => typeof value !== 'string')) {
    throw new Error('workspaceViewer extension lists must be string arrays');
  }

  return Array.from(new Set(values.map(normalizeExtension).filter(Boolean)));
}

function parseSettings(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function validateWorkspaceViewerPatch(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('workspaceViewer must be an object');
  }

  const patch = value as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};

  for (const key of Object.keys(patch)) {
    if (!ALLOWED_WORKSPACE_VIEWER_KEYS.has(key)) {
      throw new Error(`Unknown workspaceViewer setting: ${key}`);
    }
  }

  if ('monacoExtensions' in patch) {
    normalized.monacoExtensions = normalizeExtensions(patch.monacoExtensions);
  }

  if ('imageViewerExtensions' in patch) {
    normalized.imageViewerExtensions = normalizeExtensions(patch.imageViewerExtensions);
  }

  if ('imageBackground' in patch) {
    if (!['checkered', 'dark', 'light'].includes(String(patch.imageBackground))) {
      throw new Error('workspaceViewer.imageBackground must be checkered, dark, or light');
    }
    normalized.imageBackground = patch.imageBackground;
  }

  if ('imageFitMode' in patch) {
    if (!['contain', 'actual'].includes(String(patch.imageFitMode))) {
      throw new Error('workspaceViewer.imageFitMode must be contain or actual');
    }
    normalized.imageFitMode = patch.imageFitMode;
  }

  if ('pdfDefaultZoom' in patch) {
    if (![50, 75, 100, 125, 150, 200].includes(Number(patch.pdfDefaultZoom))) {
      throw new Error('workspaceViewer.pdfDefaultZoom must be one of 50, 75, 100, 125, 150, or 200');
    }
    normalized.pdfDefaultZoom = Number(patch.pdfDefaultZoom);
  }

  if ('monacoFontSize' in patch) {
    const value = Number(patch.monacoFontSize);
    if (!Number.isFinite(value)) {
      throw new Error('workspaceViewer.monacoFontSize must be a number');
    }
    normalized.monacoFontSize = Math.min(24, Math.max(10, Math.round(value)));
  }

  if ('monacoTabSize' in patch) {
    if (![2, 4, 8].includes(Number(patch.monacoTabSize))) {
      throw new Error('workspaceViewer.monacoTabSize must be 2, 4, or 8');
    }
    normalized.monacoTabSize = Number(patch.monacoTabSize);
  }

  for (const booleanKey of ['monacoWordWrap', 'monacoLineNumbers', 'monacoMinimap'] as const) {
    if (booleanKey in patch) {
      if (typeof patch[booleanKey] !== 'boolean') {
        throw new Error(`workspaceViewer.${booleanKey} must be a boolean`);
      }
      normalized[booleanKey] = patch[booleanKey];
    }
  }

  return normalized;
}

function validateSettingsPatch(updates: unknown, current: Record<string, unknown>): Record<string, unknown> {
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    throw new Error('Request body must be a JSON object');
  }

  const patch = updates as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};

  for (const key of Object.keys(patch)) {
    if (!ALLOWED_SETTING_KEYS.has(key)) {
      throw new Error(`Unknown setting: ${key}`);
    }
  }

  if ('defaultModel' in patch) {
    if (patch.defaultModel !== null && typeof patch.defaultModel !== 'string') {
      throw new Error('defaultModel must be a string or null');
    }
    normalized.defaultModel = patch.defaultModel;
  }

  if ('defaultFunctional' in patch) {
    if (patch.defaultFunctional !== 'PBE' && patch.defaultFunctional !== 'PBEsol') {
      throw new Error('defaultFunctional must be PBE or PBEsol');
    }
    normalized.defaultFunctional = patch.defaultFunctional;
  }

  if ('workspaceViewer' in patch) {
    const currentViewer = current.workspaceViewer && typeof current.workspaceViewer === 'object' && !Array.isArray(current.workspaceViewer)
      ? current.workspaceViewer as Record<string, unknown>
      : {};
    normalized.workspaceViewer = {
      ...currentViewer,
      ...validateWorkspaceViewerPatch(patch.workspaceViewer),
    };
  }

  return normalized;
}

// GET /api/settings/providers - Returns all built-in Pi providers with metadata
router.get('/providers', (_req: AuthRequest, res: Response) => {
  const providers = getProviders()
    .map((id) => ({
      id,
      name: PROVIDER_DISPLAY_NAMES[id] ?? id,
      group: PROVIDER_GROUPS[id] ?? 'specialist',
      modelCount: getModels(id).length,
    }))
    .sort((a, b) => b.modelCount - a.modelCount);

  res.json({
    providers,
    groups: GROUP_LABELS,
  });
});

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

  res.json({ settings: parseSettings(row.settings) });
});

// PATCH /api/settings - Update user settings (merge with existing)
router.patch('/', (req: AuthRequest, res: Response) => {
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

  const current = parseSettings(row.settings);

  try {
    const normalizedPatch = validateSettingsPatch(req.body, current);
    const merged = {
      ...current,
      ...normalizedPatch,
    };

    db.prepare('UPDATE users SET settings = ? WHERE id = ?').run(
      JSON.stringify(merged),
      req.user.id,
    );

    res.json({ settings: merged });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid settings payload' });
  }
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

  // Return key status for every provider the user has a key for
  const apiKeys = Array.from(userKeyMap.entries()).map(([provider, created_at]) => ({
    provider,
    hasKey: true,
    createdAt: created_at,
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

  if (!BUILTIN_PROVIDERS.has(provider)) {
    res.status(400).json({
      error: `Unknown provider: ${provider}`,
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

  if (!BUILTIN_PROVIDERS.has(provider)) {
    res.status(400).json({
      error: `Unknown provider: ${provider}`,
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
