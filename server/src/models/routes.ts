import { Router, Response } from 'express';
import { AuthStorage, ModelRegistry } from '@mariozechner/pi-coding-agent';
import { verifyToken, AuthRequest } from '../auth/middleware.js';
import { CONFIG } from '../config.js';

const router = Router();

// GET /api/models - List available models based on configured API keys
router.get('/', verifyToken, async (_req: AuthRequest, res: Response) => {
  try {
    // Set up auth storage with server API keys
    const authStorage = AuthStorage.create();
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
    const available = await modelRegistry.getAvailable();

    const models = available.map(m => ({
      id: m.id,
      provider: m.provider,
      name: m.name,
      contextWindow: m.contextWindow,
      supportsThinking: 'supportsThinking' in m ? (m as any).supportsThinking : false,
    }));

    res.json({ models });
  } catch (err) {
    console.error('Error fetching models:', err);
    res.status(500).json({ error: 'Failed to fetch available models' });
  }
});

export default router;
