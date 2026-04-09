/**
 * File routes -- workspace file operations via k8s exec into the user's pod.
 *
 * Files live on the user's PVC at /home/node/.
 * All operations exec into the pod to read/write the PVC.
 *
 * Note: These routes are scoped per user (via auth), not per conversation.
 *
 * Route order matters (Express matches first):
 *   1. GET /          -- list (static)
 *   2. POST /upload   -- upload (static)
 *   3. POST /move     -- move (static)
 *   4. GET /<path>/raw -- raw download (specific, before catch-all)
 *   5. GET /<path>     -- read file (regex catch-all, also used for PUT/DELETE)
 */

import { Router, Response } from 'express';
import { verifyToken, AuthRequest } from '../auth/middleware.js';
import { sessionManager } from '../agent/sessions.js';

const router = Router();

router.use(verifyToken);

// --- Helpers -----------------------------------------------------------------

interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children?: FileEntry[];
  size?: number;
  modified?: number;
}

async function execCommand(userId: string, command: string[]): Promise<string> {
  const podManager = sessionManager.getPodManager();
  await podManager.ensurePod(userId);
  const exec = await podManager.execInPod(userId, command);

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let settled = false;

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      exec.close();
      if (err) {
        reject(err);
        return;
      }
      const output = Buffer.concat(chunks).toString();
      const errOutput = Buffer.concat(errChunks).toString().trim();
      if (errOutput) console.error(`exec stderr for user ${userId}: ${errOutput}`);
      resolve(output);
    };

    exec.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    exec.stderr.on('data', (chunk: Buffer) => errChunks.push(chunk));
    exec.stdout.on('end', () => finish());
    exec.stderr.on('end', () => finish());
    exec.stdout.on('error', (err) => finish(err instanceof Error ? err : new Error(String(err))));
    exec.stderr.on('error', (err) => finish(err instanceof Error ? err : new Error(String(err))));

    setTimeout(() => finish(new Error('Exec timed out')), 30_000);
  });
}

async function writeFileViaExec(userId: string, path: string, base64Content: string): Promise<void> {
  await execCommand(userId, [
    'sh', '-c', `echo '${base64Content}' | base64 -d > /home/node/${path} && echo OK`
  ]);
}

function sanitizePath(path: string): string {
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    decoded = path;
  }
  return decoded.replace(/\.\./g, '').replace(/^\/+/, '');
}

function buildTree(
  flat: { path: string; type: 'file' | 'dir'; size?: number; modified?: number }[]
): FileEntry[] {
  const root: FileEntry[] = [];
  const index: Map<string, FileEntry> = new Map();

  function ensureAncestors(path: string): FileEntry | null {
    // Ensure all parent directories exist, return the direct parent entry
    const parts = path.split('/').filter(Boolean);
    let children: FileEntry[] = root;
    let currentPath = '';

    for (let i = 0; i < parts.length - 1; i++) {
      currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];
      const existing = index.get(currentPath);
      if (existing) {
        children = existing.children!;
        continue;
      }
      const dir: FileEntry = {
        name: parts[i],
        path: currentPath,
        type: 'dir',
        children: [],
      };
      index.set(currentPath, dir);
      children.push(dir);
      children = dir.children!;
    }

    // Return the parent's children array for the leaf entry
    return parts.length > 1 ? index.get(parts.slice(0, -1).join('/')) ?? null : null;
  }

  for (const entry of flat) {
    const parts = entry.path.split('/').filter(Boolean);
    const name = parts[parts.length - 1];

    const fileEntry: FileEntry = {
      name,
      path: entry.path,
      type: entry.type,
      size: entry.size,
      modified: entry.modified,
      children: entry.type === 'dir' ? [] : undefined,
    };

    index.set(entry.path, fileEntry);

    if (parts.length === 1) {
      root.push(fileEntry);
    } else {
      const parent = ensureAncestors(entry.path);
      if (parent?.children) {
        parent.children.push(fileEntry);
      } else {
        // Shouldn't happen if the find output is consistent, but safe fallback
        root.push(fileEntry);
      }
    }
  }

  const sort = (entries: FileEntry[]) => {
    entries.sort((a, b) => {
      if (a.type === 'dir' && b.type === 'file') return -1;
      if (a.type === 'file' && b.type === 'dir') return 1;
      return a.name.localeCompare(b.name);
    });
    for (const e of entries) {
      if (e.children) sort(e.children);
    }
  };

  sort(root);
  return root;
}

