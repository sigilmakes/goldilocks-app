/**
 * Models route — get available models from the in-process pi SDK.
 *
 * The SDK model registry knows which API keys are configured and which models
 * are available for the current user session.
 */

import { Router, Response } from 'express';
import { verifyToken, AuthRequest } from '../auth/middleware.js';
import { sessionManager } from '../agent/sessions.js';

const router = Router();

// GET /api/models - List available models from pi
router.get('/', verifyToken, async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const result = await sessionManager.getAvailableModels(req.user.id) as Record<string, unknown> | unknown[];
    
    // Pi returns { models: [...] }
    const models = Array.isArray(result) ? result
      : Array.isArray((result as Record<string, unknown>)?.models) ? (result as Record<string, unknown>).models as unknown[]
      : [];
    const providers = [...new Set((models as Array<Record<string, unknown>>).map((m) => m.provider as string))];

    res.json({ models, providers });
  } catch (err) {
    console.error('Error fetching models:', err);
    res.status(500).json({ error: 'Failed to fetch available models' });
  }
});

// POST /api/models/select - Set the active model
router.post('/select', verifyToken, async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { modelId } = req.body;
  if (!modelId) {
    res.status(400).json({ error: 'modelId is required' });
    return;
  }

  try {
    await sessionManager.setModel(req.user.id, modelId);
    res.json({ ok: true, modelId });
  } catch (err) {
    console.error('Error setting model:', err);
    res.status(500).json({ error: 'Failed to set model' });
  }
});

export default router;
