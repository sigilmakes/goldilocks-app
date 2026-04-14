import { Router, Response } from 'express';
import { verifyToken, AuthRequest } from '../auth/middleware.js';
import { agentServiceFetch } from '../agent/agent-service-client.js';

const router = Router();

router.get('/', verifyToken, async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const response = await agentServiceFetch('/internal/models', {
      method: 'GET',
      userId: req.user.id,
    });
    const json = await response.json();
    res.status(response.status).json(json);
  } catch (err) {
    console.error('Error fetching models from agent service:', err);
    res.status(502).json({ error: 'Failed to fetch available models' });
  }
});

router.post('/select', verifyToken, async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const response = await agentServiceFetch('/internal/models/select', {
      method: 'POST',
      userId: req.user.id,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body ?? {}),
    });
    const json = await response.json();
    res.status(response.status).json(json);
  } catch (err) {
    console.error('Error setting model via agent service:', err);
    res.status(502).json({ error: 'Failed to set model' });
  }
});

export default router;