// --- Route 1: GET / -- List workspace files as a tree ------------------------

router.get('/', async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const search = req.query.search as string | undefined;

  try {
    let output: string;

    if (search) {
      output = await execCommand(req.user.id, [
        'sh', '-c',
        `find /home/node -maxdepth 2 -name "*${search.replace(/'/g, "'\"'\"'")}*" ` +
        `-not -path "/home/node/.*" -not -name ".*" | head -50 | while read f; do ` +
        'printf "%s\t%s\t%s\t%s\n" "$f" "$(stat -c %s "$f" 2>/dev/null)" "$(stat -c %Y "$f" 2>/dev/null)" "$(stat -c %F "$f" 2>/dev/null)"; done'
      ]);
    } else {
      output = await execCommand(req.user.id, [
        'sh', '-c',
        'find /home/node -not -path "/home/node" -not -path "/home/node/.*" -not -name ".*" | ' +
        'while read f; do ' +
        'printf "%s\t%s\t%s\t%s\n" "$f" "$(stat -c %s "$f" 2>/dev/null)" "$(stat -c %Y "$f" 2>/dev/null)" "$(stat -c %F "$f" 2>/dev/null)"; done'
      ]);
    }

    const lines = output.split('\n').filter((l) => l.trim());

    const flat = lines.map((line) => {
      const [fullPath, size, mtime, type] = line.split('\t');
      return {
        path: fullPath.replace('/home/node/', ''),
        type: (type?.trim() === 'directory' ? 'dir' : 'file') as 'file' | 'dir',
        size: parseInt(size ?? '0', 10) || 0,
        modified: (parseInt(mtime ?? '0', 10) || 0) * 1000,
      };
    });

    res.json({ entries: buildTree(flat) });
  } catch (err) {
    console.error('Error listing files:', err);
    res.json({ entries: [] });
  }
});

// --- Route 2: POST /upload ---------------------------------------------------

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

  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\/+/g, '_');
  if (safeName.startsWith('.') || safeName.includes('..')) {
    res.status(400).json({ error: 'Invalid filename' });
    return;
  }

  try {
    const fileBuffer = Buffer.from(content, 'base64');
    const base64Content = fileBuffer.toString('base64');

    await writeFileViaExec(req.user.id, safeName, base64Content);

    res.status(201).json({ ok: true, name: safeName, path: safeName, size: fileBuffer.length });
  } catch (err) {
    console.error('Error uploading file:', err);
    res.status(500).json({ error: 'Failed to upload file' });
  }
});

// --- Route 3: POST /move -----------------------------------------------------

router.post('/move', async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { from, to } = req.body as { from?: string; to?: string };

  if (!from || !to) {
    res.status(400).json({ error: 'from and to are required' });
    return;
  }

  const safeFrom = sanitizePath(from);
  const safeTo = sanitizePath(to);

  if (!safeFrom || !safeTo || safeFrom === safeTo) {
    res.status(400).json({ error: 'Invalid from or to path' });
    return;
  }

  try {
    const destDir = safeTo.split('/').slice(0, -1).join('/');
    if (destDir) {
      await execCommand(req.user.id, ['mkdir', '-p', `/home/node/${destDir}`]);
    }

    await execCommand(req.user.id, ['mv', `/home/node/${safeFrom}`, `/home/node/${safeTo}`]);
    res.json({ ok: true, from: safeFrom, to: safeTo });
  } catch (err) {
    console.error('Error moving file:', err);
    res.status(500).json({ error: 'Failed to move file' });
  }
});

