/**
 * File routes — workspace file operations via k8s exec into the user's pod.
 *
 * Files live on the user's PVC at /home/node/.
 * All operations exec into the pod to read/write the PVC.
 *
 * Note: These routes are scoped per user (via auth), not per conversation.
 * The workspace is flat — one directory per user, shared across conversations.
 */

import { Router, Response } from 'express';
import { verifyToken, AuthRequest } from '../auth/middleware.js';
import { sessionManager } from '../agent/sessions.js';

const router = Router();

router.use(verifyToken);

/**
 * Run a command in the user's pod and collect stdout.
 */
async function execCommand(userId: string, command: string[]): Promise<string> {
  const podManager = sessionManager.getPodManager();
  await podManager.ensurePod(userId);
  const exec = await podManager.execInPod(userId, command);

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];

    exec.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    exec.stderr.on('data', (chunk: Buffer) => errChunks.push(chunk));

    // k8s exec streams end when the command finishes
    exec.stdout.on('end', () => {
      exec.close();
      const output = Buffer.concat(chunks).toString();
      const errOutput = Buffer.concat(errChunks).toString().trim();
      if (errOutput) {
        console.error(`exec stderr for user ${userId}: ${errOutput}`);
      }
      resolve(output);
    });

    exec.stdout.on('error', (err) => {
      exec.close();
      reject(err);
    });

    // Timeout after 30 seconds
    setTimeout(() => {
      exec.close();
      reject(new Error('Exec timed out'));
    }, 30_000);
  });
}

// GET /api/files - List workspace files
router.get('/', async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    // List files using stat — BusyBox find doesn't support -printf.
    // Shell printf produces real tab characters (stat -c format doesn't on BusyBox).
    const output = await execCommand(req.user.id, [
      'sh', '-c',
      'find /home/node -maxdepth 1 -not -name ".*" -not -path /home/node | while read f; do '
      + 'printf "%s\t%s\t%s\t%s\n" "$f" "$(stat -c %s "$f")" "$(stat -c %Y "$f")" "$(stat -c %F "$f")"'
      + '; done'
    ]);

    const files = output
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => {
        const [fullPath, size, mtime, type] = line.split('\t');
        const name = fullPath.split('/').pop() ?? fullPath;
        return {
          name,
          size: parseInt(size, 10) || 0,
          isDirectory: type === 'directory',
          modified: (parseInt(mtime, 10) || 0) * 1000 || Date.now(),
        };
      })
      .sort((a, b) => b.modified - a.modified);

    res.json({ files });
  } catch (err) {
    console.error('Error listing files:', err);
    res.json({ files: [] });
  }
});

// POST /api/files/upload - Upload file to workspace
router.post('/upload', async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { filename, content } = req.body as { filename?: string; content?: string };

  if (!filename || !content) {
    res.status(400).json({ error: 'filename and content are required' });
    return;
  }

  // Sanitize filename — no path traversal
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  if (safeName.startsWith('.') || safeName.includes('/') || safeName.includes('\\')) {
    res.status(400).json({ error: 'Invalid filename' });
    return;
  }

  try {
    // Decode base64 content
    const fileBuffer = Buffer.from(content, 'base64');
    const base64Content = fileBuffer.toString('base64');

    // Write via exec: echo base64 | base64 -d > file
    const podManager = sessionManager.getPodManager();
    await podManager.ensurePod(req.user.id);
    const exec = await podManager.execInPod(req.user.id, [
      'sh', '-c', `echo '${base64Content}' | base64 -d > /home/node/${safeName}`
    ]);

    // Wait for completion
    await new Promise<void>((resolve) => {
      exec.stdout.on('end', () => { exec.close(); resolve(); });
      setTimeout(() => { exec.close(); resolve(); }, 10_000);
    });

    res.status(201).json({
      file: { name: safeName, path: safeName, size: fileBuffer.length },
    });
  } catch (err) {
    console.error('Error uploading file:', err);
    res.status(500).json({ error: 'Failed to upload file' });
  }
});

// GET /api/files/:filename/content - Read file content as text
router.get('/:filename/content', async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const safeName = (req.params.filename as string).replace(/[^a-zA-Z0-9._-]/g, '_');

  try {
    const content = await execCommand(req.user.id, ['cat', `/home/node/${safeName}`]);
    res.json({ filename: safeName, content });
  } catch (err) {
    console.error('Error reading file:', err);
    res.status(404).json({ error: 'File not found or could not be read' });
  }
});

// DELETE /api/files/:filename - Delete file
router.delete('/:filename', async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const safeName = (req.params.filename as string).replace(/[^a-zA-Z0-9._-]/g, '_');

  try {
    await execCommand(req.user.id, ['rm', '-f', `/home/node/${safeName}`]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Error deleting file:', err);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

export default router;
