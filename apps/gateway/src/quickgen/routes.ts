import { Router, Response } from 'express';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { resolve, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync } from 'fs';
import { writeFile } from 'fs/promises';
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

/**
 * Resolve a structure path relative to the user's workspace.
 * Throws if the resolved path escapes the workspace.
 */
function resolveStructurePath(
  userId: string,
  conversationId: string,
  structurePath: string,
): string {
  const workspacePath = getWorkspacePath(userId, conversationId);
  return validateWorkspacePath(workspacePath, structurePath);
}

// POST /api/predict - K-point prediction
router.post('/predict', async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { structurePath, conversationId, model, confidence } = req.body as {
    structurePath?: string;
    conversationId?: string;
    model?: string;
    confidence?: number;
  };

  if (!structurePath || !conversationId) {
    res.status(400).json({ error: 'structurePath and conversationId are required' });
    return;
  }

  let resolvedPath: string;
  try {
    resolvedPath = resolveStructurePath(req.user.id, conversationId, structurePath);
  } catch {
    res.status(403).json({ error: 'Path traversal detected' });
    return;
  }

  if (!existsSync(resolvedPath)) {
    res.status(404).json({ error: 'Structure file not found' });
    return;
  }

  const args = ['predict', 'kpoints', resolvedPath];
  if (model) {
    args.push('--model', model);
  }
  if (confidence) {
    args.push('--confidence', String(confidence));
  }
  args.push('--json');

  try {
    const { stdout } = await execFileAsync(binPath, args, { timeout: 60000 });
    const prediction = JSON.parse(stdout);
    res.json({ prediction });
  } catch (err: any) {
    console.error('Predict error:', err);
    const message = err.stderr || err.message || 'Prediction failed';
    res.status(500).json({ error: message });
  }
});

// POST /api/generate - Generate QE input
router.post('/generate', async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { structurePath, conversationId, functional, pseudoMode } = req.body as {
    structurePath?: string;
    conversationId?: string;
    functional?: string;
    pseudoMode?: string;
  };

  if (!structurePath || !conversationId) {
    res.status(400).json({ error: 'structurePath and conversationId are required' });
    return;
  }

  let resolvedPath: string;
  try {
    resolvedPath = resolveStructurePath(req.user.id, conversationId, structurePath);
  } catch {
    res.status(403).json({ error: 'Path traversal detected' });
    return;
  }

  if (!existsSync(resolvedPath)) {
    res.status(404).json({ error: 'Structure file not found' });
    return;
  }

  const workspacePath = ensureWorkspace(req.user.id, conversationId);

  const args = ['generate', 'scf', resolvedPath];
  if (functional) {
    args.push('--functional', functional);
  }
  if (pseudoMode) {
    args.push('--pseudo', pseudoMode);
  }
  args.push('--json');

  try {
    const { stdout } = await execFileAsync(binPath, args, {
      timeout: 60000,
      cwd: workspacePath,
    });
    const result = JSON.parse(stdout);

    // Save the generated input to workspace
    const filename = result.filename ?? `scf_${basename(structurePath, '.cif')}.in`;
    const content = result.content ?? stdout;
    const outputPath = resolve(workspacePath, filename);

    if (result.content) {
      await writeFile(outputPath, result.content, 'utf-8');
    }

    const downloadUrl = `/api/conversations/${conversationId}/files/${encodeURIComponent(filename)}`;

    res.json({ filename, content: result.content ?? null, downloadUrl });
  } catch (err: any) {
    console.error('Generate error:', err);
    const message = err.stderr || err.message || 'Generation failed';
    res.status(500).json({ error: message });
  }
});

export default router;
