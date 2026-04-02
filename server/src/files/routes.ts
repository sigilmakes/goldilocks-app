/**
 * File routes — workspace file operations via k8s exec.
 *
 * Files live on the user's PVC at /home/node/.
 * All operations go through the pod manager (exec into pod).
 *
 * TODO (Wave 3): Implement file operations via exec.
 * For now, returns stubs so the frontend doesn't break.
 */

import { Router, Response } from 'express';
import { verifyToken, AuthRequest } from '../auth/middleware.js';

const router = Router();

router.use(verifyToken);

// GET /api/conversations/:id/files - List workspace files
router.get('/:conversationId/files', (_req: AuthRequest, res: Response) => {
  // Wave 3: will exec `ls` in user pod
  res.json({ files: [] });
});

// POST /api/conversations/:id/upload - Upload file
router.post('/:conversationId/upload', (_req: AuthRequest, res: Response) => {
  // Wave 3: will write file via exec
  res.status(501).json({ error: 'File upload not yet implemented in v2' });
});

// GET /api/conversations/:id/files/:filename - Download file
router.get('/:conversationId/files/:filename', (_req: AuthRequest, res: Response) => {
  // Wave 3: will read file via exec
  res.status(501).json({ error: 'File download not yet implemented in v2' });
});

// GET /api/conversations/:id/files/:filename/content - Read file content
router.get('/:conversationId/files/:filename/content', (_req: AuthRequest, res: Response) => {
  // Wave 3: will read file via exec
  res.status(501).json({ error: 'File read not yet implemented in v2' });
});

// DELETE /api/conversations/:id/files/:filename - Delete file
router.delete('/:conversationId/files/:filename', (_req: AuthRequest, res: Response) => {
  // Wave 3: will delete file via exec
  res.status(501).json({ error: 'File delete not yet implemented in v2' });
});

export default router;
