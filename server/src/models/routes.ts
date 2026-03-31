import { Router, Response } from 'express';
import { AuthStorage, ModelRegistry } from '@mariozechner/pi-coding-agent';
import { verifyToken, AuthRequest } from '../auth/middleware.js';
import { CONFIG } from '../config.js';

const router = Router();

// GET /api/models - List available models based on configured API keys
router.get('/', verifyToken, async (_req: AuthRequest, res: Response) => {
  try {
    // Set up auth storage - this reads from ~/.pi/agent/auth.json
    const authStorage = AuthStorage.create();
    
    // Add any server-configured keys as overrides
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
