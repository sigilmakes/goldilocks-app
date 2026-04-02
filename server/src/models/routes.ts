import { Router, Response } from 'express';
import { AuthStorage, ModelRegistry } from '@mariozechner/pi-coding-agent';
import { verifyToken, AuthRequest } from '../auth/middleware.js';
import { CONFIG } from '../config.js';
import { getDb } from '../db.js';
import { decrypt } from '../crypto.js';

const PROVIDER_MAP: Record<string, string> = {
  anthropic: 'anthropic',
  openai: 'openai',
  google: 'google',
};

const router = Router();

// GET /api/models - List available models based on configured API keys
router.get('/', verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const authStorage = AuthStorage.create();

    // 1. User API keys from DB (highest priority)
    if (req.user?.id) {
      try {
        const db = getDb();
        const rows = db.prepare(
          'SELECT provider, encrypted_key FROM api_keys WHERE user_id = ?'
        ).all(req.user.id) as Array<{ provider: string; encrypted_key: string }>;
        for (const row of rows) {
          const providerId = PROVIDER_MAP[row.provider] ?? row.provider;
          try {
            const key = decrypt(row.encrypted_key);
            if (key) authStorage.setRuntimeApiKey(providerId, key);
          } catch (err) {
            console.error(`Failed to decrypt ${row.provider} key for user ${req.user!.id}:`, err);
          }
        }
      } catch (err) {
        console.error('Failed to query user API keys:', err);
      }
    }

    // 2. Server-level keys as fallback
    if (CONFIG.anthropicApiKey) {
      authStorage.setRuntimeApiKey('anthropic', CONFIG.anthropicApiKey);
    }
    if (CONFIG.openaiApiKey) {
      authStorage.setRuntimeApiKey('openai', CONFIG.openaiApiKey);
    }
    if (CONFIG.googleApiKey) {
      authStorage.setRuntimeApiKey('google', CONFIG.googleApiKey);
    }

    const modelRegistry = ModelRegistry.create(authStorage);
    
    // getAvailable() returns only models with valid API keys
    const available = await modelRegistry.getAvailable();

    const models = available.map(m => ({
      id: m.id,
      provider: m.provider,
      name: m.name,
      contextWindow: m.contextWindow,
      supportsThinking: 'supportsThinking' in m ? (m as any).supportsThinking : false,
    }));

    // Get unique providers from available models
    const providers = [...new Set(models.map(m => m.provider))];

    res.json({ 
      models,
      providers,
    });
  } catch (err) {
    console.error('Error fetching models:', err);
    res.status(500).json({ error: 'Failed to fetch available models' });
  }
});

export default router;