// --- Route 3.5: POST /mkdir -- Create a directory ---------------------------

router.post('/mkdir', async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { path: dirPath } = req.body as { path?: string };

  if (!dirPath) {
    res.status(400).json({ error: 'path is required' });
    return;
  }

  const safePath = sanitizePath(dirPath);
  if (!safePath || safePath.startsWith('.')) {
    res.status(400).json({ error: 'Invalid path' });
    return;
  }

  try {
    await execCommand(req.user.id, ['mkdir', '-p', `/home/node/${safePath}`]);
    res.json({ ok: true, path: safePath });
  } catch (err) {
    console.error('Error creating directory:', err);
    res.status(500).json({ error: 'Failed to create directory' });
  }
});

// --- Route 4: GET /<path>/raw -- Raw binary download --------------------------

router.get(/^\/(.+)\/raw$/, async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const safePath = sanitizePath(req.params[0] as string);

  if (!safePath) {
    res.status(400).json({ error: 'Path is required' });
    return;
  }

  try {
    const podManager = sessionManager.getPodManager();
    await podManager.ensurePod(req.user.id);
    const exec = await podManager.execInPod(req.user.id, ['cat', `/home/node/${safePath}`]);

    const chunks: Buffer[] = [];
    exec.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));

    await new Promise<void>((resolve) => {
      exec.stdout.on('end', () => { exec.close(); resolve(); });
      setTimeout(() => { exec.close(); resolve(); }, 30_000);
    });

    const buffer = Buffer.concat(chunks);
    const filename = safePath.split('/').pop() ?? safePath;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.status(200).end(buffer);
  } catch (err) {
    console.error('Error serving raw file:', err);
    res.status(404).json({ error: 'File not found' });
  }
});

// --- Route 5: GET /<path> -- Read file content --------------------------------

router.get(/^\/(.+)$/, async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  if (req.path.endsWith('/raw')) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  const safePath = sanitizePath(req.params[0] as string);

  if (!safePath) {
    res.status(400).json({ error: 'Path is required' });
    return;
  }

  try {
    const content = await execCommand(req.user.id, ['cat', `/home/node/${safePath}`]);
    res.json({ content });
  } catch (err) {
    console.error('Error reading file:', err);
    res.status(404).json({ error: 'File not found or could not be read' });
  }
});

// --- Route 6: PUT /<path> -- Create or update a file -------------------------

router.put(/^\/(.+)$/, async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const safePath = sanitizePath(req.params[0] as string);

  if (!safePath) {
    res.status(400).json({ error: 'Path is required' });
    return;
  }

  const { content } = req.body as { content?: string };
  if (content === undefined) {
    res.status(400).json({ error: 'content is required' });
    return;
  }

  try {
    const fileBuffer = Buffer.from(content, 'utf8');
    const base64Content = fileBuffer.toString('base64');

    const parentDir = safePath.split('/').slice(0, -1).join('/');
    if (parentDir) {
      await execCommand(req.user.id, ['mkdir', '-p', `/home/node/${parentDir}`]);
    }

    await writeFileViaExec(req.user.id, safePath, base64Content);

    res.status(200).json({ ok: true, path: safePath, size: fileBuffer.length });
  } catch (err) {
    console.error('Error writing file:', err);
    res.status(500).json({ error: 'Failed to write file' });
  }
});

// --- Route 7: DELETE /<path> ------------------------------------------------

router.delete(/^\/(.+)$/, async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const safePath = sanitizePath(req.params[0] as string);

  if (!safePath) {
    res.status(400).json({ error: 'Path is required' });
    return;
  }

  try {
    await execCommand(req.user.id, ['rm', '-rf', `/home/node/${safePath}`]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Error deleting file:', err);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

export default router;
