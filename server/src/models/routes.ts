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
    
    // Track which providers have keys
    const providersWithKeys: Set<string> = new Set();
    
    if (CONFIG.anthropicApiKey) {
      authStorage.setRuntimeApiKey('anthropic', CONFIG.anthropicApiKey);
      providersWithKeys.add('anthropic');
    }
    if (CONFIG.openaiApiKey) {
      authStorage.setRuntimeApiKey('openai', CONFIG.openaiApiKey);
      providersWithKeys.add('openai');
    }
    if (CONFIG.googleApiKey) {
      authStorage.setRuntimeApiKey('google', CONFIG.googleApiKey);
      providersWithKeys.add('google');
    }

    const modelRegistry = ModelRegistry.create(authStorage);
    const available = await modelRegistry.getAvailable();

    // Filter to only models from providers we have keys for
    const models = available
      .filter(m => providersWithKeys.has(m.provider))
      .map(m => ({
        id: m.id,
        provider: m.provider,
        name: m.name,
        contextWindow: m.contextWindow,
        supportsThinking: 'supportsThinking' in m ? (m as any).supportsThinking : false,
      }));

    res.json({ 
      models,
      providers: Array.from(providersWithKeys),
    });
  } catch (err) {
    console.error('Error fetching models:', err);
    res.status(500).json({ error: 'Failed to fetch available models' });
  }
});

export default router;
