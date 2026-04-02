import { Router, Response } from 'express';
import { mkdirSync, existsSync, readdirSync, statSync, createReadStream, unlinkSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import { resolve, join, basename, extname } from 'path';
import { verifyToken, AuthRequest } from '../auth/middleware.js';
import { CONFIG } from '../config.js';

const router = Router();

// All routes require authentication
router.use(verifyToken);

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

// Allowed file extensions for upload
const ALLOWED_EXTENSIONS = new Set(['.cif', '.poscar', '.vasp', '.xyz', '.pdb', '.json', '.txt', '.in', '.out']);
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

/** Map file extension to Content-Type for serving files with proper headers. */
const CONTENT_TYPE_MAP: Record<string, string> = {
  '.cif': 'chemical/x-cif',
  '.poscar': 'chemical/x-vasp',
  '.vasp': 'chemical/x-vasp',
  '.xyz': 'chemical/x-xyz',
  '.pdb': 'chemical/x-pdb',
  '.json': 'application/json',
  '.txt': 'text/plain',
  '.in': 'text/plain',
  '.out': 'text/plain',
};

function getContentType(filename: string): string {
  const ext = extname(filename).toLowerCase();
  return CONTENT_TYPE_MAP[ext] ?? 'application/octet-stream';
}

// GET /api/conversations/:id/files - List workspace files
router.get('/:conversationId/files', (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const conversationId = req.params.conversationId as string;
  const workspacePath = getWorkspacePath(req.user.id, conversationId);
  
  if (!existsSync(workspacePath)) {
    res.json({ files: [] });
    return;
  }

  try {
    const files = readdirSync(workspacePath)
      .filter(f => !f.startsWith('.') && f !== 'AGENTS.md' && f !== 'goldilocks')
      .map(name => {
        const filePath = join(workspacePath, name);
        const stats = statSync(filePath);
        return {
          name,
          size: stats.size,
          isDirectory: stats.isDirectory(),
          modified: stats.mtime.getTime(),
        };
      })
      .sort((a, b) => b.modified - a.modified);

    res.json({ files });
  } catch (err) {
    console.error('Error listing files:', err);
    res.status(500).json({ error: 'Failed to list files' });
  }
});

// POST /api/conversations/:id/upload - Upload file to workspace
router.post('/:conversationId/upload', async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  // Check content type
  const contentType = req.headers['content-type'] || '';
  
  if (contentType.includes('multipart/form-data')) {
    res.status(400).json({ error: 'Use JSON upload with base64 content' });
    return;
  }

  const { filename, content } = req.body as { filename?: string; content?: string };

  if (!filename || !content) {
    res.status(400).json({ error: 'filename and content are required' });
    return;
  }

  // Validate extension
  const ext = extname(filename).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    res.status(400).json({ error: `File type not allowed. Allowed: ${[...ALLOWED_EXTENSIONS].join(', ')}` });
    return;
  }

  // Decode base64 content
  let fileBuffer: Buffer;
  try {
    fileBuffer = Buffer.from(content, 'base64');
  } catch {
    res.status(400).json({ error: 'Invalid base64 content' });
    return;
  }

  if (fileBuffer.length > MAX_FILE_SIZE) {
    res.status(400).json({ error: `File too large. Max size: ${MAX_FILE_SIZE / 1024 / 1024}MB` });
    return;
  }

  const conversationId = req.params.conversationId as string;
  const workspacePath = ensureWorkspace(req.user.id, conversationId);
  const safeName = basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath = join(workspacePath, safeName);
  // Validate path stays within workspace
  if (!filePath.startsWith(workspacePath)) {
    res.status(403).json({ error: 'Path traversal detected' });
    return;
  }

  try {
    await writeFile(filePath, fileBuffer);
    
    res.status(201).json({
      file: {
        name: safeName,
        path: safeName,
        size: fileBuffer.length,
      }
    });
  } catch (err) {
    console.error('Error saving file:', err);
    res.status(500).json({ error: 'Failed to save file' });
  }
});

// GET /api/conversations/:id/files/:filename - Download file with proper Content-Type
router.get('/:conversationId/files/:filename', (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const conversationId = req.params.conversationId as string;
  const filename = req.params.filename as string;
  const workspacePath = getWorkspacePath(req.user.id, conversationId);
  const safeName = basename(filename);
  const filePath = join(workspacePath, safeName);

  if (!existsSync(filePath)) {
    res.status(404).json({ error: 'File not found' });
    return;
  }

  // Ensure file is within workspace (prevent path traversal)
  if (!filePath.startsWith(workspacePath)) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }

  const contentType = getContentType(safeName);
  const stats = statSync(filePath);

  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', stats.size);

  // Use inline for text types so browser can display, attachment for binary
  const disposition = contentType.startsWith('text/') || contentType === 'application/json'
    ? 'inline' : 'attachment';
  res.setHeader('Content-Disposition', `${disposition}; filename="${safeName}"`);

  createReadStream(filePath).pipe(res);
});

// GET /api/conversations/:id/files/:filename/content - Read file content as text
router.get('/:conversationId/files/:filename/content', async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const conversationId = req.params.conversationId as string;
  const filename = req.params.filename as string;
  const workspacePath = getWorkspacePath(req.user.id, conversationId);
  const safeName = basename(filename);
  const filePath = join(workspacePath, safeName);

  if (!existsSync(filePath)) {
    res.status(404).json({ error: 'File not found' });
    return;
  }

  if (!filePath.startsWith(workspacePath)) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }

  try {
    const content = await readFile(filePath, 'utf-8');
    res.json({ filename: safeName, content });
  } catch {
    res.status(500).json({ error: 'Failed to read file' });
  }
});

// DELETE /api/conversations/:id/files/:filename - Delete file
router.delete('/:conversationId/files/:filename', (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const conversationId = req.params.conversationId as string;
  const filename = req.params.filename as string;
  const workspacePath = getWorkspacePath(req.user.id, conversationId);
  const safeName = basename(filename);
  const filePath = join(workspacePath, safeName);

  if (!existsSync(filePath)) {
    res.status(404).json({ error: 'File not found' });
    return;
  }

  if (!filePath.startsWith(workspacePath)) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }

  try {
    unlinkSync(filePath);
    res.json({ ok: true });
  } catch (err) {
    console.error('Error deleting file:', err);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

export default router;
